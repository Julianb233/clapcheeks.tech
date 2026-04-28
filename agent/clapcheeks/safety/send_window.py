"""Hold queued messages until the predicted-best window for the recipient.

Sources: Nielsen + Hinge -- 5pm-midnight peak; reply-within-24h boosts date
odds 72%. We learn each recipient's reply-time distribution from her own
chat.db history and target the top-4 hours where she has actually replied
in the past. Falls back to the platform-wide DEFAULT_PEAK_HOURS when we
don't have enough history (less than 5 prior inbound messages) or when
chat.db is unavailable (linux VPS, sandboxed test env).
"""
from __future__ import annotations

import datetime
import logging
import sqlite3
from collections import Counter
from pathlib import Path

logger = logging.getLogger("clapcheeks.safety.send_window")

IMESSAGE_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"

# Default windows if no per-girl data: 5pm-midnight + first hr of next day.
DEFAULT_PEAK_HOURS: set[int] = {17, 18, 19, 20, 21, 22, 23, 0}


def best_send_hour_for(handle_id: str) -> set[int]:
    """Return the 4 best hours to send to THIS specific recipient based on
    when she has actually replied in the past 100 inbound messages.

    Falls back to ``DEFAULT_PEAK_HOURS`` if chat.db is missing, unreadable,
    or has fewer than 5 inbound messages from this handle.
    """
    if not IMESSAGE_DB_PATH.exists():
        return DEFAULT_PEAK_HOURS
    try:
        db = sqlite3.connect(
            f"file:{IMESSAGE_DB_PATH}?mode=ro", uri=True, timeout=2,
        )
        rows = db.execute(
            """SELECT m.date FROM message m
               JOIN handle h ON m.handle_id = h.rowid
               WHERE h.id = ? AND m.is_from_me = 0
               ORDER BY m.date DESC LIMIT 100""",
            (handle_id,),
        ).fetchall()
        db.close()
    except Exception as exc:
        logger.debug("chat.db lookup failed for %s: %s", handle_id, exc)
        return DEFAULT_PEAK_HOURS

    if len(rows) < 5:
        return DEFAULT_PEAK_HOURS

    hours: list[int] = []
    for (apple_date,) in rows:
        # Apple `date` column is nanoseconds since 2001-01-01 UTC.
        try:
            unix_ts = apple_date / 1_000_000_000 + 978_307_200
            hours.append(datetime.datetime.fromtimestamp(unix_ts).hour)
        except Exception:
            continue

    if not hours:
        return DEFAULT_PEAK_HOURS

    counter = Counter(hours)
    top4 = {h for h, _ in counter.most_common(4)}
    return top4 or DEFAULT_PEAK_HOURS


def is_within_send_window(
    handle_id: str,
    now: datetime.datetime | None = None,
) -> tuple[bool, str]:
    """Check if NOW is in this recipient's predicted-best window.

    Returns (in_window, human_reason). Caller decides whether to send,
    defer, or override.
    """
    now = now or datetime.datetime.now()
    target_hours = best_send_hour_for(handle_id)
    if now.hour in target_hours:
        return True, f"in window (target hours: {sorted(target_hours)})"
    return False, (
        "outside window - best hours for this contact: "
        f"{sorted(target_hours)}"
    )


def next_window_hour(
    handle_id: str,
    now: datetime.datetime | None = None,
) -> datetime.datetime:
    """Return the next datetime at the top of one of the recipient's
    target hours. Used by deferred-send schedulers to pick a real
    ``scheduled_at`` value.
    """
    now = now or datetime.datetime.now()
    target_hours = sorted(best_send_hour_for(handle_id))
    if not target_hours:
        return now + datetime.timedelta(hours=1)

    for h in target_hours:
        if h > now.hour:
            return now.replace(
                hour=h, minute=0, second=0, microsecond=0,
            )
    # Wrap to first target hour tomorrow.
    tomorrow = (now + datetime.timedelta(days=1)).replace(
        hour=target_hours[0], minute=0, second=0, microsecond=0,
    )
    return tomorrow
