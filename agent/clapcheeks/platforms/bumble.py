"""Bumble automation — browser/driver only (no public REST API)."""
from __future__ import annotations

import logging

from clapcheeks.session.rate_limiter import record_swipe, sleep_jitter, can_swipe

logger = logging.getLogger(__name__)


class BumbleClient:
    """Bumble automation via Playwright browser driver.

    Bumble uses obfuscated HMAC request signing on their API — driver-only approach.
    """

    def __init__(self, driver=None) -> None:
        self._driver = driver

    def send_first_move(self, message: str = "Hey!") -> bool:
        """Send Bumble's required first move message."""
        if not self._driver:
            return False
        try:
            if hasattr(self._driver, "send_first_move"):
                return self._driver.send_first_move(message)
        except Exception as exc:
            logger.error("send_first_move failed: %s", exc)
        return False

    def run_swipe_session(self, like_ratio: float = 0.5, max_swipes: int = 30) -> dict:
        """Run a Bumble swipe session using the browser driver."""
        import random
        results = {"liked": 0, "passed": 0, "errors": 0}

        if not self._driver:
            logger.error("Bumble requires a browser driver.")
            return results

        for _ in range(max_swipes):
            if not can_swipe("bumble", "right"):
                break
            try:
                should_like = random.random() < like_ratio
                if should_like:
                    if hasattr(self._driver, "swipe_right"):
                        self._driver.swipe_right()
                    record_swipe("bumble", "right")
                    results["liked"] += 1
                else:
                    if hasattr(self._driver, "swipe_left"):
                        self._driver.swipe_left()
                    record_swipe("bumble", "left")
                    results["passed"] += 1
                sleep_jitter("swipe")
            except Exception as exc:
                logger.error("Bumble swipe error: %s", exc)
                results["errors"] += 1

        return results
