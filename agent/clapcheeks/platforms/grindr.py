"""Grindr client — cascade swiping via reverse-engineered REST API + XMPP chat."""
from __future__ import annotations

import logging
import random
import time

from clapcheeks.session.rate_limiter import can_swipe, record_swipe, get_daily_summary

logger = logging.getLogger(__name__)

# Expected DAILY_LIMITS entry in clapcheeks/session/rate_limiter.py:
#   "grindr": {"right": 200, "left": 500, "messages": 50},
# Free users: 200 right taps/day; Grindr XTRA: 600/day.

GRINDR_API_BASE = "https://grindr.mobi"
CASCADE_PATH = "/v4/cascade"
TAP_PATH = "/v3/me/taps/{profile_id}"
CONVERSATIONS_PATH = "/v1/me/conversations"

DEFAULT_DAILY_RIGHT_LIMIT = 200


class GrindrClient:
    """Automate Grindr swiping via the reverse-engineered v3/v4 REST API."""

    def __init__(self, driver=None) -> None:
        # driver is accepted for interface consistency but not used (REST-based)
        self.driver = driver
        self._session = None
        self._token: str | None = None
        self._my_profile_id: str | None = None

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def login(self, email: str, password: str) -> bool:
        """Authenticate with Grindr and store the session token.

        Uses the Grindr package (reverse-engineered client) when available,
        falling back to a minimal direct REST auth call.

        Returns True on success, False on failure.
        """
        try:
            from Grindr import GrindrClient as _GrindrSDK  # type: ignore[import]

            client = _GrindrSDK(email, password)
            self._session = client
            self._token = getattr(client, "token", None) or getattr(
                client, "auth_token", None
            )
            logger.info("Grindr login succeeded via Grindr SDK.")
            return True
        except ImportError:
            logger.debug("Grindr SDK not available, falling back to direct REST auth.")
        except Exception as exc:
            logger.warning("Grindr SDK login failed: %s", exc)
            return False

        # Fallback: direct REST login
        try:
            import requests

            resp = requests.post(
                f"{GRINDR_API_BASE}/v3/sessions",
                json={"email": email, "password": password},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data.get("sessionId") or data.get("token")
            self._my_profile_id = str(data.get("profileId", ""))
            logger.info("Grindr login succeeded via direct REST.")
            return bool(self._token)
        except Exception as exc:
            logger.error("Grindr REST login failed: %s", exc)
            return False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _headers(self) -> dict:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "grindr3/3.28.0 (iPhone; iOS 15.0)",
        }
        if self._token:
            headers["Authorization"] = f"Grindr3 {self._token}"
        return headers

    def _api_get(self, path: str, params: dict | None = None) -> dict | list | None:
        try:
            import requests

            resp = requests.get(
                f"{GRINDR_API_BASE}{path}",
                headers=self._headers(),
                params=params or {},
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.warning("GET %s failed: %s", path, exc)
            return None

    def _api_post(self, path: str, body: dict | None = None) -> dict | None:
        try:
            import requests

            resp = requests.post(
                f"{GRINDR_API_BASE}{path}",
                headers=self._headers(),
                json=body or {},
                timeout=15,
            )
            resp.raise_for_status()
            # Some endpoints return 204 No Content
            if resp.status_code == 204 or not resp.content:
                return {}
            return resp.json()
        except Exception as exc:
            logger.warning("POST %s failed: %s", path, exc)
            return None

    @staticmethod
    def _jitter_delay() -> None:
        """Gaussian jitter delay between swipes — clamped to 2-18 seconds."""
        delay = random.gauss(6, 2.5)
        time.sleep(max(2.0, min(18.0, delay)))

    # ------------------------------------------------------------------
    # Swipe session
    # ------------------------------------------------------------------

    def run_swipe_session(
        self,
        like_ratio: float = 0.6,
        max_swipes: int = 30,
    ) -> dict:
        """Fetch the cascade and tap right/skip based on like_ratio.

        Returns a stats dict: {liked, passed, errors, new_matches}.
        """
        if not self._token:
            logger.error("Not logged in. Call login() first.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        # Rate-limit check
        daily = get_daily_summary() or {}
        used_right = daily.get("grindr_right", 0)
        remaining_right = max(0, DEFAULT_DAILY_RIGHT_LIMIT - used_right)
        effective_max = min(max_swipes, remaining_right)

        if effective_max <= 0:
            logger.warning("Daily right-tap limit reached for Grindr (%d/day).", DEFAULT_DAILY_RIGHT_LIMIT)
            return {"liked": 0, "passed": 0, "errors": 0, "new_matches": []}

        liked = 0
        passed = 0
        errors = 0

        # GET /v4/cascade — returns a list of profile objects
        cascade_data = self._api_get(CASCADE_PATH)
        if not cascade_data:
            logger.warning("Could not fetch Grindr cascade.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        profiles = cascade_data if isinstance(cascade_data, list) else cascade_data.get("items", [])

        for i, profile in enumerate(profiles[:effective_max]):
            try:
                profile_id = str(profile.get("profileId") or profile.get("id", ""))
                if not profile_id:
                    logger.debug("Skipping profile with no ID at index %d.", i)
                    continue

                do_like = random.random() < like_ratio

                if do_like and can_swipe("grindr", "right"):
                    tap_path = TAP_PATH.format(profile_id=profile_id)
                    result = self._api_post(tap_path, {"weight": 1})
                    if result is not None:
                        liked += 1
                        record_swipe("grindr", "right")
                        logger.debug("Tapped right on profile %s.", profile_id)
                    else:
                        errors += 1
                else:
                    # Skip (pass) — no API call needed for left swipe on Grindr
                    passed += 1
                    record_swipe("grindr", "left")
                    logger.debug("Skipped profile %s.", profile_id)

                self._jitter_delay()

            except Exception as exc:
                logger.warning("Swipe iteration %d failed: %s", i, exc)
                errors += 1
                continue

        new_matches = self.check_new_matches()
        return {"liked": liked, "passed": passed, "errors": errors, "new_matches": new_matches}

    # ------------------------------------------------------------------
    # Match detection
    # ------------------------------------------------------------------

    def check_new_matches(self) -> list[dict]:
        """Return new conversations (matches) from GET /v1/me/conversations."""
        data = self._api_get(CONVERSATIONS_PATH)
        if not data:
            return []

        conversations = data if isinstance(data, list) else data.get("conversations", [])
        matches: list[dict] = []

        for conv in conversations:
            try:
                # A conversation with no messages yet = fresh match
                messages = conv.get("messages") or []
                if not messages:
                    matches.append({
                        "match_id": str(conv.get("conversationId") or conv.get("id", "")),
                        "name": conv.get("displayName") or conv.get("name") or "Unknown",
                    })
            except Exception:
                continue

        logger.info("Found %d new matches on Grindr.", len(matches))
        return matches

    # ------------------------------------------------------------------
    # Messaging
    # ------------------------------------------------------------------

    def send_message(self, match_id: str, message: str) -> bool:
        """Send a message to a match via XMPP (SDK) or REST fallback.

        Returns True on success, False on failure.
        """
        # Prefer SDK XMPP path if available
        if self._session is not None and hasattr(self._session, "sendMessage"):
            try:
                self._session.sendMessage(match_id, message)
                logger.info("Message sent to %s via XMPP.", match_id)
                return True
            except Exception as exc:
                logger.warning("XMPP sendMessage failed: %s — trying REST.", exc)

        # REST fallback: POST to conversation messages endpoint
        try:
            result = self._api_post(
                f"/v1/conversations/{match_id}/messages",
                {"body": message, "type": "text"},
            )
            if result is not None:
                logger.info("Message sent to %s via REST.", match_id)
                return True
        except Exception as exc:
            logger.error("REST message to %s failed: %s", match_id, exc)

        return False

    # ------------------------------------------------------------------
    # Compatibility helpers
    # ------------------------------------------------------------------

    def get_matches(self, count: int = 20) -> list[dict]:
        """Return up to `count` recent conversations/matches."""
        data = self._api_get(CONVERSATIONS_PATH) or {}
        conversations = data if isinstance(data, list) else data.get("conversations", [])
        return [
            {
                "match_id": str(c.get("conversationId") or c.get("id", "")),
                "name": c.get("displayName") or c.get("name") or "Unknown",
            }
            for c in conversations[:count]
        ]
