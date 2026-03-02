"""Feeld client — GraphQL API with JWT authentication (ENM/polyamory focused)."""
from __future__ import annotations

import logging
import random
import time

from clapcheeks.session.rate_limiter import can_swipe, record_swipe, get_daily_summary

logger = logging.getLogger(__name__)

# Expected DAILY_LIMITS entry in clapcheeks/session/rate_limiter.py:
#   "feeld": {"right": 50, "left": 200, "messages": 20},
# Conservative daily limit — smaller user base, tighter anti-bot detection.

FEELD_GRAPHQL_URL = "https://api.feeld.co/graphql"
DEFAULT_DAILY_RIGHT_LIMIT = 50

LOGIN_MUTATION = """
mutation LoginMutation($email: String!, $password: String!) {
  login(input: { email: $email, password: $password }) {
    token
    user {
      id
      displayName
    }
  }
}
"""

DESIRES_FEED_QUERY = """
query DesiresFeedQuery($limit: Int) {
  desiresFeed(limit: $limit) {
    profiles {
      id
      displayName
      age
    }
  }
}
"""

LIKE_MUTATION = """
mutation LikeProfileMutation($profileId: ID!) {
  likeProfile(profileId: $profileId) {
    success
    isMatch
  }
}
"""

PASS_MUTATION = """
mutation PassProfileMutation($profileId: ID!) {
  passProfile(profileId: $profileId) {
    success
  }
}
"""

CONNECTIONS_QUERY = """
query ConnectionsQuery($limit: Int) {
  connections(limit: $limit) {
    connections {
      id
      displayName
      lastMessage {
        body
      }
    }
  }
}
"""

SEND_MESSAGE_MUTATION = """
mutation SendMessageMutation($connectionId: ID!, $body: String!) {
  sendMessage(connectionId: $connectionId, body: $body) {
    id
  }
}
"""


class FeeldClient:
    """Automate Feeld liking/passing via GraphQL API."""

    def __init__(self, driver=None) -> None:
        # driver accepted for interface consistency but not used (GraphQL-based)
        self.driver = driver
        self._token: str | None = None
        self._my_id: str | None = None

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def login(self, email: str, password: str) -> bool:
        """Authenticate with Feeld and store the JWT token.

        Returns True on success, False on failure.
        """
        result = self._graphql(LOGIN_MUTATION, {"email": email, "password": password}, auth=False)
        if not result:
            logger.error("Feeld login GraphQL call failed.")
            return False

        login_data = result.get("data", {}).get("login", {})
        self._token = login_data.get("token")
        user = login_data.get("user", {})
        self._my_id = str(user.get("id", ""))

        if not self._token:
            logger.error("Feeld login response missing token: %s", login_data)
            return False

        logger.info("Feeld login succeeded. User ID: %s", self._my_id)
        return True

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _headers(self, auth: bool = True) -> dict:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Feeld/4.0.0 (iPhone; iOS 16.0)",
        }
        if auth and self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _graphql(
        self,
        query: str,
        variables: dict | None = None,
        auth: bool = True,
    ) -> dict | None:
        """Execute a GraphQL operation against Feeld's endpoint."""
        try:
            import requests

            resp = requests.post(
                FEELD_GRAPHQL_URL,
                headers=self._headers(auth=auth),
                json={"query": query, "variables": variables or {}},
                timeout=20,
            )
            resp.raise_for_status()
            data = resp.json()
            errors = data.get("errors")
            if errors:
                logger.warning("Feeld GraphQL errors: %s", errors)
            return data
        except Exception as exc:
            logger.warning("Feeld GraphQL request failed: %s", exc)
            return None

    @staticmethod
    def _jitter_delay() -> None:
        """Gaussian jitter delay between swipes — clamped to 2-18 seconds.

        Slightly longer mean than other platforms due to smaller user base
        and tighter anti-bot detection on Feeld.
        """
        delay = random.gauss(7, 3.0)
        time.sleep(max(2.0, min(18.0, delay)))

    # ------------------------------------------------------------------
    # Swipe session
    # ------------------------------------------------------------------

    def run_swipe_session(
        self,
        like_ratio: float = 0.5,
        max_swipes: int = 30,
    ) -> dict:
        """Fetch desires feed and like/pass profiles.

        Returns a stats dict: {liked, passed, errors, new_matches}.
        """
        if not self._token:
            logger.error("Not logged in. Call login() first.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        # Rate-limit check — conservative on Feeld (50 right/day)
        daily = get_daily_summary() or {}
        used_right = daily.get("feeld_right", 0)
        remaining = max(0, DEFAULT_DAILY_RIGHT_LIMIT - used_right)
        effective_max = min(max_swipes, remaining + max_swipes)

        if remaining <= 0:
            logger.warning("Daily like limit reached for Feeld (%d/day).", DEFAULT_DAILY_RIGHT_LIMIT)

        liked = 0
        passed = 0
        errors = 0

        # Fetch desires feed
        feed_data = self._graphql(DESIRES_FEED_QUERY, {"limit": effective_max})
        if not feed_data:
            logger.warning("Could not fetch Feeld desires feed.")
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        profiles = feed_data.get("data", {}).get("desiresFeed", {}).get("profiles", [])

        for i, profile in enumerate(profiles[:effective_max]):
            try:
                profile_id = str(profile.get("id", ""))
                display_name = profile.get("displayName") or "Unknown"

                if not profile_id:
                    continue

                do_like = random.random() < like_ratio

                if do_like and can_swipe("feeld", "right"):
                    result = self._graphql(LIKE_MUTATION, {"profileId": profile_id})
                    if result is not None:
                        liked += 1
                        record_swipe("feeld", "right")
                        is_match = result.get("data", {}).get("likeProfile", {}).get("isMatch", False)
                        if is_match:
                            logger.info("Mutual match with %s on Feeld!", display_name)
                        logger.debug("Liked %s on Feeld.", display_name)
                    else:
                        errors += 1
                else:
                    result = self._graphql(PASS_MUTATION, {"profileId": profile_id})
                    if result is not None:
                        passed += 1
                        record_swipe("feeld", "left")
                        logger.debug("Passed %s on Feeld.", display_name)
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
        """Return connections with no messages yet (fresh matches)."""
        data = self._graphql(CONNECTIONS_QUERY, {"limit": 50})
        if not data:
            return []

        connections = data.get("data", {}).get("connections", {}).get("connections", [])
        new_matches: list[dict] = []

        for conn in connections:
            try:
                last_msg = conn.get("lastMessage") or {}
                if not last_msg.get("body"):
                    new_matches.append({
                        "match_id": str(conn.get("id", "")),
                        "name": conn.get("displayName") or "Unknown",
                    })
            except Exception:
                continue

        logger.info("Found %d new matches on Feeld.", len(new_matches))
        return new_matches

    # ------------------------------------------------------------------
    # Messaging
    # ------------------------------------------------------------------

    def send_message(self, match_id: str, message: str) -> bool:
        """Send a message to a connection (match_id = connection ID).

        Returns True on success, False on failure.
        """
        try:
            result = self._graphql(
                SEND_MESSAGE_MUTATION,
                {"connectionId": match_id, "body": message},
            )
            if result and result.get("data", {}).get("sendMessage", {}).get("id"):
                logger.info("Message sent to connection %s on Feeld.", match_id)
                return True
            logger.warning("Feeld sendMessage returned no id for %s.", match_id)
        except Exception as exc:
            logger.error("send_message to %s on Feeld failed: %s", match_id, exc)
        return False
