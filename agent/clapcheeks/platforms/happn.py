"""Happn client — REST API with Facebook OAuth authentication."""
from __future__ import annotations

import logging
import random
import time

from clapcheeks.session.rate_limiter import can_swipe, record_swipe, get_daily_summary
from clapcheeks.session.ban_detector import check_response_for_ban

logger = logging.getLogger(__name__)

# Expected DAILY_LIMITS entry in clapcheeks/session/rate_limiter.py:
#   "happn": {"right": 100, "left": 300, "messages": 30},

HAPPN_API_BASE = "https://api.happn.com"
OAUTH_PATH = "/connect/oauth/token"
RECS_PATH = "/api/users/me/recs"
ACCEPT_PATH = "/api/users/{my_id}/accepted/{target_id}"
REJECT_PATH = "/api/users/{my_id}/rejected/{target_id}"
CONVERSATIONS_PATH = "/api/users/me/conversations"
MESSAGES_PATH = "/api/conversations/{conv_id}/messages"
ME_PATH = "/api/users/me"

DEFAULT_DAILY_RIGHT_LIMIT = 100

# Happn OAuth client credentials (public/well-known)
HAPPN_CLIENT_ID = "FUE-idSEP-f7AqCyuMcPr2K-1iCIU_YlvK-M-im3c"
HAPPN_CLIENT_SECRET = "brGoHSwZsPjJ-lB3HIKM29oOalkS4KiTly8T-pjv"


class HappnClient:
    """Automate Happn liking/passing via REST API with Facebook OAuth."""

    def __init__(self, fb_token: str | None = None, driver=None, proxy_manager=None) -> None:
        # driver accepted for interface consistency but not used (REST-based)
        self.driver = driver
        self._proxy_manager = proxy_manager
        self._fb_token = fb_token
        self._access_token: str | None = None
        self._my_id: str | None = None

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def login(self, fb_token: str) -> bool:
        """Exchange a Facebook OAuth token for a Happn session token.

        Args:
            fb_token: Facebook OAuth access token obtained outside this module.

        Returns True on success, False on failure.
        """
        self._fb_token = fb_token
        try:
            import requests

            resp = requests.post(
                f"{HAPPN_API_BASE}{OAUTH_PATH}",
                data={
                    "client_id": HAPPN_CLIENT_ID,
                    "client_secret": HAPPN_CLIENT_SECRET,
                    "grant_type": "assertion",
                    "assertion_type": "facebook_access_token",
                    "assertion": fb_token,
                    "scope": "mobile_app",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                proxies=self._proxies(),
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            self._access_token = data.get("access_token")

            if not self._access_token:
                logger.error("Happn OAuth response missing access_token: %s", data)
                return False

            # Fetch own profile ID
            me_resp = requests.get(
                f"{HAPPN_API_BASE}{ME_PATH}",
                headers=self._headers(),
                proxies=self._proxies(),
                timeout=10,
            )
            me_resp.raise_for_status()
            me_data = me_resp.json()
            self._my_id = str(me_data.get("data", {}).get("id", ""))

            logger.info("Happn login succeeded. My ID: %s", self._my_id)
            return bool(self._my_id)

        except Exception as exc:
            logger.error("Happn login failed: %s", exc)
            return False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _proxies(self) -> dict | None:
        if self._proxy_manager:
            p = self._proxy_manager.get_proxy("happn")
            return p.requests_dict if p else None
        return None

    def _headers(self) -> dict:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Happn/24.1.0 (iPhone; iOS 16.0)",
        }
        if self._access_token:
            headers["Authorization"] = f"OAuth='{self._access_token}'"
        return headers

    def _api_get(self, path: str, params: dict | None = None) -> dict | None:
        try:
            import requests

            resp = requests.get(
                f"{HAPPN_API_BASE}{path}",
                headers=self._headers(),
                params=params or {},
                proxies=self._proxies(),
                timeout=15,
            )
            check_response_for_ban("happn", resp.status_code, resp.text)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.warning("GET %s failed: %s", path, exc)
            return None

    def _api_post(self, path: str, body: dict | None = None) -> dict | None:
        try:
            import requests

            resp = requests.post(
                f"{HAPPN_API_BASE}{path}",
                headers=self._headers(),
                json=body or {},
                proxies=self._proxies(),
                timeout=15,
            )
            check_response_for_ban("happn", resp.status_code, resp.text)
            resp.raise_for_status()
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
        like_ratio: float = 0.5,
        max_swipes: int = 30,
    ) -> dict:
        """Fetch recommendations and like/pass profiles.

        Returns a stats dict: {liked, passed, errors, new_matches}.
        """
        if not self._access_token or not self._my_id:
            logger.error("Not logged in. Call login(fb_token) first.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        # Rate-limit check
        daily = get_daily_summary() or {}
        used_right = daily.get("happn_right", 0)
        remaining = max(0, DEFAULT_DAILY_RIGHT_LIMIT - used_right)
        effective_max = min(max_swipes, remaining + max_swipes)

        if remaining <= 0:
            logger.warning("Daily like limit reached for Happn (%d/day).", DEFAULT_DAILY_RIGHT_LIMIT)

        liked = 0
        passed = 0
        errors = 0

        # GET /api/users/me/recs
        recs_data = self._api_get(RECS_PATH, params={"limit": effective_max, "offset": 0})
        if not recs_data:
            logger.warning("Could not fetch Happn recommendations.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        profiles = recs_data.get("data", [])

        for i, profile in enumerate(profiles[:effective_max]):
            try:
                target_id = str(profile.get("id") or profile.get("notifier", {}).get("id", ""))
                if not target_id:
                    continue

                do_like = random.random() < like_ratio

                if do_like and can_swipe("happn", "right"):
                    path = ACCEPT_PATH.format(my_id=self._my_id, target_id=target_id)
                    result = self._api_post(path)
                    if result is not None:
                        liked += 1
                        record_swipe("happn", "right")
                        logger.debug("Liked profile %s on Happn.", target_id)
                    else:
                        errors += 1
                else:
                    path = REJECT_PATH.format(my_id=self._my_id, target_id=target_id)
                    result = self._api_post(path)
                    if result is not None:
                        passed += 1
                        record_swipe("happn", "left")
                    else:
                        errors += 1

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
        """Return conversations with no messages yet (fresh matches)."""
        data = self._api_get(CONVERSATIONS_PATH)
        if not data:
            return []

        conversations = data.get("data", [])
        new_matches: list[dict] = []

        for conv in conversations:
            try:
                messages = conv.get("messages") or []
                if not messages:
                    other = conv.get("participants", [{}])[0]
                    new_matches.append({
                        "match_id": str(conv.get("id", "")),
                        "name": other.get("first_name") or other.get("display_name") or "Unknown",
                    })
            except Exception:
                continue

        logger.info("Found %d new matches on Happn.", len(new_matches))
        return new_matches

    # ------------------------------------------------------------------
    # Messaging
    # ------------------------------------------------------------------

    def send_message(self, match_id: str, message: str) -> bool:
        """Send a message to a conversation (match_id = conversation ID).

        Returns True on success, False on failure.
        """
        try:
            path = MESSAGES_PATH.format(conv_id=match_id)
            result = self._api_post(path, {"message": message})
            if result is not None:
                logger.info("Message sent to conversation %s on Happn.", match_id)
                return True
        except Exception as exc:
            logger.error("send_message to %s failed: %s", match_id, exc)
        return False
