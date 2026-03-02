"""Rate limiter with Gaussian jitter.

Enforces safe per-platform daily swipe limits and randomized delays
to mimic human behavior and avoid detection.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import time
from datetime import date
from pathlib import Path

logger = logging.getLogger(__name__)

# Conservative safe limits per platform per day
DAILY_LIMITS = {
    "tinder": {"right": 50, "left": 300, "messages": 30},
    "bumble": {"right": 60, "left": 250, "messages": 25},
    "hinge":  {"right": 60, "left": 200, "messages": 20},
}

# Delay ranges in seconds (Gaussian distribution within these bounds)
DELAY_CONFIG = {
    "swipe":    {"mean": 6.0,  "std": 2.5,  "min": 2.0,  "max": 18.0},
    "message":  {"mean": 15.0, "std": 5.0,  "min": 8.0,  "max": 45.0},
    "navigate": {"mean": 2.5,  "std": 0.8,  "min": 1.0,  "max": 6.0},
    "session_break": {"mean": 120.0, "std": 30.0, "min": 60.0, "max": 300.0},
}

STATE_FILE = Path.home() / ".outward" / "daily_counts.json"


def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            if data.get("date") == str(date.today()):
                return data
        except Exception:
            pass
    return {"date": str(date.today()), "counts": {}}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state))


def jitter_delay(action: str = "swipe") -> float:
    """Return a Gaussian-jittered delay for the given action type."""
    cfg = DELAY_CONFIG.get(action, DELAY_CONFIG["swipe"])
    delay = random.gauss(cfg["mean"], cfg["std"])
    return max(cfg["min"], min(cfg["max"], delay))


def sleep_jitter(action: str = "swipe") -> None:
    """Sleep for a human-like jittered duration."""
    delay = jitter_delay(action)
    logger.debug("Sleeping %.1fs (%s)", delay, action)
    time.sleep(delay)


async def async_sleep_jitter(action: str = "swipe") -> None:
    """Async version of sleep_jitter."""
    delay = jitter_delay(action)
    logger.debug("Async sleeping %.1fs (%s)", delay, action)
    await asyncio.sleep(delay)


def can_swipe(platform: str, direction: str = "right") -> bool:
    """Check if we're within daily swipe limits for this platform."""
    state = _load_state()
    counts = state.get("counts", {})
    key = f"{platform}_{direction}"
    current = counts.get(key, 0)
    limit = DAILY_LIMITS.get(platform, {}).get(direction, 50)
    return current < limit


def record_swipe(platform: str, direction: str = "right") -> None:
    """Record a swipe for rate limiting purposes."""
    state = _load_state()
    counts = state.setdefault("counts", {})
    key = f"{platform}_{direction}"
    counts[key] = counts.get(key, 0) + 1
    _save_state(state)


def get_daily_summary() -> dict:
    """Return today's swipe counts per platform."""
    state = _load_state()
    return state.get("counts", {})
