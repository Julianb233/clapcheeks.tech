"""Phase F iMessage sender (AI-8320).

Sends outbound iMessages using the Mac Mini `god mac send` bridge, which
now routes through BlueBubbles HTTP API when fleet env vars are populated
(fleet integration 2026-04-24). Falls back to a local `osascript` call if
running on the Mac directly and god is not on PATH.

Keeps a narrow surface so the drafting pipeline can remain platform-
agnostic — callers pass (phone_e164, body).
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from clapcheeks.imessage.reader import to_e164_us

logger = logging.getLogger("clapcheeks.imessage.sender")

# Fleet BlueBubbles env files. Non-login shells (e.g. Python subprocesses under
# systemd / PM2 / Claude Code Bash tool) don't source /etc/profile.d, so we load
# the static config + shared secrets ourselves before invoking `god mac send`.
_BB_STATIC_ENV = Path("/opt/agency-workspace/.fleet-config/env/bluebubbles.env")
_BB_SECRETS_ENV = Path("/etc/bluebubbles/secrets.env")


def _parse_env_file(path: Path) -> dict[str, str]:
    """Parse a bash-style `export KEY=value` file into a dict. Silent on failure."""
    out: dict[str, str] = {}
    try:
        text = path.read_text()
    except (OSError, PermissionError):
        return out
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        # Strip surrounding quotes
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        if key:
            out[key] = val
    return out


def _ensure_bluebubbles_env() -> None:
    """Populate BLUEBUBBLES_* vars in os.environ if missing.

    Idempotent. Safe to call repeatedly. Never overwrites values already set
    by the caller. Silent if files aren't readable (falls through to AppleScript
    path in `mac send`).
    """
    needed = ("BLUEBUBBLES_ENABLED", "BLUEBUBBLES_URL", "BLUEBUBBLES_PASSWORD")
    if all(os.environ.get(k) for k in needed):
        return
    for env_path in (_BB_STATIC_ENV, _BB_SECRETS_ENV):
        for k, v in _parse_env_file(env_path).items():
            os.environ.setdefault(k, v)


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
        _ensure_bluebubbles_env()
        try:
            proc = subprocess.run(
                [god, "mac", "send", e164, body],
                capture_output=True, text=True, timeout=30, check=False,
                env=os.environ.copy(),
            )
            if proc.returncode == 0:
                # `mac send` prints "Sent to ... via BlueBubbles (guid=...)" on
                # the BlueBubbles path and "... via iMessage (rowid=...)" on the
                # AppleScript fallback. We surface that as the channel suffix so
                # callers can log / alert on path.
                combined = (proc.stdout or "") + (proc.stderr or "")
                via_bb = "via BlueBubbles" in combined
                return SendResult(
                    ok=True,
                    channel="god-mac-bluebubbles" if via_bb else "god-mac-applescript",
                )
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
