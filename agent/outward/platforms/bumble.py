"""Bumble automation — driver-first (iPhone or Browserbase).

Bumble's API uses obfuscated request signing, making it impractical for
direct API calls. All automation goes through the active driver.
"""
from __future__ import annotations

import logging
import random
import time

from outward.session.rate_limiter import can_swipe, record_swipe, sleep_jitter

logger = logging.getLogger(__name__)


class BumbleClient:
    """Bumble automation — always uses the active driver (iPhone or Browserbase)."""

    def __init__(self, driver) -> None:
        if driver is None:
            raise ValueError(
                "Bumble requires an active driver (iPhone USB/WiFi or Browserbase). "
                "No driver available in current mode."
            )
        self._driver = driver

    def run_swipe_session(
        self,
        like_ratio: float = 0.55,
        max_swipes: int = 30,
    ) -> dict:
        """Run a Bumble swipe session using the active driver."""
        results = {"liked": 0, "passed": 0, "errors": 0}

        for _ in range(max_swipes):
            if not can_swipe("bumble", "right" if random.random() < like_ratio else "left"):
                results["stopped_reason"] = "daily_limit"
                break

            should_like = random.random() < like_ratio

            if should_like:
                success = self._driver.swipe_right()
                if success:
                    record_swipe("bumble", "right")
                    results["liked"] += 1
                else:
                    results["errors"] += 1
                    if results["errors"] >= 3:
                        logger.warning("Too many Bumble errors — stopping session.")
                        break
            else:
                success = self._driver.swipe_left()
                if success:
                    record_swipe("bumble", "left")
                    results["passed"] += 1

            sleep_jitter("swipe")

            # Random session break every 15-25 swipes
            if (results["liked"] + results["passed"]) % random.randint(15, 25) == 0:
                logger.info("Taking a short break (human simulation)...")
                sleep_jitter("session_break")

        return results

    def send_first_move(self, opener: str) -> bool:
        """Send a Bumble first move message (women must message first)."""
        return self._driver.send_message(opener)
