"""BlueBubbles inbox consumer (fleet integration, 2026-04-24).

BlueBubbles webhook (VPS-side) writes inbound iMessage events to
`/opt/agency-workspace/fleet-shared/inbox/<slug>/YYYY-MM-DD.ndjson`,
one JSON object per line. This module tails those files and emits
structured events to a caller-supplied callback.

Event shape (see .fleet-config/services/bluebubbles-webhook/server.js):

    {
      "ts":   "2026-04-24T20:15:33.217Z",
      "type": "new-message" | "updated-message" | "chat-read-status-changed",
      "from": "+12135551234",
      "text": "hey",
      "guid": "<bluebubbles message guid>",
      "slug": "clapcheeks",
      "raw":  { <full webhook payload> },
    }

Why this exists:
    The existing `IMMessageWatcher` polls chat.db on the Mac every 5s —
    requires a Mac host, lags, and silently breaks when Messages.db is
    locked. The webhook path is push-based (~300ms), works from any
    host that can read `/opt/agency-workspace/fleet-shared`, and
    preserves the full BlueBubbles payload.

Consumption model:
    - A cursor file (`~/.clapcheeks/bluebubbles-cursor.json`) tracks
      `{path: byte_offset}` so restarts skip already-processed bytes.
    - On startup, existing `.ndjson` files in the watched slug dir are
      opened at the cursor offset and replayed.
    - Poll loop (default 1.0s) checks for new bytes + new day's file.
    - New-message events trigger the callback; other event types are
      logged and skipped (callers can subclass to handle them).
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

logger = logging.getLogger("clapcheeks.imessage.bluebubbles_inbox")

INBOX_ROOT = Path("/opt/agency-workspace/fleet-shared/inbox")
CURSOR_PATH = Path.home() / ".clapcheeks" / "bluebubbles-cursor.json"


@dataclass
class InboundEvent:
    ts: str
    type: str
    from_addr: str | None
    text: str | None
    guid: str | None
    slug: str
    raw: dict


EventCallback = Callable[[InboundEvent], None]


def _load_cursor() -> dict[str, int]:
    if not CURSOR_PATH.exists():
        return {}
    try:
        return json.loads(CURSOR_PATH.read_text()) or {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_cursor(cursor: dict[str, int]) -> None:
    CURSOR_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CURSOR_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(cursor, indent=2))
    tmp.replace(CURSOR_PATH)


def _parse_line(line: str, slug: str) -> InboundEvent | None:
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError as exc:
        logger.warning("skipping malformed ndjson line (slug=%s): %s", slug, exc)
        return None
    return InboundEvent(
        ts=obj.get("ts") or datetime.now(timezone.utc).isoformat(),
        type=obj.get("type") or "unknown",
        from_addr=obj.get("from"),
        text=obj.get("text"),
        guid=obj.get("guid"),
        slug=obj.get("slug") or slug,
        raw=obj.get("raw") or obj,
    )


class BlueBubblesInbox:
    """Tail the fleet BlueBubbles inbox for a given slug and emit events.

    Usage:
        def handle(evt: InboundEvent) -> None:
            if evt.type == "new-message" and evt.text:
                print(f"{evt.from_addr}: {evt.text}")

        inbox = BlueBubblesInbox(slug="clapcheeks", callback=handle)
        inbox.start(poll_interval=1.0)  # blocks; Ctrl+C to stop
    """

    def __init__(
        self,
        slug: str,
        callback: EventCallback,
        *,
        inbox_root: Path | None = None,
        watch_unknown: bool = False,
    ) -> None:
        self.slug = slug
        self.callback = callback
        self.root = inbox_root or INBOX_ROOT
        # Optionally also watch "unknown/" — useful until every clapcheeks
        # match's phone is registered in contact-index.json, since unregistered
        # senders land there.
        self.extra_slugs = ["unknown"] if watch_unknown else []
        self._cursor: dict[str, int] = _load_cursor()

    # ── Public API ─────────────────────────────────────────────────────
    def start(self, poll_interval: float = 1.0) -> None:
        logger.info(
            "BlueBubbles inbox tailing slug=%s extra=%s root=%s poll=%ss",
            self.slug, self.extra_slugs, self.root, poll_interval,
        )
        try:
            while True:
                self.drain_once()
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            logger.info("BlueBubbles inbox stopped")

    def drain_once(self) -> int:
        """Process any new bytes across all watched slug files. Returns
        the number of events emitted this pass.
        """
        emitted = 0
        slugs = [self.slug] + self.extra_slugs
        for slug in slugs:
            slug_dir = self.root / slug
            if not slug_dir.is_dir():
                continue
            for ndjson in sorted(slug_dir.glob("*.ndjson")):
                emitted += self._drain_file(ndjson, slug)
        if emitted:
            _save_cursor(self._cursor)
        return emitted

    # ── Internals ──────────────────────────────────────────────────────
    def _drain_file(self, path: Path, slug: str) -> int:
        key = str(path)
        offset = self._cursor.get(key, 0)
        try:
            size = path.stat().st_size
        except OSError:
            return 0
        if size < offset:
            # File was rotated / truncated; reset.
            offset = 0
        if size == offset:
            return 0
        emitted = 0
        with path.open("r", encoding="utf-8") as fh:
            fh.seek(offset)
            for line in fh:
                evt = _parse_line(line, slug)
                if evt is None:
                    continue
                try:
                    self.callback(evt)
                    emitted += 1
                except Exception as exc:  # noqa: BLE001 — never kill the tailer
                    logger.exception("callback error on evt guid=%s: %s", evt.guid, exc)
            self._cursor[key] = fh.tell()
        return emitted


__all__ = ["BlueBubblesInbox", "InboundEvent", "INBOX_ROOT", "CURSOR_PATH"]
