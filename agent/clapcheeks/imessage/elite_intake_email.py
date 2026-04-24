"""Elite roster intake via Gmail attachments.

Polls Gmail (via the fleet `gws` CLI) for messages matching a search query,
extracts image attachments, POSTs each to clapcheeks.tech's
/api/roster/intake, and applies a label to the message so the next poll
skips it.

Designed to run as a cron job (every 5 min) or wrapped in a `/loop`:

    clapcheeks elite-intake-email-poll

or:

    /loop 5m clapcheeks elite-intake-email-poll
"""
from __future__ import annotations

import base64
import json
import logging
import os
import subprocess
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

logger = logging.getLogger("clapcheeks.imessage.elite_intake_email")

API_BASE = os.environ.get("CLAPCHEEKS_API_BASE", "https://clapcheeks.tech").rstrip("/")


def _gws(*args: str) -> dict | list | None:
    """Call the gws CLI, return parsed JSON. None on error."""
    try:
        proc = subprocess.run(
            ["gws", *args],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if proc.returncode != 0:
            logger.error("gws %s failed rc=%s stderr=%s", args, proc.returncode, proc.stderr[:200])
            return None
        return json.loads(proc.stdout) if proc.stdout.strip() else None
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        logger.error("gws %s error: %s", args, exc)
        return None


def _find_or_create_label(label: str) -> str | None:
    existing = _gws("gmail", "users", "labels", "list", "--userId", "me")
    if isinstance(existing, dict):
        for lbl in existing.get("labels", []) or []:
            if lbl.get("name") == label:
                return lbl.get("id")
    created = _gws(
        "gmail", "users", "labels", "create", "--userId", "me",
        "--json", json.dumps({"name": label, "labelListVisibility": "labelShow"}),
    )
    if isinstance(created, dict):
        return created.get("id")
    return None


def _list_messages(query: str, exclude_label_id: str | None) -> list[str]:
    args = ["gmail", "users", "messages", "list", "--userId", "me", "--q", query, "--maxResults", "25"]
    data = _gws(*args)
    if not isinstance(data, dict):
        return []
    out: list[str] = []
    for m in data.get("messages", []) or []:
        mid = m.get("id")
        if not mid:
            continue
        if exclude_label_id:
            # Skip if already labeled (we'll confirm via full fetch below)
            meta = _gws("gmail", "users", "messages", "get", "--userId", "me",
                        "--id", mid, "--format", "metadata")
            if isinstance(meta, dict) and exclude_label_id in (meta.get("labelIds") or []):
                continue
        out.append(mid)
    return out


def _get_message_full(msg_id: str) -> dict | None:
    data = _gws("gmail", "users", "messages", "get", "--userId", "me",
                "--id", msg_id, "--format", "full")
    return data if isinstance(data, dict) else None


def _extract_image_parts(payload: dict) -> list[tuple[str, str, str]]:
    """Walk the MIME tree. Returns [(attachment_id, filename, mime_type)]."""
    out: list[tuple[str, str, str]] = []
    def walk(p: dict) -> None:
        mime = p.get("mimeType") or ""
        body = p.get("body") or {}
        if mime.startswith("image/") and body.get("attachmentId"):
            out.append((body["attachmentId"], p.get("filename") or "image", mime))
        for child in p.get("parts") or []:
            walk(child)
    walk(payload)
    return out


def _download_attachment(msg_id: str, att_id: str) -> bytes | None:
    data = _gws("gmail", "users", "messages", "attachments", "get",
                "--userId", "me", "--messageId", msg_id, "--id", att_id)
    if not isinstance(data, dict):
        return None
    b64 = (data.get("data") or "").replace("-", "+").replace("_", "/")
    # Gmail uses base64url; pad to multiple of 4
    b64 += "=" * ((4 - len(b64) % 4) % 4)
    try:
        return base64.b64decode(b64)
    except Exception as exc:  # noqa: BLE001
        logger.error("attachment %s decode failed: %s", att_id, exc)
        return None


def _post_intake(image_bytes: bytes, mime: str, sender_email: str | None,
                 message_body: str | None) -> dict | None:
    token = os.environ.get("CLAPCHEEKS_DEVICE_TOKEN")
    if not token:
        logger.error("CLAPCHEEKS_DEVICE_TOKEN not set — cannot call API")
        return None
    payload = {
        "image_b64": base64.b64encode(image_bytes).decode("ascii"),
        "mime": mime,
        "source": "screenshot-email",
        "source_handle": sender_email,
        "source_message": message_body,
    }
    req = Request(
        f"{API_BASE}/api/roster/intake",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        logger.error("intake HTTP %s: %s", e.code, e.read()[:200])
        return None
    except URLError as e:
        logger.error("intake unreachable: %s", e)
        return None


def _apply_label(msg_id: str, label_id: str) -> None:
    _gws("gmail", "users", "messages", "modify", "--userId", "me",
         "--id", msg_id, "--json",
         json.dumps({"addLabelIds": [label_id]}))


def _header(msg: dict, name: str) -> str | None:
    for h in (msg.get("payload") or {}).get("headers") or []:
        if h.get("name", "").lower() == name.lower():
            return h.get("value")
    return None


def poll_once(query: str, label: str, dry_run: bool = False) -> int:
    """Single poll pass. Returns number of attachments processed."""
    label_id = None if dry_run else _find_or_create_label(label)
    msg_ids = _list_messages(query, label_id)
    logger.info("elite-email-poll: %d candidate messages for q=%r", len(msg_ids), query)
    processed = 0
    for mid in msg_ids:
        msg = _get_message_full(mid)
        if not msg:
            continue
        if label_id and label_id in (msg.get("labelIds") or []):
            continue
        sender = _header(msg, "From")
        subject = _header(msg, "Subject")
        parts = _extract_image_parts(msg.get("payload") or {})
        if not parts:
            continue
        logger.info("msg %s from %s: %d image attachment(s)", mid, sender, len(parts))
        any_processed = False
        for att_id, filename, mime in parts:
            if dry_run:
                print(f"[dry_run] would ingest {filename} ({mime}) from {sender}")
                any_processed = True
                processed += 1
                continue
            image_bytes = _download_attachment(mid, att_id)
            if not image_bytes:
                continue
            body_str = f"subject: {subject}" if subject else None
            result = _post_intake(image_bytes, mime, sender, body_str)
            if result:
                processed += 1
                any_processed = True
                logger.info(
                    "msg %s %s -> match %s (merged=%s)",
                    mid, filename,
                    result.get("match_id"), result.get("merged"),
                )
        if any_processed and label_id and not dry_run:
            _apply_label(mid, label_id)
    if processed and not dry_run:
        # Inline Google Contacts sync — VPS-side, so `gws` is available.
        try:
            from clapcheeks.imessage.elite_google_sync import sync_once
            sync_once(limit=max(processed, 5))
        except Exception as exc:  # noqa: BLE001
            logger.warning("inline google sync failed: %s", exc)
    return processed
