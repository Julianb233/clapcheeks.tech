"""Conversation manager — drives the match → opener → reply → date funnel."""
from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

import requests

from outward.session.rate_limiter import sleep_jitter

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class ConversationManager:
    """Orchestrates the full funnel: new match → AI opener → replies → date booking."""

    STAGES = ["new", "opened", "replied", "date_set"]

    def __init__(self, platform_client, platform_name: str, config: dict) -> None:
        self._client = platform_client
        self._platform = platform_name
        self._ai_url = config.get("ai_service_url", "http://localhost:8000")
        self._style = self._load_style()
        self._dry_run = config.get("dry_run", False)

    def _load_style(self) -> str:
        """Load the user's writing style description if saved."""
        from pathlib import Path
        style_file = Path.home() / ".outward" / "style.txt"
        if style_file.exists():
            return style_file.read_text().strip()
        return "casual, direct, genuine, not trying too hard"

    def suggest_reply(
        self,
        conversation: list[dict],
        contact_name: str | None = None,
    ) -> str | None:
        """Call the AI service to generate a reply."""
        try:
            resp = requests.post(
                f"{self._ai_url}/reply/suggest",
                json={
                    "platform": self._platform,
                    "conversation": conversation,
                    "style_description": self._style,
                    "contact_name": contact_name,
                },
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json().get("suggestion", "").strip()
        except Exception as exc:
            logger.warning("AI service call failed: %s", exc)
            return None

    def get_new_matches(self) -> list[dict]:
        """Fetch matches that have no outgoing message yet (need opener)."""
        try:
            if hasattr(self._client, "check_new_matches"):
                return self._client.check_new_matches()
            return []
        except Exception as exc:
            logger.error("get_new_matches failed: %s", exc)
            return []

    def send_opener(self, match: dict) -> bool:
        """Generate and send an opening message to a new match."""
        match_id = match.get("match_id") or match.get("id")
        name = match.get("name") or match.get("match_name") or "them"

        opener = self.suggest_reply(conversation=[], contact_name=name)
        if not opener:
            logger.warning("Could not generate opener for %s", name)
            return False

        if self._dry_run:
            logger.info("[DRY RUN] Would send to %s: %s", name, opener)
            return True

        try:
            success = self._client.send_message(match_id, opener)
            if success:
                logger.info("Sent opener to %s: %s", name, opener)
            return success
        except Exception as exc:
            logger.error("send_opener failed for %s: %s", name, exc)
            return False

    def process_replies(self) -> dict:
        """Check for new replies and respond to them."""
        results = {"checked": 0, "replied": 0, "errors": 0}

        try:
            # Get matches with recent activity
            matches = self._client.get_matches(count=30) if hasattr(self._client, "get_matches") else []
        except Exception as exc:
            logger.error("get_matches failed: %s", exc)
            return results

        for match in matches:
            match_id = match.get("id") or match.get("match_id")
            name = match.get("person", {}).get("name") or match.get("match_name") or "them"
            messages = match.get("messages", [])

            if not messages:
                continue

            # Check if last message is from them (not us)
            last = messages[-1]
            if last.get("from_id") == "me" or last.get("role") == "assistant":
                continue  # We already replied last

            results["checked"] += 1

            # Build conversation history
            conversation = [
                {
                    "role": "assistant" if m.get("from_id") == "me" else "user",
                    "content": m.get("message", m.get("content", "")),
                }
                for m in messages[-10:]  # Last 10 messages for context
            ]

            reply = self.suggest_reply(conversation=conversation, contact_name=name)
            if not reply:
                results["errors"] += 1
                continue

            if self._dry_run:
                logger.info("[DRY RUN] Would reply to %s: %s", name, reply)
                results["replied"] += 1
                continue

            try:
                success = self._client.send_message(match_id, reply)
                if success:
                    results["replied"] += 1
                    sleep_jitter("message")
                else:
                    results["errors"] += 1
            except Exception as exc:
                logger.error("Reply to %s failed: %s", name, exc)
                results["errors"] += 1

        return results

    def run_loop(self) -> dict:
        """Run one full conversation management loop.

        1. Find new matches → send openers (with delays)
        2. Find unanswered replies → respond (with delays)
        """
        summary = {
            "openers_sent": 0,
            "replies_sent": 0,
            "errors": 0,
        }

        # Step 1: Send openers to new matches
        new_matches = self.get_new_matches()
        logger.info("Found %d new matches needing openers", len(new_matches))

        for match in new_matches[:10]:  # Cap at 10 openers per run
            success = self.send_opener(match)
            if success:
                summary["openers_sent"] += 1
            else:
                summary["errors"] += 1
            sleep_jitter("message")

        # Step 2: Reply to unread messages
        reply_results = self.process_replies()
        summary["replies_sent"] = reply_results["replied"]
        summary["errors"] += reply_results["errors"]

        return summary
