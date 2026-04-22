"""Auto-Respond — draft and optionally send replies in Julian's voice (AUTO-03/04)."""
from __future__ import annotations
import logging, time
from dataclasses import dataclass, field
from typing import Any
import requests
from clapcheeks.autonomy.config import AutonomyConfig, MatchAutonomyOverride, should_auto_respond, should_auto_reengage

logger = logging.getLogger(__name__)

@dataclass
class DraftReply:
    match_id: str; match_name: str; platform: str; message_text: str; confidence: float
    reasoning: str; action: str = ""; is_reengagement: bool = False
    conversation_context: list[dict] = field(default_factory=list)

class AutoResponder:
    def __init__(self, config: AutonomyConfig, ai_url: str = "http://localhost:8000"):
        self.config = config; self.ai_url = ai_url
        self._hourly_count = 0; self._hour_start = time.time()

    def draft_reply(self, match_id: str, match_name: str, platform: str, conversation: list[dict[str, Any]],
                    override: MatchAutonomyOverride | None = None, style: str = "confident, playful, direct") -> DraftReply | None:
        if not self._check_rate(): return None
        try:
            resp = requests.post(f"{self.ai_url}/reply/suggest", json={
                "platform": platform, "conversation": conversation[-10:],
                "style_description": style, "match_name": match_name, "mode": "auto_respond"}, timeout=15)
            resp.raise_for_status(); data = resp.json()
        except Exception as exc:
            logger.warning("AI reply draft failed for %s: %s", match_name, exc); return None
        text = data.get("suggestion","").strip()
        if not text: return None
        confidence = float(data.get("confidence", 50))
        action = should_auto_respond(self.config, override, confidence)
        draft = DraftReply(match_id=match_id, match_name=match_name, platform=platform, message_text=text,
                          confidence=round(confidence,1), reasoning=data.get("reasoning",""), action=action,
                          conversation_context=conversation[-3:])
        if action == "send": self._hourly_count += 1
        return draft

    def draft_reengagement(self, match_id: str, match_name: str, platform: str, conversation: list[dict[str, Any]],
                           hours_stale: int, override: MatchAutonomyOverride | None = None) -> DraftReply | None:
        if hours_stale < self.config.stale_hours_threshold: return None
        days = hours_stale // 24
        if days >= 15: return None
        stage = "final genuine attempt" if days >= 11 else "conversation restart" if days >= 6 else "light casual bump"
        try:
            resp = requests.post(f"{self.ai_url}/reply/suggest", json={
                "platform": platform, "conversation": conversation[-5:], "match_name": match_name, "mode": "reengagement",
                "system_context": f"Match {match_name} hasn't responded in {days} days. Generate {stage}. Keep it short."}, timeout=15)
            resp.raise_for_status(); data = resp.json()
        except Exception as exc:
            logger.warning("AI reengagement failed for %s: %s", match_name, exc); return None
        text = data.get("suggestion","").strip()
        if not text: return None
        auto_send = should_auto_reengage(self.config, override)
        return DraftReply(match_id=match_id, match_name=match_name, platform=platform, message_text=text,
                         confidence=round(float(data.get("confidence",60)),1), reasoning=f"Stale recovery ({days}d)",
                         action="send" if auto_send else "queue", is_reengagement=True, conversation_context=conversation[-3:])

    def _check_rate(self) -> bool:
        if time.time()-self._hour_start > 3600: self._hourly_count = 0; self._hour_start = time.time()
        return self._hourly_count < self.config.max_auto_replies_per_hour
