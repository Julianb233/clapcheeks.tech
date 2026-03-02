"""Hinge automation — REST API primary, Playwright driver fallback."""
from __future__ import annotations

import logging
import random
from pathlib import Path

import requests

from clapcheeks.session.rate_limiter import can_swipe, record_swipe, sleep_jitter

logger = logging.getLogger(__name__)

HINGE_API = "https://prod-api.hingeaws.net"
TOKEN_FILE = Path.home() / ".clapcheeks" / "hinge_token.txt"


class HingeClient:
    """Hinge automation — REST API with Playwright driver fallback."""

    def __init__(self, driver=None, ai_service_url: str | None = None) -> None:
        self._driver = driver
        self._ai_service_url = ai_service_url
        self._token: str | None = self._load_token()
        self._session = requests.Session()
        if self._token:
            self._session.headers.update({
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
                "X-App-Version": "9.0.0",
                "User-Agent": "Hinge/9.0.0 (iPhone; iOS 17.0)",
            })

    def _load_token(self) -> str | None:
        if TOKEN_FILE.exists():
            t = TOKEN_FILE.read_text().strip()
            return t if t else None
        return None

    def _save_token(self, token: str) -> None:
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(token)

    def get_recommendations(self) -> list[dict]:
        if not self._token:
            return []
        try:
            resp = self._session.get(f"{HINGE_API}/users/feed", params={"limit": 20}, timeout=15)
            if resp.status_code == 401:
                logger.warning("Hinge token expired.")
                return []
            resp.raise_for_status()
            return resp.json().get("results", [])
        except Exception as exc:
            logger.error("Hinge get_recommendations failed: %s", exc)
            return []

    def _generate_comment(self, profile: dict) -> str:
        """Generate an AI comment for a Hinge like based on profile content."""
        if not self._ai_service_url:
            return ""
        prompt_text = ""
        for key in ("prompts", "answers", "questions"):
            items = profile.get(key, [])
            if items:
                item = items[0]
                prompt_text = item.get("answer", "") or item.get("body", "") or ""
                if prompt_text:
                    break
        if not prompt_text:
            return ""
        try:
            resp = requests.post(
                f"{self._ai_service_url}/reply/suggest",
                json={
                    "platform": "hinge",
                    "conversation": [{"role": "user", "content": f"Profile prompt: {prompt_text}"}],
                    "style_description": "genuine, specific, not generic — reference something in their profile",
                    "contact_name": None,
                },
                timeout=10,
            )
            resp.raise_for_status()
            return resp.json().get("suggestion", "")[:150]
        except Exception:
            return ""

    def like_profile(self, subject_id: str, comment: str = "") -> bool:
        if not can_swipe("hinge", "right"):
            return False
        try:
            payload: dict = {"subject_id": subject_id}
            if comment:
                payload["comment"] = comment
            resp = self._session.post(f"{HINGE_API}/likes", json=payload, timeout=10)
            if resp.status_code in (200, 201):
                record_swipe("hinge", "right")
                return True
        except Exception as exc:
            logger.error("Hinge like failed: %s", exc)
        return False

    def skip_profile(self, subject_id: str) -> bool:
        if not can_swipe("hinge", "left"):
            return False
        try:
            resp = self._session.delete(f"{HINGE_API}/users/feed/{subject_id}", timeout=10)
            if resp.status_code in (200, 204):
                record_swipe("hinge", "left")
                return True
        except Exception as exc:
            logger.error("Hinge skip failed: %s", exc)
        return False

    def get_matches(self, count: int = 20) -> list[dict]:
        if not self._token:
            return []
        try:
            resp = self._session.get(f"{HINGE_API}/matches", params={"limit": count}, timeout=15)
            resp.raise_for_status()
            return resp.json().get("matches", [])
        except Exception:
            return []

    def send_message(self, match_id: str, message: str) -> bool:
        if not self._token:
            return False
        try:
            resp = self._session.post(
                f"{HINGE_API}/matches/{match_id}/messages",
                json={"message": message},
                timeout=15,
            )
            return resp.status_code in (200, 201)
        except Exception as exc:
            logger.error("Hinge send_message failed: %s", exc)
            return False

    def run_swipe_session(self, like_ratio: float = 0.45, max_swipes: int = 25, ai_comments: bool = True) -> dict:
        results = {"liked": 0, "passed": 0, "commented": 0, "errors": 0, "new_matches": []}
        if self._token:
            profiles = self.get_recommendations()
            for profile in profiles[:max_swipes]:
                subject_id = profile.get("_id") or profile.get("id")
                if not subject_id:
                    continue
                should_like = random.random() < like_ratio
                if should_like:
                    comment = ""
                    if ai_comments and random.random() < 0.3:
                        comment = self._generate_comment(profile)
                    success = self.like_profile(subject_id, comment)
                    if success:
                        results["liked"] += 1
                        if comment:
                            results["commented"] += 1
                    else:
                        results["errors"] += 1
                else:
                    self.skip_profile(subject_id)
                    results["passed"] += 1
                sleep_jitter("swipe")
        elif self._driver:
            logger.info("No Hinge token — using driver fallback")
            for _ in range(max_swipes):
                should_like = random.random() < like_ratio
                if should_like:
                    if hasattr(self._driver, "swipe_right"):
                        self._driver.swipe_right()
                    record_swipe("hinge", "right")
                    results["liked"] += 1
                else:
                    if hasattr(self._driver, "swipe_left"):
                        self._driver.swipe_left()
                    record_swipe("hinge", "left")
                    results["passed"] += 1
                sleep_jitter("swipe")
        return results
