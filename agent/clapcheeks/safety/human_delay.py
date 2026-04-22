"""Human-like delay engine — realistic timing patterns that mimic real user behavior.

Key behaviors:
- Gaussian delays with time-of-day variance (slower at night, faster during rush)
- Session fatigue: delays gradually increase within a session (humans get tired/bored)
- Burst/pause pattern: occasional rapid swipes followed by longer pauses (phone checks)
- Micro-pauses: short 0.5-2s pauses between sub-actions (scrolling, reading bio)
- Session length variance: natural session durations (5-25 minutes)
- Cool-down between sessions: realistic gaps (not exactly 4h every time)

This replaces the basic jitter_delay in rate_limiter.py with a more sophisticated
engine that considers session context.
"""
from __future__ import annotations

import logging
import math
import random
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

logger = logging.getLogger(__name__)

ActionType = Literal["swipe", "message", "navigate", "read_bio", "view_photo", "scroll"]
Personality = Literal["cautious", "normal", "aggressive"]


@dataclass
class DelayProfile:
    """Delay distribution for a specific action type."""
    mean: float
    std: float
    floor: float
    ceiling: float


ACTION_PROFILES: dict[ActionType, DelayProfile] = {
    "swipe":      DelayProfile(mean=5.0,  std=2.0,  floor=1.5, ceiling=15.0),
    "message":    DelayProfile(mean=12.0, std=4.0,  floor=5.0, ceiling=40.0),
    "navigate":   DelayProfile(mean=2.0,  std=0.8,  floor=0.8, ceiling=5.0),
    "read_bio":   DelayProfile(mean=4.0,  std=1.5,  floor=1.5, ceiling=10.0),
    "view_photo": DelayProfile(mean=2.5,  std=1.0,  floor=1.0, ceiling=8.0),
    "scroll":     DelayProfile(mean=1.5,  std=0.5,  floor=0.5, ceiling=4.0),
}

PERSONALITY_MULTIPLIERS: dict[Personality, float] = {
    "cautious": 1.3,
    "normal": 1.0,
    "aggressive": 0.8,
}

# Hour of day -> multiplier (0-23). Slower at night, faster during peak hours.
HOUR_MULTIPLIERS: dict[int, float] = {
    0: 1.8, 1: 2.0, 2: 2.0, 3: 2.0, 4: 1.8, 5: 1.5,
    6: 1.2, 7: 1.1, 8: 1.0, 9: 0.9, 10: 0.9, 11: 0.9,
    12: 1.0, 13: 0.9, 14: 0.9, 15: 0.9, 16: 0.9, 17: 0.9,
    18: 0.85, 19: 0.8, 20: 0.85, 21: 0.9, 22: 1.0, 23: 1.3,
}


@dataclass
class SessionContext:
    """Tracks state within a single automation session."""
    started_at: float = field(default_factory=time.time)
    action_count: int = 0
    swipe_count: int = 0
    in_burst: bool = False
    burst_remaining: int = 0
    max_session_minutes: float = field(default_factory=lambda: random.gauss(15, 5))

    @property
    def elapsed_minutes(self) -> float:
        return (time.time() - self.started_at) / 60.0

    @property
    def fatigue_factor(self) -> float:
        """Fatigue increases delays as session progresses."""
        minutes = self.elapsed_minutes
        if minutes < 5:
            return 1.0
        elif minutes < 10:
            return 1.1
        elif minutes < 15:
            return 1.2
        elif minutes < 20:
            return 1.4
        else:
            return 1.6 + (minutes - 20) * 0.05


class HumanDelayEngine:
    """Generates human-like delays between actions.

    Usage:
        engine = HumanDelayEngine(personality="normal")
        engine.start_session()

        delay = engine.get_delay("swipe")
        await asyncio.sleep(delay)

        if engine.should_end_session():
            engine.end_session()
    """

    def __init__(self, personality: Personality = "normal") -> None:
        self.personality = personality
        self._multiplier = PERSONALITY_MULTIPLIERS[personality]
        self._session: SessionContext | None = None

    def start_session(self) -> SessionContext:
        """Begin a new session context."""
        self._session = SessionContext()
        max_mins = max(5.0, min(30.0, self._session.max_session_minutes))
        self._session.max_session_minutes = max_mins
        logger.debug(
            "Session started (personality=%s, max_minutes=%.1f)",
            self.personality, max_mins,
        )
        return self._session

    def end_session(self) -> None:
        """End the current session."""
        if self._session:
            logger.debug(
                "Session ended: %d actions in %.1f minutes",
                self._session.action_count, self._session.elapsed_minutes,
            )
        self._session = None

    def get_delay(self, action: ActionType = "swipe") -> float:
        """Get the next delay in seconds for a given action type.

        Factors in: base profile, personality, time of day, session fatigue,
        and burst/pause patterns.
        """
        profile = ACTION_PROFILES.get(action, ACTION_PROFILES["swipe"])

        # Base delay from Gaussian distribution
        delay = random.gauss(profile.mean, profile.std)

        # Apply personality multiplier
        delay *= self._multiplier

        # Apply time-of-day multiplier
        hour = datetime.now().hour
        delay *= HOUR_MULTIPLIERS.get(hour, 1.0)

        # Apply session fatigue
        if self._session:
            delay *= self._session.fatigue_factor
            self._session.action_count += 1
            if action == "swipe":
                self._session.swipe_count += 1

            # Burst mode: 15% chance of entering burst (fast swipes then pause)
            if action == "swipe" and not self._session.in_burst:
                if random.random() < 0.15:
                    self._session.in_burst = True
                    self._session.burst_remaining = random.randint(3, 7)
                    logger.debug("Entering burst mode (%d swipes)", self._session.burst_remaining)

            if self._session.in_burst:
                delay *= 0.4  # Much faster during burst
                self._session.burst_remaining -= 1
                if self._session.burst_remaining <= 0:
                    self._session.in_burst = False
                    # Long pause after burst
                    delay = random.gauss(20.0, 5.0)
                    delay = max(10.0, min(45.0, delay))
                    logger.debug("Burst ended — long pause: %.1fs", delay)

        # Clamp to floor/ceiling
        delay = max(profile.floor, min(profile.ceiling * 2, delay))

        return delay

    def should_end_session(self) -> bool:
        """Check if the current session should end based on time and fatigue."""
        if not self._session:
            return True
        return self._session.elapsed_minutes >= self._session.max_session_minutes

    def get_typing_delay(self, message_length: int) -> float:
        """Get delay for typing a message (simulates thinking + typing).

        Returns total delay including thinking pause and typing time.
        """
        # Thinking pause before typing (2-8 seconds)
        thinking = random.gauss(4.0, 1.5)
        thinking = max(2.0, min(8.0, thinking))

        # Typing speed: roughly 2 chars/second with variance
        chars_per_second = random.gauss(2.0, 0.5)
        chars_per_second = max(1.0, min(4.0, chars_per_second))
        typing_time = message_length / chars_per_second

        # Add micro-pauses (thinking mid-sentence)
        pauses = message_length // 30  # pause roughly every 30 chars
        pause_time = sum(random.gauss(1.5, 0.5) for _ in range(pauses))

        total = thinking + typing_time + max(0, pause_time)
        return total * self._multiplier

    def get_inter_session_delay(self) -> float:
        """Get delay between sessions (hours converted to seconds).

        Returns a realistic gap between automation sessions.
        """
        # Base: 2-6 hours
        hours = random.gauss(3.5, 1.2)
        hours = max(2.0, min(6.0, hours))

        # Time-of-day adjustment: longer gaps at night
        hour = datetime.now().hour
        if 0 <= hour < 7:
            hours *= 1.5  # Sleep — longer gap
        elif 22 <= hour <= 23:
            hours *= 1.3  # Winding down

        return hours * 3600  # Convert to seconds
