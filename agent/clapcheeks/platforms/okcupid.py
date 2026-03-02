"""OKCupid client — GraphQL API with JWT authentication."""
from __future__ import annotations

import logging
import random
import time

from clapcheeks.session.rate_limiter import can_swipe, record_swipe, get_daily_summary

logger = logging.getLogger(__name__)

# Expected DAILY_LIMITS entry in clapcheeks/session/rate_limiter.py:
#   "okcupid": {"right": 100, "left": 300, "messages": 30},

OKC_GRAPHQL_URL = "https://www.okcupid.com/graphql"
DEFAULT_DAILY_RIGHT_LIMIT = 100

# GraphQL operation strings — OKCupid uses named operations over a single endpoint
LOGIN_MUTATION = """
mutation LoginMutation($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    oauth_token
    user {
      userid
      username
    }
  }
}
"""

QUICKMATCH_MUTATION = """
mutation QuickMatchLikeMutation($userid: String!, $action: String!) {
  quickMatchLike(userid: $userid, action: $action) {
    result
    mutual_like
  }
}
"""

QUICKMATCH_QUERY = """
query QuickMatchQuery($limit: Int) {
  quickmatch(limit: $limit) {
    profiles {
      userid
      username
      displayname
    }
  }
}
"""

MATCHES_QUERY = """
query MatchesQuery($limit: Int) {
  matches(limit: $limit) {
    matches {
      userid
      username
      displayname
      last_message {
        body
      }
    }
  }
}
"""

SEND_MESSAGE_MUTATION = """
mutation SendMessageMutation($userid: String!, $body: String!) {
  sendMessage(userid: $userid, body: $body) {
    messageid
  }
}
"""


class OKCupidClient:
    """Automate OKCupid liking/passing via GraphQL API."""

    def __init__(self, driver=None) -> None:
        # driver accepted for interface consistency but not used (REST/GraphQL-based)
        self.driver = driver
        self._token: str | None = None
        self._my_userid: str | None = None

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def login(self, email: str, password: str) -> bool:
        """Authenticate and store JWT bearer token.

        Returns True on success, False on failure.
        """
        result = self._graphql(LOGIN_MUTATION, {"email": email, "password": password}, auth=False)
        if not result:
            logger.error("OKCupid login GraphQL call failed.")
            return False

        login_data = result.get("data", {}).get("login", {})
        self._token = login_data.get("oauth_token")
        user = login_data.get("user", {})
        self._my_userid = str(user.get("userid", ""))

        if not self._token:
            logger.error("OKCupid login response missing oauth_token: %s", login_data)
            return False

        logger.info("OKCupid login succeeded. User ID: %s", self._my_userid)
        return True

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _headers(self) -> dict:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "OkCupid/73.0.0 (iPhone; iOS 16.0)",
            "x-okcupid-platform": "DESKTOP",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _graphql(
        self,
        query: str,
        variables: dict | None = None,
        auth: bool = True,
    ) -> dict | None:
        """Execute a GraphQL operation against OKCupid's endpoint."""
        try:
            import requests

            headers = self._headers() if auth else {
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
            resp = requests.post(
                OKC_GRAPHQL_URL,
                headers=headers,
                json={"query": query, "variables": variables or {}},
                timeout=20,
            )
            resp.raise_for_status()
            data = resp.json()
            errors = data.get("errors")
            if errors:
                logger.warning("GraphQL errors: %s", errors)
            return data
        except Exception as exc:
            logger.warning("GraphQL request failed: %s", exc)
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
        """Fetch quick-match profiles and like/pass each one.

        Returns a stats dict: {liked, passed, errors, new_matches}.
        """
        if not self._token:
            logger.error("Not logged in. Call login() first.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        # Rate-limit check
        daily = get_daily_summary() or {}
        used_right = daily.get("okcupid_right", 0)
        remaining = max(0, DEFAULT_DAILY_RIGHT_LIMIT - used_right)
        effective_max = min(max_swipes, remaining + max_swipes)

        if remaining <= 0:
            logger.warning("Daily like limit reached for OKCupid (%d/day).", DEFAULT_DAILY_RIGHT_LIMIT)

        liked = 0
        passed = 0
        errors = 0

        # Fetch quick-match profiles
        qm_data = self._graphql(QUICKMATCH_QUERY, {"limit": effective_max})
        if not qm_data:
            logger.warning("Could not fetch OKCupid quick-match profiles.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        profiles = qm_data.get("data", {}).get("quickmatch", {}).get("profiles", [])

        for i, profile in enumerate(profiles[:effective_max]):
            try:
                userid = str(profile.get("userid", ""))
                display_name = profile.get("displayname") or profile.get("username") or "Unknown"

                if not userid:
                    continue

                do_like = random.random() < like_ratio
                action = "LIKE" if (do_like and can_swipe("okcupid", "right")) else "PASS"

                result = self._graphql(
                    QUICKMATCH_MUTATION,
                    {"userid": userid, "action": action},
                )
                if result is not None:
                    if action == "LIKE":
                        liked += 1
                        record_swipe("okcupid", "right")
                        # Check for mutual like
                        mutual = result.get("data", {}).get("quickMatchLike", {}).get("mutual_like", False)
                        if mutual:
                            logger.info("Mutual match with %s on OKCupid!", display_name)
                    else:
                        passed += 1
                        record_swipe("okcupid", "left")
                    logger.debug("%s %s on OKCupid.", action, display_name)
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
        """Return matches with no messages yet (fresh matches needing an opener)."""
        data = self._graphql(MATCHES_QUERY, {"limit": 50})
        if not data:
            return []

        matches_list = data.get("data", {}).get("matches", {}).get("matches", [])
        new_matches: list[dict] = []

        for m in matches_list:
            try:
                last_msg = m.get("last_message") or {}
                if not last_msg.get("body"):
                    new_matches.append({
                        "match_id": str(m.get("userid", "")),
                        "name": m.get("displayname") or m.get("username") or "Unknown",
                    })
            except Exception:
                continue

        logger.info("Found %d new matches on OKCupid.", len(new_matches))
        return new_matches

    # ------------------------------------------------------------------
    # Messaging
    # ------------------------------------------------------------------

    def send_message(self, match_id: str, message: str) -> bool:
        """Send a message to a match (match_id = target user ID).

        Returns True on success, False on failure.
        """
        try:
            result = self._graphql(
                SEND_MESSAGE_MUTATION,
                {"userid": match_id, "body": message},
            )
            if result and result.get("data", {}).get("sendMessage", {}).get("messageid"):
                logger.info("Message sent to %s on OKCupid.", match_id)
                return True
            logger.warning("OKCupid sendMessage returned no messageid for %s.", match_id)
        except Exception as exc:
            logger.error("send_message to %s failed: %s", match_id, exc)
        return False
