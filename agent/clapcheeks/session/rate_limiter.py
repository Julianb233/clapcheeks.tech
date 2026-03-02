"""Rate limiter — tracks daily swipe counts and spend per platform."""
from __future__ import annotations


def get_daily_summary() -> dict | None:
    """Return today's swipe counts keyed by {platform}_{direction}, or None."""
    return None


def get_daily_spend() -> dict:
    """Return today's spend per platform."""
    return {}
