"""Stale conversation recovery (AUTO-04).

Detects conversations with no activity for N+ hours and generates
re-engagement messages. Delegates sending to the AutoResponder.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from clapcheeks.autonomy.config import AutonomyConfig, MatchAutonomyOverride
from clapcheeks.autonomy.auto_respond import AutoResponder, DraftReply

log = logging.getLogger(__name__)


class StaleRecovery:
    """Manages stale conversation detection and recovery."""

    def __init__(self, config: AutonomyConfig, ai_url: str = "http://localhost:8000") -> None:
        self.config = config
        self.responder = AutoResponder(config, ai_url=ai_url)

    def find_stale(self, conversations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Find conversations that have gone stale.

        Args:
            conversations: List of conversation dicts with at minimum:
                match_id, match_name, platform, last_message_ts, messages

        Returns:
            List of stale conversation dicts with hours_stale added.
        """
        threshold_seconds = self.config.stale_hours_threshold * 3600
        now = time.time()
        stale = []

        for conv in conversations:
            last_ts = conv.get("last_message_ts", 0)
            if not last_ts:
                continue
            elapsed = now - last_ts
            if elapsed >= threshold_seconds:
                hours_stale = int(elapsed / 3600)
                stale.append({**conv, "hours_stale": hours_stale})

        return sorted(stale, key=lambda c: c["hours_stale"], reverse=True)

    def generate_recovery(
        self,
        match_id: str,
        match_name: str,
        platform: str,
        conversation: list[dict[str, Any]],
        hours_stale: int,
        override: MatchAutonomyOverride | None = None,
    ) -> DraftReply | None:
        """Generate a recovery message for a stale conversation.

        Delegates to AutoResponder.draft_reengagement which handles
        the AI generation and confidence routing.
        """
        if not self.config.stale_recovery_enabled:
            log.debug("Stale recovery disabled, skipping %s", match_name)
            return None

        return self.responder.draft_reengagement(
            match_id=match_id,
            match_name=match_name,
            platform=platform,
            conversation=conversation,
            hours_stale=hours_stale,
            override=override,
        )

    def run(
        self,
        conversations: list[dict[str, Any]],
        overrides: dict[str, MatchAutonomyOverride] | None = None,
    ) -> list[DraftReply]:
        """Find stale conversations and generate recovery drafts.

        Args:
            conversations: All active conversations
            overrides: Optional per-match overrides keyed by match_id

        Returns:
            List of DraftReply objects (some may be "queue", some "send")
        """
        stale = self.find_stale(conversations)
        results: list[DraftReply] = []

        for conv in stale:
            match_id = conv["match_id"]
            override = (overrides or {}).get(match_id)
            draft = self.generate_recovery(
                match_id=match_id,
                match_name=conv["match_name"],
                platform=conv["platform"],
                conversation=conv.get("messages", []),
                hours_stale=conv["hours_stale"],
                override=override,
            )
            if draft:
                results.append(draft)

        log.info(
            "StaleRecovery: %d stale found, %d drafts generated",
            len(stale),
            len(results),
        )
        return results
