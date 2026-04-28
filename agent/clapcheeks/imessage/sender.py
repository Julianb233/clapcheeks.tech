"""Phase F iMessage sender (AI-8320).

Sends outbound iMessages using the Mac Mini `god mac send` bridge. Falls
back to a local `osascript` call if running on the Mac directly and god
is not on PATH.

Keeps a narrow surface so the drafting pipeline can remain platform-
agnostic — callers pass (phone_e164, body).

Patches:
- P3 (AI-8737): pre-send chat.db recheck — abort if the operator just
  typed a message manually on the same handle (avoid double-texting).
- P4 (AI-8738): explicit AppleScript account-index routing for the
  osascript fallback so SMS handles route via the SMS account
  (Continuity / Messages in iCloud) instead of the iMessage account.
"""
from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass
from pathlib import Path

from clapcheeks.imessage.reader import to_e164_us

logger = logging.getLogger("clapcheeks.imessage.sender")


# ---------------------------------------------------------------------------
# Paths / configuration
# ---------------------------------------------------------------------------

IMESSAGE_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"

# AppleScript "account N" routing. macOS Messages.app exposes both an
# iMessage account and an SMS-forwarding account; their indices are stable
# per-Mac but vary across machines. Override per-Mac with env vars.
IMESSAGE_ACCOUNT_INDEX = int(os.environ.get("IMESSAGE_ACCOUNT_INDEX", "5"))
SMS_ACCOUNT_INDEX = int(os.environ.get("SMS_ACCOUNT_INDEX", "2"))

# Country-code prefixes that we treat as SMS-by-default (Android-heavy
# regions where iMessage delivery routinely fails). Operator can extend
# this list per-handle via SMS_HANDLES_FILE.
SMS_PREFIXES = ("+52", "+91")  # +52 Mexico, +91 India
SMS_HANDLES_FILE = Path.home() / ".clapcheeks" / "sms-handles.txt"


@dataclass
class SendResult:
    ok: bool
    channel: str              # 'god-mac' | 'osascript' | 'noop'
    error: str | None = None


# ---------------------------------------------------------------------------
# Helpers — transport detection
# ---------------------------------------------------------------------------

def _which_god() -> str | None:
    return shutil.which("god")


def _which_osascript() -> str | None:
    return shutil.which("osascript")


# ---------------------------------------------------------------------------
# P3 — pre-send chat.db recheck
# ---------------------------------------------------------------------------

def _recheck_no_double_text(handle_id: str) -> bool:
    """Re-query chat.db for the LAST message on this handle.

    Returns False if is_from_me=1 (operator typed manually since the draft
    was generated). Returns True if safe to send (her last, or no prior).

    Fails OPEN — if chat.db is unavailable (not on Mac, FDA revoked, etc.)
    we let the send proceed rather than silently dropping every draft.
    """
    if not IMESSAGE_DB_PATH.exists():
        return True  # not on Mac with chat.db — let send proceed
    try:
        db = sqlite3.connect(f"file:{IMESSAGE_DB_PATH}?mode=ro", uri=True, timeout=2)
        last = db.execute(
            """SELECT is_from_me FROM message m
               JOIN handle h ON m.handle_id = h.rowid
               WHERE h.id = ? ORDER BY date DESC LIMIT 1""",
            (handle_id,),
        ).fetchone()
        db.close()
        return last is None or last[0] == 0
    except Exception as exc:  # noqa: BLE001 — fail-open on any DB error
        logger.warning(
            "chat.db recheck failed for %s: %s — proceeding with send",
            handle_id, exc,
        )
        return True  # fail-open


# ---------------------------------------------------------------------------
# P4 — SMS handle classification
# ---------------------------------------------------------------------------

def _is_sms_handle(handle: str) -> bool:
    """Decide whether a phone handle should route through the SMS account.

    Rules (in order):
    1. Country-code prefix matches SMS_PREFIXES (Mexico, India, ...).
    2. Operator-overridden allow-list at ~/.clapcheeks/sms-handles.txt
       (one E.164 handle per line; blank lines and whitespace ignored).
    """
    if any(handle.startswith(p) for p in SMS_PREFIXES):
        return True
    if SMS_HANDLES_FILE.exists():
        try:
            entries = {
                line.strip()
                for line in SMS_HANDLES_FILE.read_text().splitlines()
                if line.strip()
            }
            return handle in entries
        except OSError:
            pass
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def send_imessage(
    phone: str,
    body: str,
    *,
    dry_run: bool = False,
) -> SendResult:
    """Send `body` to `phone` via iMessage / SMS.

    Normalizes phone to E.164 first. On dry_run (or if no transport is
    available), returns a noop SendResult without raising.
    """
    e164 = to_e164_us(phone)
    if not e164:
        return SendResult(ok=False, channel="noop", error=f"bad phone: {phone!r}")
    if not body or not body.strip():
        return SendResult(ok=False, channel="noop", error="empty body")

    if dry_run:
        logger.info("[dry_run] would send iMessage to %s: %s", e164, body[:80])
        return SendResult(ok=True, channel="noop")

    # P3: chat.db recheck — abort if operator typed manually since draft.
    if not _recheck_no_double_text(e164):
        logger.info(
            "send aborted for %s — last message is_from_me=1 (operator typed)",
            e164,
        )
        return SendResult(ok=False, channel="noop", error="double_text_aborted")

    god = _which_god()
    if god:
        try:
            proc = subprocess.run(
                [god, "mac", "send", e164, body],
                capture_output=True, text=True, timeout=30, check=False,
            )
            if proc.returncode == 0:
                return SendResult(ok=True, channel="god-mac")
            return SendResult(
                ok=False, channel="god-mac",
                error=f"rc={proc.returncode} stderr={proc.stderr[:200]}",
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            return SendResult(ok=False, channel="god-mac", error=str(exc))

    osa = _which_osascript()
    if osa:
        # P4: explicit account-index routing. Pick SMS account for handles
        # we know are SMS, otherwise iMessage account.
        account_index = (
            SMS_ACCOUNT_INDEX if _is_sms_handle(e164) else IMESSAGE_ACCOUNT_INDEX
        )
        escaped_body = body.replace("\\", "\\\\").replace('"', '\\"')
        script = (
            f'tell application "Messages" to send "{escaped_body}" '
            f'to participant "{e164}" of account {account_index}'
        )
        try:
            proc = subprocess.run(
                [osa, "-e", script],
                capture_output=True, text=True, timeout=30, check=False,
            )
            if proc.returncode == 0:
                return SendResult(ok=True, channel="osascript")
            return SendResult(
                ok=False, channel="osascript",
                error=f"rc={proc.returncode} stderr={proc.stderr[:200]}",
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            return SendResult(ok=False, channel="osascript", error=str(exc))

    return SendResult(ok=False, channel="noop", error="no iMessage transport available")


# ---------------------------------------------------------------------------
# Time-of-day per-recipient send window (research quick-win)
# ---------------------------------------------------------------------------
def send_imessage_with_window(
    phone: str,
    body: str,
    *,
    handle_id: str | None = None,
    defer_to_window: bool = True,
    user_id: str | None = None,
    match_name: str | None = None,
    dry_run: bool = False,
) -> SendResult:
    """Send `body` to `phone` only if NOW is in the recipient's predicted-best
    send window. If outside the window AND ``defer_to_window`` is True,
    enqueue a row in ``clapcheeks_scheduled_messages`` with
    ``scheduled_at = next_window_hour`` and return a deferred ``SendResult``.

    Source: Nielsen + Hinge data - 5pm-midnight peak; reply-within-24h
    boosts date odds 72%. Per-recipient hours learned from chat.db reply
    timestamps in ``send_window.best_send_hour_for``.

    This is OPT-IN. Existing callers that use ``send_imessage()`` directly
    are unchanged. Callers that want the window optimization should call
    THIS function instead.
    """
    from clapcheeks.safety.send_window import (
        is_within_send_window,
        next_window_hour,
    )

    e164 = to_e164_us(phone)
    if not e164:
        return SendResult(ok=False, channel="noop", error=f"bad phone: {phone!r}")

    handle = handle_id or e164
    in_window, reason = is_within_send_window(handle)

    if in_window or not defer_to_window:
        return send_imessage(phone=phone, body=body, dry_run=dry_run)

    # Defer: write a scheduled-messages row for the queue worker.
    scheduled_at = next_window_hour(handle).isoformat()
    logger.info(
        "deferring iMessage to %s until %s (%s)", e164, scheduled_at, reason,
    )

    if dry_run:
        return SendResult(ok=True, channel="deferred", error=None)

    try:
        from clapcheeks.job_queue import _client as _svc_client

        c = _svc_client()
        c.table("clapcheeks_scheduled_messages").insert({
            "user_id": user_id,
            "match_name": match_name or e164,
            "platform": "iMessage",
            "phone": e164,
            "message_text": body,
            "scheduled_at": scheduled_at,
            "status": "approved",
            "sequence_type": "manual",
        }).execute()
    except Exception as exc:
        logger.warning(
            "deferred enqueue failed (%s); falling back to immediate send", exc,
        )
        return send_imessage(phone=phone, body=body, dry_run=dry_run)

    return SendResult(ok=True, channel="deferred", error=None)
