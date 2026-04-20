"""Approval Gate — route actions through approval queue or auto-execute (AUTO-05)."""
from __future__ import annotations
import logging, time, uuid
from dataclasses import dataclass, field
from typing import Any
from clapcheeks.autonomy.config import AutonomyConfig, MatchAutonomyOverride, needs_approval

logger = logging.getLogger(__name__)

@dataclass
class QueueItem:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    action_type: str = ""; match_id: str = ""; match_name: str = ""; platform: str = ""
    proposed_text: str | None = None; proposed_data: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0; ai_reasoning: str = ""; status: str = "pending"
    created_at: float = field(default_factory=time.time); expires_at: float = 0.0
    def __post_init__(self):
        if self.expires_at == 0.0: self.expires_at = self.created_at + 86400
    @property
    def is_expired(self) -> bool: return time.time() > self.expires_at
    def to_db_row(self, user_id: str) -> dict[str, Any]:
        from datetime import datetime, timezone
        return {"user_id": user_id, "action_type": self.action_type, "match_id": self.match_id or None,
                "match_name": self.match_name, "platform": self.platform, "proposed_text": self.proposed_text,
                "proposed_data": self.proposed_data, "confidence": self.confidence, "ai_reasoning": self.ai_reasoning,
                "status": self.status, "expires_at": datetime.fromtimestamp(self.expires_at, tz=timezone.utc).isoformat()}

class ApprovalGate:
    def __init__(self, config: AutonomyConfig): self.config = config

    def evaluate_reply(self, match_id: str, match_name: str, platform: str, message_text: str,
                       confidence: float, reasoning: str, override: MatchAutonomyOverride | None = None,
                       is_reengagement: bool = False) -> QueueItem | None:
        at = "auto_reengage" if is_reengagement else "auto_respond"
        if not needs_approval("reengage" if is_reengagement else "reply", self.config, override):
            if confidence >= self.config.auto_respond_confidence_min: return None
        return QueueItem(action_type=at, match_id=match_id, match_name=match_name, platform=platform,
                        proposed_text=message_text, confidence=confidence, ai_reasoning=reasoning)

    def evaluate_action(self, action_type: str, match_id: str, match_name: str, platform: str,
                        proposed_data: dict[str, Any], confidence: float = 100.0, reasoning: str = "",
                        override: MatchAutonomyOverride | None = None) -> QueueItem | None:
        if not needs_approval(action_type, self.config, override): return None
        return QueueItem(action_type=action_type, match_id=match_id, match_name=match_name, platform=platform,
                        proposed_data=proposed_data, confidence=confidence, ai_reasoning=reasoning)
