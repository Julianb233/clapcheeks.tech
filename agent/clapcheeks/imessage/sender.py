"""Phase F iMessage sender (AI-8320).

Sends outbound iMessages using the Mac Mini `god mac send` bridge. Falls
back to a local `osascript` call if running on the Mac directly and god
is not on PATH.

Keeps a narrow surface so the drafting pipeline can remain platform-
agnostic — callers pass (phone_e164, body).
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass

from clapcheeks.imessage.reader import to_e164_us

logger = logging.getLogger("clapcheeks.imessage.sender")


@dataclass
class SendResult:
    ok: bool
    channel: str              # 'god-mac' | 'osascript' | 'noop'
    error: str | None = None


def _which_god() -> str | None:
    return shutil.which("god")


def _which_osascript() -> str | None:
    return shutil.which("osascript")


def send_imessage(
    phone: str,
    body: str,
    *,
    dry_run: bool = False,
) -> SendResult:
    """Send `body` to `phone` via iMessage.

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
        # Local Mac fallback.
        escaped_body = body.replace('"', '\\"')
        script = (
            'tell application "Messages"\n'
            f'set theBuddy to participant "{e164}" of (service "iMessage")\n'
            f'send "{escaped_body}" to theBuddy\n'
            'end tell'
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
