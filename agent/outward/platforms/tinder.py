"""Tinder automation — works with all three driver modes.

Primary: REST API (api.gotinder.com) — no browser, 0 resources
Fallback: Whatever driver mode is active (iPhone or Browserbase)
Auth refresh: Driver mode used to extract/refresh X-Auth-Token
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import requests

from outward.session.rate_limiter import can_swipe, record_swipe, sleep_jitter

logger = logging.getLogger(__name__)

TINDER_API = "https://api.gotinder.com"
TOKEN_FILE = Path.home() / ".outward" / "tinder_token.txt"


class TinderClient:
    """Tinder automation client.

    Uses the REST API when a valid token exists.
    Falls back to driver (iPhone/Browserbase) for auth and actions the API can't do.
    """

    def __init__(self, driver=None) -> None:
        self._driver = driver
        self._token: str | None = self._load_token()
        self._session = requests.Session()
        if self._token:
            self._session.headers.update({
                "X-Auth-Token": self._token,
                "Content-Type": "application/json",
                "platform": "web",
                "User-Agent": (
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
                ),
            })

    # ── Token management ──────────────────────────────────────────────────

    def _load_token(self) -> str | None:
        if TOKEN_FILE.exists():
            token = TOKEN_FILE.read_text().strip()
            return token if token else None
        return None

    def _save_token(self, token: str) -> None:
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(token)
        logger.info("Tinder token saved.")

    def refresh_token_via_driver(self) -> bool:
        """Use the active driver (Browserbase or iPhone) to get a fresh auth token."""
        if not self._driver:
            logger.error("No driver available for token refresh.")
            return False

        # Only MacCloudDriver can extract tokens from localStorage
        if hasattr(self._driver, "extract_auth_token"):
            token = self._driver.extract_auth_token()
            if token:
                self._token = token
                self._save_token(token)
                self._session.headers["X-Auth-Token"] = token
                return True

        logger.warning("Driver does not support token extraction.")
        return False

    # ── Core API methods ──────────────────────────────────────────────────

    def get_recommendations(self) -> list[dict]:
        """Fetch the next batch of profiles from Tinder."""
        if not self._token:
            logger.warning("No Tinder token — cannot fetch recommendations.")
            return []
        try:
            resp = self._session.get(
                f"{TINDER_API}/v2/recs/core",
                params={"locale": "en"},
                timeout=15,
            )
            if resp.status_code == 401:
                logger.warning("Tinder token expired — need refresh.")
                return []
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", {}).get("results", [])
        except Exception as exc:
            logger.error("get_recommendations failed: %s", exc)
            return []

    def like(self, user_id: str) -> bool:
        """Like (right swipe) a user via API."""
        if not can_swipe("tinder", "right"):
            logger.info("Daily right swipe limit reached for Tinder.")
            return False
        try:
            resp = self._session.post(
                f"{TINDER_API}/like/{user_id}",
                timeout=10,
            )
            success = resp.status_code == 200
            if success:
                record_swipe("tinder", "right")
            return success
        except Exception as exc:
            logger.error("Tinder like failed: %s", exc)
            return False

    def pass_(self, user_id: str) -> bool:
        """Pass (left swipe) a user via API."""
        if not can_swipe("tinder", "left"):
            logger.info("Daily left swipe limit reached for Tinder.")
            return False
        try:
            resp = self._session.post(
                f"{TINDER_API}/pass/{user_id}",
                timeout=10,
            )
            success = resp.status_code == 200
            if success:
                record_swipe("tinder", "left")
            return success
        except Exception as exc:
            logger.error("Tinder pass failed: %s", exc)
            return False

    def get_matches(self, count: int = 20) -> list[dict]:
        """List recent matches."""
        if not self._token:
            return []
        try:
            resp = self._session.get(
                f"{TINDER_API}/v2/matches",
                params={"count": count, "message": 0},
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json().get("data", {}).get("matches", [])
        except Exception as exc:
            logger.error("get_matches failed: %s", exc)
            return []

    def send_message(self, match_id: str, message: str) -> bool:
        """Send a message to a match."""
        if not self._token:
            return False
        try:
            resp = self._session.post(
                f"{TINDER_API}/user/matches/{match_id}",
                json={"message": message},
                timeout=15,
            )
            return resp.status_code == 200
        except Exception as exc:
            logger.error("send_message failed: %s", exc)
            return False

    # ── Swipe session ─────────────────────────────────────────────────────

    def run_swipe_session(
        self,
        like_ratio: float = 0.5,
        max_swipes: int = 30,
    ) -> dict:
        """Run a swipe session using the REST API.

        Args:
            like_ratio: Fraction of profiles to like (0.0–1.0).
            max_swipes: Maximum swipes this session.

        Returns:
            Session summary dict.
        """
        import random

        results = {"liked": 0, "passed": 0, "errors": 0, "stopped_reason": None}

        profiles = self.get_recommendations()
        if not profiles:
            results["stopped_reason"] = "no_recommendations"
            return results

        for profile in profiles[:max_swipes]:
            if results["liked"] + results["passed"] >= max_swipes:
                results["stopped_reason"] = "max_swipes_reached"
                break

            user_id = profile.get("user", {}).get("_id")
            if not user_id:
                continue

            # Like or pass based on ratio
            should_like = random.random() < like_ratio

            if should_like:
                if not can_swipe("tinder", "right"):
                    results["stopped_reason"] = "daily_limit"
                    break
                success = self.like(user_id)
                if success:
                    results["liked"] += 1
                else:
                    results["errors"] += 1
            else:
                self.pass_(user_id)
                results["passed"] += 1

            sleep_jitter("swipe")

        return results

    @property
    def has_token(self) -> bool:
        return bool(self._token)
