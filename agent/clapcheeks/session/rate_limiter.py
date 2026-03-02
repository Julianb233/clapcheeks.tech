"""Rate limiter — tracks daily swipe counts, spend, and enforces safe limits."""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from datetime import date
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

PLATFORM_COSTS = {
    "tinder": {"boost": 3.99, "super_like": 0.99, "gold_upgrade": 29.99},
    "bumble": {"spotlight": 2.99, "superswipe": 0.99, "boost": 7.99},
    "hinge": {"rose": 0.99, "boost": 6.99},
}

STATE_FILE = Path.home() / ".clapcheeks" / "daily_counts.json"


def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            if data.get("date") == str(date.today()):
                return data
        except Exception:
            pass
    return {"date": str(date.today()), "counts": {}, "spend": {}}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state))


def jitter_delay(action: str = "swipe") -> float:
    cfg = DELAY_CONFIG.get(action, DELAY_CONFIG["swipe"])
    delay = random.gauss(cfg["mean"], cfg["std"])
    return max(cfg["min"], min(cfg["max"], delay))


def sleep_jitter(action: str = "swipe") -> None:
    time.sleep(jitter_delay(action))


async def async_sleep_jitter(action: str = "swipe") -> None:
    await asyncio.sleep(jitter_delay(action))


def can_swipe(platform: str, direction: str = "right") -> bool:
    state = _load_state()
    key = f"{platform}_{direction}"
    current = state.get("counts", {}).get(key, 0)
    limit = DAILY_LIMITS.get(platform, {}).get(direction, 50)
    return current < limit


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


def check_limit(platform: str, action: str = "swipe") -> bool:
    """Check if platform is under its daily aggregate swipe cap.

    Raises RateLimitExceeded if the cap has been reached.
    Returns True if under the limit.
    """
    cap = _AGGREGATE_CAPS.get(platform, 50)
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
