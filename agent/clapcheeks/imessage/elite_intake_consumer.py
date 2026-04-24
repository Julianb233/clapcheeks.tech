"""Elite roster intake via iMessage (BlueBubbles webhook tail).

Listens on the BlueBubbles inbox (see bluebubbles_inbox.py) for inbound
iMessage events that carry image attachments. When one arrives from a
whitelisted sender (by default: just Julian's phone), it:

  1. Downloads the attachment from the BlueBubbles server API.
  2. POSTs it to the clapcheeks /api/roster/intake endpoint as base64
     JSON with source='screenshot-imessage' + source_handle=<sender>.
  3. Sends a short confirmation iMessage back to the sender with the
     extracted name/phone/IG so they know it landed.

Wired into the CLI as `clapcheeks elite-intake-imessage-watch`.

Design choices:
- We deliberately POST to the already-deployed HTTP API instead of
  calling ingestScreenshot() in-process. Keeps the auth model simple
  (API user session is who owns the match) and means this consumer
  can run anywhere the VPS reaches clapcheeks.tech.
- Auth: the daemon uses a per-user "device token" (same one the Chrome
  extension uses) — stored in ~/.clapcheeks/.env as CLAPCHEEKS_DEVICE_TOKEN.
- Whitelist: CLAPCHEEKS_ELITE_SENDERS env var, comma-separated list of
  E.164 phones / emails. Defaults to empty = only sender == owner.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import quote as urlquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from clapcheeks.imessage.bluebubbles_inbox import (
    BlueBubblesInbox,
    InboundEvent,
)
from clapcheeks.imessage.sender import _ensure_bluebubbles_env, send_imessage

logger = logging.getLogger("clapcheeks.imessage.elite_intake_consumer")

API_BASE = os.environ.get("CLAPCHEEKS_API_BASE", "https://clapcheeks.tech").rstrip("/")


@dataclass
class EliteConsumerConfig:
    api_base: str = API_BASE
    device_token: str | None = None
    allowed_senders: tuple[str, ...] = ()
    confirm_back: bool = True


class EliteIntakeConsumer:
    """Bridge BlueBubbles inbound image attachments to /api/roster/intake."""

    def __init__(self, config: EliteConsumerConfig | None = None) -> None:
        self.cfg = config or self._config_from_env()

    @staticmethod
    def _config_from_env() -> EliteConsumerConfig:
        senders = os.environ.get("CLAPCHEEKS_ELITE_SENDERS", "")
        return EliteConsumerConfig(
            api_base=os.environ.get("CLAPCHEEKS_API_BASE", API_BASE),
            device_token=os.environ.get("CLAPCHEEKS_DEVICE_TOKEN"),
            allowed_senders=tuple(s.strip() for s in senders.split(",") if s.strip()),
            confirm_back=os.environ.get("CLAPCHEEKS_ELITE_CONFIRM", "1") != "0",
        )

    # ── BlueBubblesInbox callback ───────────────────────────────────────
    def handle(self, evt: InboundEvent) -> None:
        if evt.type != "new-message":
            return
        sender = (evt.from_addr or "").strip()
        if self.cfg.allowed_senders and sender not in self.cfg.allowed_senders:
            logger.info("ignoring elite-intake from non-allowed sender %s", sender)
            return
        attachments = self._extract_attachments(evt.raw)
        if not attachments:
            return
        logger.info("elite-intake: %d attachment(s) from %s", len(attachments), sender)
        for att in attachments:
            try:
                self._ingest_attachment(att, sender, evt.text)
            except Exception as exc:  # noqa: BLE001 — never kill the tailer
                logger.exception("elite-intake failed for %s: %s", att.get("guid"), exc)

    # ── Helpers ─────────────────────────────────────────────────────────
    def _extract_attachments(self, raw: dict) -> list[dict]:
        """BlueBubbles webhook payload format:
           raw.data.attachments = [{guid, mimeType, transferName, ...}]
        """
        data = (raw or {}).get("data") or {}
        atts = data.get("attachments") or []
        return [a for a in atts if str(a.get("mimeType", "")).startswith("image/")]

    def _ingest_attachment(self, att: dict, sender: str, msg_body: str | None) -> None:
        if not self.cfg.device_token:
            logger.error("CLAPCHEEKS_DEVICE_TOKEN not set — cannot call API")
            return
        guid = att.get("guid")
        mime = att.get("mimeType") or "image/jpeg"
        if not guid:
            return
        image_bytes = self._download_from_bluebubbles(guid)
        if not image_bytes:
            return
        payload = {
            "image_b64": base64.b64encode(image_bytes).decode("ascii"),
            "mime": mime,
            "source": "screenshot-imessage",
            "source_handle": sender,
            "source_message": msg_body or None,
        }
        url = f"{self.cfg.api_base}/api/roster/intake"
        req = Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.cfg.device_token}",
            },
            method="POST",
        )
        try:
            with urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            logger.error("intake API rejected: %s %s", e.code, e.read()[:200])
            return
        except URLError as e:
            logger.error("intake API unreachable: %s", e)
            return

        if self.cfg.confirm_back:
            ex = body.get("extracted") or {}
            merged = body.get("merged")
            name = ex.get("name") or "?"
            phone = ex.get("phone_e164") or "?"
            ig = ex.get("instagram_handle")
            tag = "Updated" if merged else "Added"
            msg = f"[clapcheeks elite] {tag}: {name} / {phone}"
            if ig:
                msg += f" / @{ig}"
            send_imessage(sender, msg)

    def _download_from_bluebubbles(self, guid: str) -> bytes | None:
        _ensure_bluebubbles_env()
        url = os.environ.get("BLUEBUBBLES_URL")
        pw = os.environ.get("BLUEBUBBLES_PASSWORD")
        if not url or not pw:
            logger.error("BLUEBUBBLES_URL/PASSWORD missing")
            return None
        full = f"{url.rstrip('/')}/api/v1/attachment/{guid}/download?password={urlquote(pw)}"
        try:
            with urlopen(full, timeout=30) as resp:
                return resp.read()
        except (HTTPError, URLError) as e:
            logger.error("attachment download failed (%s): %s", guid, e)
            return None


def run(allowed_senders: Iterable[str] = (), poll_interval: float = 1.0) -> None:
    """Entry point used by the CLI — blocks until Ctrl+C."""
    cfg = EliteIntakeConsumer._config_from_env()
    if allowed_senders:
        cfg.allowed_senders = tuple(allowed_senders)
    consumer = EliteIntakeConsumer(cfg)
    inbox = BlueBubblesInbox(slug="clapcheeks", callback=consumer.handle, watch_unknown=True)
    logger.info(
        "elite-intake tailing inbox; senders=%s api=%s",
        cfg.allowed_senders or "<any>", cfg.api_base,
    )
    inbox.start(poll_interval=poll_interval)
