"""Pre-swipe safety checks — validates conditions before each swipe session.

Provides:
- Hourly limit enforcement (per-platform, per-direction)
- Cooldown tracking between sessions
- Match-rate back-off (detects shadowbans via declining match rates)
- Combined safety summary for dashboard display
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


# Hourly swipe limits (more granular than daily limits in rate_limiter.py)
HOURLY_LIMITS: dict[str, dict[str, int]] = {
    "tinder":  {"right": 15, "left": 60},
    "bumble":  {"right": 12, "left": 50},
    "hinge":   {"right": 5,  "left": 40},
    "grindr":  {"right": 25, "left": 80},
    "badoo":   {"right": 15, "left": 60},
    "happn":   {"right": 15, "left": 60},
    "okcupid": {"right": 12, "left": 50},
    "pof":     {"right": 15, "left": 60},
    "feeld":   {"right": 8,  "left": 40},
    "cmb":     {"right": 21, "left": 21},
}

# Minimum minutes between sessions per platform
SESSION_COOLDOWN_MINUTES: dict[str, int] = {
    "tinder":  90,
    "bumble":  90,
    "hinge":   120,
    "grindr":  60,
    "badoo":   90,
    "happn":   120,
    "okcupid": 90,
    "pof":     90,
    "feeld":   120,
    "cmb":     1440,  # Once per day (bagels arrive at noon)
}

# Match rate back-off config
MATCH_RATE_BACKOFF_THRESHOLD = 0.02  # 2% match rate = shadowban indicator
MATCH_RATE_WINDOW_SESSIONS = 5       # Look at last N sessions
BACKOFF_HOURS = 24                   # How long to back off

# In-memory state (resets on process restart, which is fine)
_hourly_counts: dict[str, dict[str, int]] = {}
_hour_timestamps: dict[str, float] = {}
_session_end_times: dict[str, float] = {}
_session_match_rates: dict[str, list[float]] = {}
_backoff_until: dict[str, float] = {}


def _reset_hourly_if_needed(platform: str) -> None:
    """Reset hourly counters if more than 1 hour has passed."""
    now = time.time()
    ts = _hour_timestamps.get(platform, 0)
    if now - ts > 3600:
        _hourly_counts[platform] = {"right": 0, "left": 0}
        _hour_timestamps[platform] = now


def check_hourly_limit(platform: str, direction: str = "right") -> bool:
    """Check if we're under the hourly swipe limit.

    Returns True if under limit, False if exceeded.
    """
    _reset_hourly_if_needed(platform)
    limits = HOURLY_LIMITS.get(platform, {"right": 15, "left": 60})
    counts = _hourly_counts.get(platform, {"right": 0, "left": 0})
    return counts.get(direction, 0) < limits.get(direction, 15)


def record_swipe(platform: str, direction: str = "right") -> None:
    """Record a swipe for hourly tracking."""
    _reset_hourly_if_needed(platform)
    if platform not in _hourly_counts:
        _hourly_counts[platform] = {"right": 0, "left": 0}
    _hourly_counts[platform][direction] = _hourly_counts[platform].get(direction, 0) + 1


def check_cooldown(platform: str) -> tuple[bool, float]:
    """Check if enough time has passed since the last session.

    Returns (can_proceed, minutes_remaining).
    """
    last_end = _session_end_times.get(platform)
    if not last_end:
        return True, 0.0

    cooldown = SESSION_COOLDOWN_MINUTES.get(platform, 90)
    elapsed = (time.time() - last_end) / 60.0
    if elapsed >= cooldown:
        return True, 0.0
    return False, cooldown - elapsed


def record_session_end(platform: str) -> None:
    """Record the end of a session for cooldown tracking."""
    _session_end_times[platform] = time.time()


def record_session_match_rate(platform: str, match_rate: float) -> None:
    """Record match rate for back-off analysis.

    Args:
        platform: Platform name
        match_rate: Matches / right_swipes ratio (0.0 to 1.0)
    """
    if platform not in _session_match_rates:
        _session_match_rates[platform] = []
    _session_match_rates[platform].append(match_rate)
    # Keep only last N sessions
    if len(_session_match_rates[platform]) > MATCH_RATE_WINDOW_SESSIONS * 2:
        _session_match_rates[platform] = _session_match_rates[platform][-MATCH_RATE_WINDOW_SESSIONS:]

    # Check if we should activate back-off
    rates = _session_match_rates[platform][-MATCH_RATE_WINDOW_SESSIONS:]
    if len(rates) >= MATCH_RATE_WINDOW_SESSIONS:
        avg = sum(rates) / len(rates)
        if avg < MATCH_RATE_BACKOFF_THRESHOLD:
            _backoff_until[platform] = time.time() + BACKOFF_HOURS * 3600
            logger.warning(
                "[%s] Match rate back-off activated: avg %.1f%% over %d sessions. "
                "Pausing for %dh. Possible shadowban.",
                platform, avg * 100, len(rates), BACKOFF_HOURS,
            )


def is_backoff_active(platform: str) -> bool:
    """Check if match-rate back-off is currently active."""
    until = _backoff_until.get(platform, 0)
    return time.time() < until


def get_backoff_config() -> dict[str, Any]:
    """Return back-off configuration for display."""
    return {
        "threshold": MATCH_RATE_BACKOFF_THRESHOLD,
        "window_sessions": MATCH_RATE_WINDOW_SESSIONS,
        "backoff_hours": BACKOFF_HOURS,
    }


def pre_swipe_check(platform: str, direction: str = "right") -> tuple[bool, str]:
    """Combined pre-swipe safety check.

    Returns (can_swipe, reason).
    """
    # Check back-off first
    if is_backoff_active(platform):
        return False, f"Match rate back-off active for {platform}"

    # Check cooldown
    can_proceed, remaining = check_cooldown(platform)
    if not can_proceed:
        return False, f"Cooldown: {remaining:.0f}min remaining for {platform}"

    # Check hourly limit
    if not check_hourly_limit(platform, direction):
        return False, f"Hourly {direction}-swipe limit reached for {platform}"

    return True, "OK"


def get_safety_summary() -> dict[str, Any]:
    """Return a safety summary for all platforms."""
    summary: dict[str, Any] = {}
    for platform in HOURLY_LIMITS:
        can_proceed, reason = pre_swipe_check(platform)
        hourly = _hourly_counts.get(platform, {"right": 0, "left": 0})
        limits = HOURLY_LIMITS.get(platform, {"right": 15, "left": 60})
        summary[platform] = {
            "can_swipe": can_proceed,
            "reason": reason,
            "hourly_right": f"{hourly.get('right', 0)}/{limits.get('right', 15)}",
            "hourly_left": f"{hourly.get('left', 0)}/{limits.get('left', 60)}",
            "backoff_active": is_backoff_active(platform),
        }
    return summary
