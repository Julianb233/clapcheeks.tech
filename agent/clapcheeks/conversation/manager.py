"""Conversation manager — drives the match → opener → reply → date funnel."""
from __future__ import annotations

import logging
import time

import requests

from clapcheeks.ai.date_ask import should_ask_for_date, generate_date_ask, generate_reengagement
from clapcheeks.conversation.state import get_conversation, update_conversation, get_stale_conversations
from clapcheeks.session.rate_limiter import sleep_jitter

logger = logging.getLogger(__name__)


class ConversationManager:
    """Orchestrates: new match → AI opener → replies → date booking."""

    def __init__(self, platform_client, platform_name: str, config: dict) -> None:
        self._client = platform_client
        self._platform = platform_name
        self._ai_url = config.get("ai_service_url", "http://localhost:8000")
        self._style = self._load_style()
        self._dry_run = config.get("dry_run", False)

    def _load_style(self) -> str:
        from pathlib import Path
        style_file = Path.home() / ".clapcheeks" / "style.txt"
        if style_file.exists():
            return style_file.read_text().strip()
        return "casual, direct, genuine, not trying too hard"

    def _analyze_match_style(self, messages: list[dict]) -> str:
        """Analyze match's writing style and return description for AI prompt."""
        try:
            from clapcheeks.nlp.style_analyzer import analyze_messages
            profile = analyze_messages(messages, role="user")
            return profile.to_prompt_description()
        except Exception:
            return "casual and conversational"

    def _get_persuasion_context(self, messages: list[dict]) -> str:
        """Get stage-appropriate persuasion instructions."""
        try:
            from clapcheeks.nlp.persuasion import detect_stage, PersuasionContext, get_persuasion_instructions
            from clapcheeks.nlp.style_analyzer import analyze_messages
            stage = detect_stage(messages)
            profile = analyze_messages(messages, role="user")
            ctx = PersuasionContext(
                stage=stage,
                match_energy=profile.energy_level,
                match_formality=profile.formality_score,
                days_since_match=0,
            )
            return get_persuasion_instructions(ctx)
        except Exception:
            return ""

    def _get_free_slots(self) -> list[dict]:
        try:
            from clapcheeks.calendar.client import get_free_slots
            return get_free_slots(days=7)
        except Exception:
            return []

    def _conversation_stage(self, messages: list[dict]) -> str:
        if not messages:
            return "new"
        count = len(messages)
        text = " ".join(m.get("content", "").lower() for m in messages)
        date_keywords = ["meet", "coffee", "drinks", "dinner", "hang out", "get together", "weekend", "free", "plans"]
        if any(kw in text for kw in date_keywords) and count >= 4:
            return "date_ready"
        if count >= 6:
            return "date_ready"
        if count >= 2:
            return "replied"
        return "opened"

    def suggest_reply(self, conversation: list[dict], contact_name: str | None = None, calendar_context: str | None = None) -> str | None:
        try:
            # Analyze match's style
            match_style = self._analyze_match_style(conversation)
            persuasion = self._get_persuasion_context(conversation)

            # Build rich style description
            style_desc = self._style
            if match_style:
                style_desc = f"Your style: {self._style}. Their style: {match_style}. Mirror their energy."

            payload = {
                "platform": self._platform,
                "conversation": conversation,
                "style_description": style_desc,
                "contact_name": contact_name,
                "persuasion_context": persuasion,
            }
            if calendar_context:
                payload["calendar_context"] = calendar_context

            resp = requests.post(f"{self._ai_url}/reply/suggest", json=payload, timeout=15)
            resp.raise_for_status()
            return resp.json().get("suggestion", "").strip()
        except Exception as exc:
            logger.warning("AI service call failed: %s", exc)
            return None

    def suggest_date_message(self, match_name: str, conversation: list[dict]) -> str | None:
        free_slots = self._get_free_slots()
        calendar_context = None
        if free_slots:
            labels = [s["label"] for s in free_slots[:3]]
            calendar_context = f"Available: {', '.join(labels)}"
        return self.suggest_reply(conversation=conversation, contact_name=match_name, calendar_context=calendar_context)

    def get_new_matches(self) -> list[dict]:
        try:
            if hasattr(self._client, "check_new_matches"):
                return self._client.check_new_matches()
            return []
        except Exception as exc:
            logger.error("get_new_matches failed: %s", exc)
            return []

    def send_opener(self, match: dict) -> bool:
        match_id = match.get("match_id") or match.get("id")
        name = match.get("name") or match.get("match_name") or "them"
        opener = self.suggest_reply(conversation=[], contact_name=name)
        if not opener:
            return False
        if self._dry_run:
            logger.info("[DRY RUN] Would send to %s: %s", name, opener)
            return True
        try:
            return self._client.send_message(match_id, opener)
        except Exception as exc:
            logger.error("send_opener failed: %s", exc)
            return False

    def process_replies(self) -> dict:
        results = {"checked": 0, "replied": 0, "dates_proposed": 0, "reengaged": 0, "errors": 0}
        try:
            matches = self._client.get_matches(count=30) if hasattr(self._client, "get_matches") else []
        except Exception:
            return results

        for match in matches:
            match_id = match.get("id") or match.get("match_id")
            name = match.get("person", {}).get("name") or match.get("match_name") or "them"
            messages = match.get("messages", [])
            if not messages:
                continue

            # Update conversation state tracking
            last_ts = time.time()
            update_conversation(match_id, message_count=len(messages), last_ts=last_ts, platform=self._platform)

            last = messages[-1]
            if last.get("from_id") == "me" or last.get("role") == "assistant":
                continue
            results["checked"] += 1
            conversation = [
                {"role": "assistant" if m.get("from_id") == "me" else "user", "content": m.get("message", m.get("content", ""))}
                for m in messages[-10:]
            ]

            # Check if we should propose a date
            state = get_conversation(match_id)
            if not state.get("date_asked") and should_ask_for_date(len(messages), last_ts):
                profile = match.get("person", {})
                reply = generate_date_ask(match_name=name, platform=self._platform, profile_data=profile)
                update_conversation(match_id, date_asked=True)
                results["dates_proposed"] += 1
            else:
                stage = self._conversation_stage(conversation)
                if stage == "date_ready":
                    reply = self.suggest_date_message(match_name=name, conversation=conversation)
                else:
                    reply = self.suggest_reply(conversation=conversation, contact_name=name)

            if not reply:
                results["errors"] += 1
                continue
            if self._dry_run:
                logger.info("[DRY RUN] Would reply to %s: %s", name, reply)
                results["replied"] += 1
                continue
            try:
                if self._client.send_message(match_id, reply):
                    results["replied"] += 1
                    sleep_jitter("message")
                else:
                    results["errors"] += 1
            except Exception:
                results["errors"] += 1
        return results

    def _process_reengagements(self) -> dict:
        """Send re-engagement messages to conversations silent 48h+."""
        results = {"reengaged": 0, "errors": 0}
        stale = get_stale_conversations(hours=48)
        for entry in stale[:5]:
            match_id = entry["match_id"]
            name = entry.get("name", "them")
            days_silent = max(1, int((time.time() - entry.get("last_ts", 0)) / 86400))
            msg = generate_reengagement(match_name=name, days_silent=days_silent)
            if self._dry_run:
                logger.info("[DRY RUN] Would re-engage %s: %s", name, msg)
                results["reengaged"] += 1
                continue
            try:
                if self._client.send_message(match_id, msg):
                    update_conversation(match_id, last_ts=time.time())
                    results["reengaged"] += 1
                    sleep_jitter("message")
                else:
                    results["errors"] += 1
            except Exception:
                results["errors"] += 1
        return results

    def run_loop(self) -> dict:
        summary = {"openers_sent": 0, "replies_sent": 0, "dates_proposed": 0, "reengaged": 0, "errors": 0}
        new_matches = self.get_new_matches()
        logger.info("Found %d new matches needing openers", len(new_matches))
        for match in new_matches[:10]:
            if self.send_opener(match):
                summary["openers_sent"] += 1
            else:
                summary["errors"] += 1
            sleep_jitter("message")
        reply_results = self.process_replies()
        summary["replies_sent"] = reply_results["replied"]
        summary["dates_proposed"] = reply_results["dates_proposed"]
        summary["errors"] += reply_results["errors"]

        # Re-engage stale conversations (48h+ silence)
        reengage_results = self._process_reengagements()
        summary["reengaged"] = reengage_results["reengaged"]
        summary["errors"] += reengage_results["errors"]

        return summary
