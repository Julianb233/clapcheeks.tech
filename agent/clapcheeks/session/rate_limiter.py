"""Rate limiter — tracks daily swipe counts, spend, and enforces safe limits.

v2 additions (PERS-220):
  - Match-rate back-off: reduce speed when match rate drops >50%
  - Zero-match pause: pause + alert after 2hrs of zero matches
  - Time-of-day restrictions: only natural hours by default
  - Session duration limits with mandatory breaks
  - Tier-based configurable overrides via config.yaml
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from datetime import date, datetime
from pathlib import Path

logger = logging.getLogger(__name__)


class RateLimitExceeded(Exception):
    """Raised when daily swipe cap is reached for a platform."""

    def __init__(self, platform: str, current: int, limit: int) -> None:
        self.platform = platform
        self.current = current
        self.limit = limit

    def __str__(self) -> str:
        return f"Daily limit reached for {self.platform}: {self.current}/{self.limit} swipes"


class OutsideActiveHours(Exception):
    """Raised when agent attempts to operate outside configured active hours."""

    def __init__(self, current_hour: int, active_start: int, active_end: int) -> None:
        self.current_hour = current_hour
        self.active_start = active_start
        self.active_end = active_end

    def __str__(self) -> str:
        return (
            f"Outside active hours: current={self.current_hour}, "
            f"allowed={self.active_start}-{self.active_end}"
        )


class SessionBreakRequired(Exception):
    """Raised when session has exceeded max duration and needs a break."""

    def __init__(self, session_minutes: int, max_minutes: int) -> None:
        self.session_minutes = session_minutes
        self.max_minutes = max_minutes

    def __str__(self) -> str:
        return (
            f"Session break required: {self.session_minutes}min elapsed "
            f"(max {self.max_minutes}min)"
        )


class MatchRateBackoff(Exception):
    """Raised when match rate has dropped significantly, suggesting speed reduction."""

    def __init__(self, platform: str, current_rate: float, baseline_rate: float) -> None:
        self.platform = platform
        self.current_rate = current_rate
        self.baseline_rate = baseline_rate

    def __str__(self) -> str:
        return (
            f"Match rate dropped on {self.platform}: "
            f"{self.current_rate:.1%} vs baseline {self.baseline_rate:.1%}"
        )


# ─── Default limits (overridable via config) ─────────────────────

DAILY_LIMITS = {
    "tinder":  {"right": 50,  "left": 300, "messages": 30},
    "bumble":  {"right": 60,  "left": 250, "messages": 25},
    "hinge":   {"right": 50,  "left": 200, "messages": 20},
    "grindr":  {"right": 200, "left": 500, "messages": 50},
    "badoo":   {"right": 100, "left": 300, "messages": 30},
    "happn":   {"right": 100, "left": 300, "messages": 30},
    "okcupid": {"right": 100, "left": 300, "messages": 30},
    "pof":     {"right": 100, "left": 300, "messages": 30},
    "feeld":   {"right": 50,  "left": 200, "messages": 20},
    "cmb":     {"right": 21,  "left": 21,  "messages": 21},
}

DELAY_CONFIG = {
    "swipe":    {"mean": 6.0,  "std": 2.5,  "min": 2.0,  "max": 18.0},
    "message":  {"mean": 15.0, "std": 5.0,  "min": 8.0,  "max": 45.0},
    "navigate": {"mean": 2.5,  "std": 0.8,  "min": 1.0,  "max": 6.0},
}

# Slower delays when back-off is active (1.5x default)
BACKOFF_DELAY_CONFIG = {
    "swipe":    {"mean": 9.0,  "std": 3.5,  "min": 4.0,  "max": 25.0},
    "message":  {"mean": 22.0, "std": 7.0,  "min": 12.0, "max": 60.0},
    "navigate": {"mean": 4.0,  "std": 1.2,  "min": 2.0,  "max": 8.0},
}

PLATFORM_COSTS = {
    "tinder": {"boost": 3.99, "super_like": 0.99, "gold_upgrade": 29.99},
    "bumble": {"spotlight": 2.99, "superswipe": 0.99, "boost": 7.99},
    "hinge": {"rose": 0.99, "boost": 6.99},
}

# Aggregate daily caps for check_limit (total swipes regardless of direction)
_AGGREGATE_CAPS = {
    "tinder":  100,
    "bumble":  75,
    "hinge":   50,
    "grindr":  200,
    "badoo":   100,
    "happn":   100,
    "okcupid": 100,
    "pof":     100,
    "feeld":   50,
    "cmb":     21,
}

# ─── Session & time-of-day defaults ──────────────────────────────

DEFAULT_ACTIVE_HOURS = (8, 23)  # 8 AM to 11 PM
DEFAULT_SESSION_MAX_MINUTES = 45
DEFAULT_BREAK_MINUTES = 15
DEFAULT_ZERO_MATCH_PAUSE_MINUTES = 120  # Pause after 2hrs of zero matches
DEFAULT_MATCH_RATE_DROP_THRESHOLD = 0.50  # 50% drop triggers back-off

# ─── Tier-based limit multipliers ────────────────────────────────

TIER_MULTIPLIERS = {
    "free":    0.5,   # Half the default limits
    "base":    1.0,   # Default limits
    "pro":     1.5,   # 1.5x limits
    "elite":   2.0,   # 2x limits
}

STATE_FILE = Path.home() / ".clapcheeks" / "daily_counts.json"
SESSION_FILE = Path.home() / ".clapcheeks" / "session_state.json"


# ─── Config loading ──────────────────────────────────────────────

_config_cache: dict | None = None


def _load_config() -> dict:
    """Load rate limiting config from config.yaml, with defaults."""
    global _config_cache
    if _config_cache is not None:
        return _config_cache

    try:
        from clapcheeks.config import load
        cfg = load()
    except Exception:
        cfg = {}

    rate_limits = cfg.get("rate_limits", {})
    _config_cache = {
        "active_hours": tuple(
            rate_limits.get("active_hours", list(DEFAULT_ACTIVE_HOURS))
        ),
        "session_max_minutes": rate_limits.get(
            "session_max_minutes", DEFAULT_SESSION_MAX_MINUTES
        ),
        "break_minutes": rate_limits.get(
            "break_minutes", DEFAULT_BREAK_MINUTES
        ),
        "zero_match_pause_minutes": rate_limits.get(
            "zero_match_pause_minutes", DEFAULT_ZERO_MATCH_PAUSE_MINUTES
        ),
        "match_rate_drop_threshold": rate_limits.get(
            "match_rate_drop_threshold", DEFAULT_MATCH_RATE_DROP_THRESHOLD
        ),
        "tier": rate_limits.get("tier", "base"),
        "platform_overrides": rate_limits.get("platform_overrides", {}),
    }
    return _config_cache


def reload_config() -> None:
    """Force config reload (call when config.yaml changes)."""
    global _config_cache
    _config_cache = None


def _get_tier_multiplier() -> float:
    """Get the rate limit multiplier for the current tier."""
    cfg = _load_config()
    return TIER_MULTIPLIERS.get(cfg["tier"], 1.0)


def _get_platform_limit(platform: str, direction: str) -> int:
    """Get effective limit for platform+direction, with tier and overrides."""
    cfg = _load_config()
    multiplier = _get_tier_multiplier()

    # Check for platform-specific override in config
    overrides = cfg.get("platform_overrides", {}).get(platform, {})
    if direction in overrides:
        return int(overrides[direction])

    base = DAILY_LIMITS.get(platform, {}).get(direction, 50)
    return int(base * multiplier)


def _get_aggregate_cap(platform: str) -> int:
    """Get effective aggregate cap with tier multiplier."""
    cfg = _load_config()
    overrides = cfg.get("platform_overrides", {}).get(platform, {})
    if "aggregate_cap" in overrides:
        return int(overrides["aggregate_cap"])

    base = _AGGREGATE_CAPS.get(platform, 50)
    return int(base * _get_tier_multiplier())


# ─── State management ────────────────────────────────────────────

def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            if data.get("date") == str(date.today()):
                return data
        except Exception:
            pass
    return {"date": str(date.today()), "counts": {}, "spend": {}, "match_tracking": {}}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state))


def _load_session_state() -> dict:
    if SESSION_FILE.exists():
        try:
            return json.loads(SESSION_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_session_state(state: dict) -> None:
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    SESSION_FILE.write_text(json.dumps(state))


# ─── Time-of-day enforcement ─────────────────────────────────────

def check_active_hours() -> bool:
    """Check if current time is within active hours.

    Raises OutsideActiveHours if outside configured window.
    Returns True if within active hours.
    """
    cfg = _load_config()
    start, end = cfg["active_hours"]
    current_hour = datetime.now().hour

    if start <= end:
        # Normal range (e.g., 8-23)
        in_range = start <= current_hour < end
    else:
        # Wrapping range (e.g., 22-6 for night owls)
        in_range = current_hour >= start or current_hour < end

    if not in_range:
        raise OutsideActiveHours(current_hour, start, end)
    return True


def is_active_hours() -> bool:
    """Non-raising version — returns True/False."""
    try:
        return check_active_hours()
    except OutsideActiveHours:
        return False


# ─── Session duration tracking ────────────────────────────────────

def start_session(platform: str) -> None:
    """Record session start time for a platform."""
    state = _load_session_state()
    state[f"{platform}_session_start"] = time.time()
    state[f"{platform}_last_match_time"] = time.time()  # Reset match timer
    _save_session_state(state)
    logger.info("Session started for %s", platform)


def check_session_duration(platform: str) -> bool:
    """Check if session has exceeded max duration.

    Raises SessionBreakRequired if a break is needed.
    Returns True if session is within limits.
    """
    cfg = _load_config()
    max_minutes = cfg["session_max_minutes"]

    state = _load_session_state()
    start_time = state.get(f"{platform}_session_start")
    if start_time is None:
        return True  # No session active

    elapsed_minutes = (time.time() - start_time) / 60
    if elapsed_minutes >= max_minutes:
        raise SessionBreakRequired(int(elapsed_minutes), max_minutes)

    return True


def end_session(platform: str) -> None:
    """Clear session state for a platform."""
    state = _load_session_state()
    state.pop(f"{platform}_session_start", None)
    state.pop(f"{platform}_last_match_time", None)
    _save_session_state(state)
    logger.info("Session ended for %s", platform)


def take_break(platform: str) -> int:
    """End session and return recommended break duration in seconds."""
    end_session(platform)
    cfg = _load_config()
    break_secs = cfg["break_minutes"] * 60
    # Add jitter to break duration (±20%)
    jitter = random.uniform(0.8, 1.2)
    return int(break_secs * jitter)


# ─── Match-rate back-off ─────────────────────────────────────────

def _get_match_tracking(platform: str) -> dict:
    """Get match tracking data for a platform."""
    state = _load_state()
    tracking = state.get("match_tracking", {})
    return tracking.get(platform, {
        "swipes_at_last_check": 0,
        "matches_at_last_check": 0,
        "baseline_rate": None,
        "backoff_active": False,
    })


def _save_match_tracking(platform: str, tracking: dict) -> None:
    """Save match tracking data."""
    state = _load_state()
    mt = state.setdefault("match_tracking", {})
    mt[platform] = tracking
    _save_state(state)


def check_match_rate(platform: str) -> bool:
    """Check if match rate has dropped significantly.

    Should be called periodically (e.g., every 20 swipes).
    Raises MatchRateBackoff if rate dropped >50% from baseline.
    Returns True if rate is healthy.
    """
    cfg = _load_config()
    threshold = cfg["match_rate_drop_threshold"]

    state = _load_state()
    counts = state.get("counts", {})

    total_swipes = counts.get(f"{platform}_right", 0)
    total_matches = counts.get(f"{platform}_matches", 0)

    if total_swipes < 10:
        return True  # Not enough data yet

    current_rate = total_matches / total_swipes if total_swipes > 0 else 0

    tracking = _get_match_tracking(platform)

    # Set baseline on first check with enough data
    if tracking.get("baseline_rate") is None:
        if total_swipes >= 20:
            tracking["baseline_rate"] = current_rate
            tracking["swipes_at_last_check"] = total_swipes
            tracking["matches_at_last_check"] = total_matches
            _save_match_tracking(platform, tracking)
        return True

    baseline = tracking["baseline_rate"]

    # Only trigger back-off if baseline is meaningful
    if baseline > 0 and current_rate < baseline * (1 - threshold):
        tracking["backoff_active"] = True
        _save_match_tracking(platform, tracking)
        logger.warning(
            "Match rate back-off triggered for %s: %.1f%% vs baseline %.1f%%",
            platform, current_rate * 100, baseline * 100,
        )
        raise MatchRateBackoff(platform, current_rate, baseline)

    # If rate recovered, clear back-off
    if tracking.get("backoff_active") and current_rate >= baseline * 0.8:
        tracking["backoff_active"] = False
        _save_match_tracking(platform, tracking)
        logger.info("Match rate recovered for %s, clearing back-off", platform)

    return True


def is_backoff_active(platform: str) -> bool:
    """Check if back-off mode is currently active for a platform."""
    tracking = _get_match_tracking(platform)
    return tracking.get("backoff_active", False)


# ─── Zero-match pause ────────────────────────────────────────────

def check_zero_match_pause(platform: str) -> int | None:
    """Check if platform has had zero matches for too long.

    Returns None if OK, or recommended pause duration in seconds if
    zero matches exceeded the configured threshold.
    """
    cfg = _load_config()
    pause_minutes = cfg["zero_match_pause_minutes"]

    state = _load_session_state()
    last_match = state.get(f"{platform}_last_match_time")

    if last_match is None:
        return None

    minutes_since_match = (time.time() - last_match) / 60
    if minutes_since_match >= pause_minutes:
        logger.warning(
            "Zero matches for %s for %.0f min (threshold: %d min) — recommending pause",
            platform, minutes_since_match, pause_minutes,
        )
        return pause_minutes * 60  # Return pause in seconds

    return None


def record_match_time(platform: str) -> None:
    """Update the last match timestamp (resets zero-match timer)."""
    state = _load_session_state()
    state[f"{platform}_last_match_time"] = time.time()
    _save_session_state(state)


# ─── Core API (original + enhanced) ──────────────────────────────

def jitter_delay(action: str = "swipe", platform: str | None = None) -> float:
    """Get a human-like jitter delay. Uses slower config if back-off is active."""
    if platform and is_backoff_active(platform):
        config = BACKOFF_DELAY_CONFIG
    else:
        config = DELAY_CONFIG
    cfg = config.get(action, config["swipe"])
    delay = random.gauss(cfg["mean"], cfg["std"])
    return max(cfg["min"], min(cfg["max"], delay))


def sleep_jitter(action: str = "swipe", platform: str | None = None) -> None:
    time.sleep(jitter_delay(action, platform))


async def async_sleep_jitter(action: str = "swipe", platform: str | None = None) -> None:
    await asyncio.sleep(jitter_delay(action, platform))


def can_swipe(platform: str, direction: str = "right") -> bool:
    state = _load_state()
    key = f"{platform}_{direction}"
    current = state.get("counts", {}).get(key, 0)
    limit = _get_platform_limit(platform, direction)
    return current < limit


def check_limit(platform: str, action: str = "swipe") -> bool:
    """Check if platform is under its daily aggregate swipe cap.

    Raises RateLimitExceeded if the cap has been reached.
    Returns True if under the limit.
    """
    cap = _get_aggregate_cap(platform)
    state = _load_state()
    counts = state.get("counts", {})
    right = counts.get(f"{platform}_right", 0)
    left = counts.get(f"{platform}_left", 0)
    total = right + left
    if total >= cap:
        raise RateLimitExceeded(platform, total, cap)
    return True


def record_swipe(platform: str, direction: str = "right") -> None:
    state = _load_state()
    counts = state.setdefault("counts", {})
    key = f"{platform}_{direction}"
    counts[key] = counts.get(key, 0) + 1
    _save_state(state)


def get_daily_summary() -> dict | None:
    state = _load_state()
    counts = state.get("counts", {})
    return counts if counts else None


def record_spend(platform: str, amount_usd: float) -> None:
    state = _load_state()
    spend = state.setdefault("spend", {})
    spend[platform] = round(spend.get(platform, 0.0) + amount_usd, 2)
    _save_state(state)


def track_feature_use(platform: str, feature: str) -> float:
    cost = PLATFORM_COSTS.get(platform, {}).get(feature, 0.0)
    if cost > 0:
        record_spend(platform, cost)
    return cost


def get_daily_spend() -> dict:
    return _load_state().get("spend", {})


def get_total_daily_spend() -> float:
    return sum(get_daily_spend().values())


def record_match(platform: str) -> None:
    """Increment match count for a platform and update match time."""
    state = _load_state()
    counts = state.setdefault("counts", {})
    key = f"{platform}_matches"
    counts[key] = counts.get(key, 0) + 1
    _save_state(state)
    # Also update session match time for zero-match tracking
    record_match_time(platform)


def record_conversation(platform: str) -> None:
    """Increment conversation count for a platform."""
    state = _load_state()
    counts = state.setdefault("counts", {})
    key = f"{platform}_conversations"
    counts[key] = counts.get(key, 0) + 1
    _save_state(state)


# ─── Pre-action gate (convenience) ───────────────────────────────

def pre_action_check(platform: str, direction: str = "right") -> None:
    """Run all safety checks before performing an action.

    Raises the appropriate exception if any check fails:
    - OutsideActiveHours
    - SessionBreakRequired
    - RateLimitExceeded
    - MatchRateBackoff (non-fatal — caller should slow down, not stop)

    Call this before every swipe/action for comprehensive protection.
    """
    check_active_hours()
    check_session_duration(platform)
    check_limit(platform)
    if not can_swipe(platform, direction):
        state = _load_state()
        current = state.get("counts", {}).get(f"{platform}_{direction}", 0)
        limit = _get_platform_limit(platform, direction)
        raise RateLimitExceeded(platform, current, limit)

    # Check zero-match pause (non-raising, returns recommendation)
    pause = check_zero_match_pause(platform)
    if pause is not None:
        logger.warning(
            "Zero-match pause recommended for %s (%ds). "
            "Continuing but consider pausing.",
            platform, pause,
        )

    # Match rate check (may raise MatchRateBackoff)
    state = _load_state()
    total_swipes = state.get("counts", {}).get(f"{platform}_right", 0)
    if total_swipes > 0 and total_swipes % 20 == 0:
        check_match_rate(platform)


def get_status(platform: str) -> dict:
    """Get comprehensive rate limiting status for a platform."""
    state = _load_state()
    counts = state.get("counts", {})
    cfg = _load_config()

    right = counts.get(f"{platform}_right", 0)
    left = counts.get(f"{platform}_left", 0)
    matches = counts.get(f"{platform}_matches", 0)
    total = right + left

    return {
        "platform": platform,
        "tier": cfg["tier"],
        "swipes_right": right,
        "swipes_left": left,
        "swipes_total": total,
        "matches": matches,
        "match_rate": f"{matches / right * 100:.1f}%" if right > 0 else "N/A",
        "limit_right": _get_platform_limit(platform, "right"),
        "limit_left": _get_platform_limit(platform, "left"),
        "aggregate_cap": _get_aggregate_cap(platform),
        "backoff_active": is_backoff_active(platform),
        "active_hours": cfg["active_hours"],
        "in_active_hours": is_active_hours(),
        "session_max_minutes": cfg["session_max_minutes"],
        "break_minutes": cfg["break_minutes"],
        "spend": state.get("spend", {}).get(platform, 0.0),
    }
