"""Read verification codes from macOS Messages.db.

Works across all iPhones paired with this Mac via iMessage/SMS forwarding.
No matter which of your N phones receives the Hinge/Tinder SMS, as long as
the phone forwards to the Mac Mini (Settings -> Messages -> Text Message
Forwarding -> enable this Mac), the code lands in ~/Library/Messages/chat.db
and we can read it.

Permission requirement (macOS): the process reading the DB needs **Full
Disk Access** granted to the parent app — typically Terminal, or the Python
binary you're running. To grant:
    System Settings -> Privacy & Security -> Full Disk Access ->
    "+" -> /Users/<you>/.clapcheeks/venv/bin/python

Schema notes:
    - `message.text` is the body
    - `message.date` is nanoseconds since 2001-01-01 (Apple epoch)
    - `message.is_from_me` = 1 when we sent it, 0 when they sent it
    - `handle.id` holds phone/email of sender
    - `handle.service` = "SMS" or "iMessage"
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

logger = logging.getLogger("clapcheeks.inputs.sms")

_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"
_APPLE_EPOCH_DELTA = 978307200  # seconds between 1970-01-01 and 2001-01-01

# Common platform-specific patterns. Case-insensitive.
# Each entry: name → regexes that must match the body somewhere.
_PLATFORM_PATTERNS: dict[str, list[re.Pattern]] = {
    "hinge": [
        re.compile(r"\bhinge\b", re.I),
    ],
    "tinder": [
        re.compile(r"\btinder\b", re.I),
    ],
    "bumble": [
        re.compile(r"\bbumble\b", re.I),
    ],
}

# Code pattern — 4 to 8 consecutive digits. Most dating apps use 4-6.
_CODE_RE = re.compile(r"\b(\d{4,8})\b")


@dataclass
class SMSCode:
    platform: str              # "hinge" / "tinder" / "bumble" / "unknown"
    code: str                  # the numeric code itself
    body: str                  # full message text
    sender: str                # handle.id (phone/email of sender)
    received_at: float         # unix ts
    age_seconds: float         # seconds since received_at (set at fetch time)


# ---------------------------------------------------------------------------
# DB access
# ---------------------------------------------------------------------------

class MessagesDBUnavailable(RuntimeError):
    """Raised when Messages.db can't be opened — usually Full Disk Access."""


def db_path() -> Path:
    """Allow override via env for testing."""
    override = os.environ.get("CLAPCHEEKS_MESSAGES_DB")
    return Path(override) if override else _DB_PATH


@contextmanager
def _open_readonly() -> Iterator[sqlite3.Connection]:
    p = db_path()
    if not p.exists():
        raise MessagesDBUnavailable(
            f"{p} does not exist. This only works on macOS with Messages.app set up."
        )
    try:
        # Read-only URI mode — never mutate the DB
        conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=5)
    except sqlite3.OperationalError as exc:
        raise MessagesDBUnavailable(
            f"Could not open {p}: {exc}. "
            "Grant Full Disk Access to the Python binary "
            "(System Settings -> Privacy & Security -> Full Disk Access)."
        ) from exc
    try:
        yield conn
    finally:
        conn.close()


def _apple_date_to_unix(apple_ts: int) -> float:
    """Messages stores dates as ns since 2001-01-01 on modern macOS."""
    return apple_ts / 1_000_000_000 + _APPLE_EPOCH_DELTA


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_recent_codes(
    since_seconds: int = 600,
    platforms: tuple[str, ...] = ("hinge", "tinder", "bumble"),
    limit: int = 20,
) -> list[SMSCode]:
    """Return any platform verification codes received in the last N seconds.

    Results are most-recent-first. `since_seconds` defaults to 10 min.
    """
    now = time.time()
    cutoff_unix = now - since_seconds
    cutoff_apple = int((cutoff_unix - _APPLE_EPOCH_DELTA) * 1_000_000_000)

    try:
        with _open_readonly() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT m.text, m.date, h.id, COALESCE(h.service, '')
                FROM message m
                LEFT JOIN handle h ON m.handle_id = h.ROWID
                WHERE m.date > ?
                  AND m.is_from_me = 0
                  AND m.text IS NOT NULL
                ORDER BY m.date DESC
                LIMIT ?
                """,
                (cutoff_apple, limit),
            )
            rows = cur.fetchall()
    except MessagesDBUnavailable:
        raise
    except sqlite3.Error as exc:
        logger.warning("Messages.db query failed: %s", exc)
        return []

    out: list[SMSCode] = []
    for text, apple_ts, sender, _service in rows:
        if not text:
            continue
        platform = _classify_platform(text, platforms)
        if platform is None:
            continue
        m = _CODE_RE.search(text)
        if not m:
            continue
        received = _apple_date_to_unix(apple_ts)
        out.append(SMSCode(
            platform=platform,
            code=m.group(1),
            body=text,
            sender=sender or "unknown",
            received_at=received,
            age_seconds=max(0.0, now - received),
        ))
    return out


def wait_for_code(
    platform: str,
    *,
    timeout_seconds: int = 60,
    poll_seconds: float = 2.0,
    received_after: float | None = None,
) -> SMSCode | None:
    """Poll Messages.db until a matching code arrives or timeout expires.

    `received_after`: only accept codes with received_at > this ts. Use the
    timestamp of right before you triggered the SMS, so we don't return a
    stale code from earlier.
    """
    deadline = time.time() + timeout_seconds
    received_after = received_after if received_after is not None else (time.time() - 5)
    while time.time() < deadline:
        try:
            codes = fetch_recent_codes(
                since_seconds=max(30, int(deadline - time.time()) + 30),
                platforms=(platform,),
            )
        except MessagesDBUnavailable as exc:
            logger.error("Cannot read Messages.db: %s", exc)
            return None
        for c in codes:
            if c.platform == platform and c.received_at > received_after:
                logger.info(
                    "SMS code for %s found: %s (age %.1fs, sender=%s)",
                    platform, c.code, c.age_seconds, c.sender,
                )
                return c
        time.sleep(poll_seconds)
    logger.warning("Timed out waiting for %s code after %ds", platform, timeout_seconds)
    return None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _classify_platform(text: str, allowed: tuple[str, ...]) -> str | None:
    for name in allowed:
        patterns = _PLATFORM_PATTERNS.get(name, [])
        if any(p.search(text) for p in patterns):
            return name
    return None
