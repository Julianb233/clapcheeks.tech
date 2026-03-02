"""Coffee Meets Bagel (CMB) client — REST API with phone/OTP authentication."""
from __future__ import annotations

import logging
import random
import time

from clapcheeks.session.rate_limiter import can_swipe, record_swipe, get_daily_summary

logger = logging.getLogger(__name__)

# Expected DAILY_LIMITS entry in clapcheeks/session/rate_limiter.py:
#   "cmb": {"right": 21, "left": 21, "messages": 21},
# Hard cap: CMB delivers exactly 21 bagels per day, refreshed at noon.

CMB_API_BASE = "https://api.coffeemeetsbagel.com"
PHONE_AUTH_PATH = "/auth/phone"
VERIFY_OTP_PATH = "/auth/verify"
BAGELS_PATH = "/bagels"
LIKE_PATH = "/bagels/{bagel_id}/like"
PASS_PATH = "/bagels/{bagel_id}/pass"
CONVERSATIONS_PATH = "/conversations"
MESSAGES_PATH = "/conversations/{conv_id}/messages"
ME_PATH = "/users/me"

DEFAULT_DAILY_RIGHT_LIMIT = 21  # Hard CMB cap — only 21 bagels per day


class CMBClient:
    """Automate Coffee Meets Bagel liking/passing via REST API."""

    def __init__(self, driver=None, proxy_manager=None) -> None:
        # driver accepted for interface consistency but not used (REST-based)
        self.driver = driver
        self._proxy_manager = proxy_manager
        self._token: str | None = None
        self._my_id: str | None = None

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def login(self, phone: str) -> str:
        """Initiate phone number authentication.

        Sends an OTP to the provided phone number.

        Args:
            phone: Phone number in E.164 format (e.g., "+15551234567").

        Returns a prompt string instructing the caller to call verify_otp().
        On failure returns an error message string.
        """
        try:
            import requests

            resp = requests.post(
                f"{CMB_API_BASE}{PHONE_AUTH_PATH}",
                json={"phone": phone},
                headers={"Content-Type": "application/json"},
                proxies=self._proxies(),
                timeout=15,
            )
            resp.raise_for_status()
            logger.info("CMB OTP sent to %s.", phone)
            return f"OTP sent to {phone}. Call verify_otp(phone, otp) with the code."
        except Exception as exc:
            logger.error("CMB phone auth failed for %s: %s", phone, exc)
            return f"ERROR: Could not send OTP to {phone}: {exc}"

    def verify_otp(self, phone: str, otp: str) -> bool:
        """Verify the OTP and store the session token.

        Args:
            phone: The same phone number used in login().
            otp:   The one-time password received via SMS.

        Returns True on success, False on failure.
        """
        try:
            import requests

            resp = requests.post(
                f"{CMB_API_BASE}{VERIFY_OTP_PATH}",
                json={"phone": phone, "otp": otp},
                headers={"Content-Type": "application/json"},
                proxies=self._proxies(),
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data.get("token") or data.get("access_token")

            if not self._token:
                logger.error("CMB OTP verification response missing token: %s", data)
                return False

            # Fetch own profile
            me_resp = requests.get(
                f"{CMB_API_BASE}{ME_PATH}",
                headers=self._headers(),
                proxies=self._proxies(),
                timeout=10,
            )
            me_resp.raise_for_status()
            me_data = me_resp.json()
            self._my_id = str(me_data.get("id", me_data.get("user_id", "")))

            logger.info("CMB login verified. My ID: %s", self._my_id)
            return True

        except Exception as exc:
            logger.error("CMB OTP verification failed: %s", exc)
            return False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _proxies(self) -> dict | None:
        if self._proxy_manager:
            p = self._proxy_manager.get_proxy("cmb")
            return p.requests_dict if p else None
        return None

    def _headers(self) -> dict:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "CoffeeMeetsBagel/7.0.0 (iPhone; iOS 16.0)",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _api_get(self, path: str, params: dict | None = None) -> dict | list | None:
        try:
            import requests

            resp = requests.get(
                f"{CMB_API_BASE}{path}",
                headers=self._headers(),
                params=params or {},
                proxies=self._proxies(),
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
                f"{CMB_API_BASE}{path}",
                headers=self._headers(),
                json=body or {},
                proxies=self._proxies(),
                timeout=15,
            )
            resp.raise_for_status()
            if resp.status_code == 204 or not resp.content:
                return {}
            return resp.json()
        except Exception as exc:
            logger.warning("POST %s failed: %s", path, exc)
            return None

    @staticmethod
    def _jitter_delay() -> None:
        """Gaussian jitter delay between actions — clamped to 2-18 seconds.

        Slightly longer mean since CMB delivers just 21 bagels per day —
        there is no benefit to rushing through them.
        """
        delay = random.gauss(8, 3.0)
        time.sleep(max(2.0, min(18.0, delay)))

    # ------------------------------------------------------------------
    # Swipe session
    # ------------------------------------------------------------------

    def run_swipe_session(
        self,
        like_ratio: float = 0.8,
        max_swipes: int = 21,
    ) -> dict:
        """Fetch today's bagels and like/pass each one.

        Default like_ratio is 0.8 (80%) because CMB bagels are curated matches —
        they are intended to be liked more often than random swipes.
        Hard cap: 21 bagels/day regardless of max_swipes.

        Returns a stats dict: {liked, passed, errors, new_matches}.
        """
        if not self._token:
            logger.error("Not logged in. Call login(phone) then verify_otp() first.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        # Rate-limit check — hard 21/day cap
        daily = get_daily_summary() or {}
        used_right = daily.get("cmb_right", 0)
        used_left = daily.get("cmb_left", 0)
        used_total = used_right + used_left
        remaining = max(0, DEFAULT_DAILY_RIGHT_LIMIT - used_total)
        effective_max = min(max_swipes, remaining, DEFAULT_DAILY_RIGHT_LIMIT)

        if effective_max <= 0:
            logger.warning(
                "Daily bagel limit reached for CMB (%d/day). "
                "Bagels refresh at noon.",
                DEFAULT_DAILY_RIGHT_LIMIT,
            )
            return {"liked": 0, "passed": 0, "errors": 0, "new_matches": []}

        liked = 0
        passed = 0
        errors = 0

        # GET /bagels — daily curated list
        bagels_data = self._api_get(BAGELS_PATH)
        if not bagels_data:
            logger.warning("Could not fetch CMB bagels.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        bagels = bagels_data if isinstance(bagels_data, list) else bagels_data.get("bagels", [])

        for i, bagel in enumerate(bagels[:effective_max]):
            try:
                bagel_id = str(bagel.get("id") or bagel.get("bagel_id", ""))
                display_name = bagel.get("name") or bagel.get("display_name") or "Unknown"

                if not bagel_id:
                    logger.debug("Skipping bagel with no ID at index %d.", i)
                    continue

                do_like = random.random() < like_ratio

                if do_like and can_swipe("cmb", "right"):
                    path = LIKE_PATH.format(bagel_id=bagel_id)
                    result = self._api_post(path)
                    if result is not None:
                        liked += 1
                        record_swipe("cmb", "right")
                        logger.debug("Liked bagel %s (%s) on CMB.", bagel_id, display_name)
                    else:
                        errors += 1
                else:
                    path = PASS_PATH.format(bagel_id=bagel_id)
                    result = self._api_post(path)
                    if result is not None:
                        passed += 1
                        record_swipe("cmb", "left")
                        logger.debug("Passed bagel %s (%s) on CMB.", bagel_id, display_name)
                    else:
                        errors += 1

                self._jitter_delay()

            except Exception as exc:
                logger.warning("Bagel iteration %d failed: %s", i, exc)
                errors += 1
                continue

        new_matches = self.check_new_matches()
        return {"liked": liked, "passed": passed, "errors": errors, "new_matches": new_matches}

    # ------------------------------------------------------------------
    # Match detection
    # ------------------------------------------------------------------

    def check_new_matches(self) -> list[dict]:
        """Return conversations with no messages yet (fresh mutual likes)."""
        data = self._api_get(CONVERSATIONS_PATH)
        if not data:
            return []

        conversations = data if isinstance(data, list) else data.get("conversations", [])
        new_matches: list[dict] = []

        for conv in conversations:
            try:
                messages = conv.get("messages") or []
                if not messages:
                    other = conv.get("bagel") or conv.get("match") or {}
                    new_matches.append({
                        "match_id": str(conv.get("id") or conv.get("conversation_id", "")),
                        "name": other.get("name") or other.get("display_name") or "Unknown",
                    })
            except Exception:
                continue

        logger.info("Found %d new matches on CMB.", len(new_matches))
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
            result = self._api_post(path, {"body": message})
            if result is not None:
                logger.info("Message sent to conversation %s on CMB.", match_id)
                return True
            logger.warning("CMB send_message returned None for conversation %s.", match_id)
        except Exception as exc:
            logger.error("send_message to %s on CMB failed: %s", match_id, exc)
        return False
