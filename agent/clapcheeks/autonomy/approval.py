"""Approval Gate — route actions through approval queue or auto-execute (AUTO-05)."""
from __future__ import annotations
import hashlib, hmac, logging, time, uuid
from dataclasses import dataclass, field
from typing import Any
from clapcheeks.autonomy.config import AutonomyConfig, MatchAutonomyOverride, needs_approval

logger = logging.getLogger(__name__)


@dataclass
class ApprovalEnvelope:
    """Single-use approval bound to recipient, channel, and exact final text."""

    verified_recipient: str
    verified_channel: str
    exact_final_text: str
    approval_timestamp: float
    expires_at: float
    source_packet_id: str
    recipient_channel_body_fingerprint: str
    consumed_at: float | None = None

    @staticmethod
    def _fingerprint(recipient: str, channel: str, body: str, source_packet_id: str) -> str:
        canonical = "\x1f".join((recipient.strip(), channel.strip().casefold(), body, source_packet_id))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @classmethod
    def create(
        cls,
        *,
        recipient: str,
        channel: str,
        exact_final_text: str,
        source_packet_id: str,
        ttl_seconds: int = 900,
        now: float | None = None,
    ) -> "ApprovalEnvelope":
        timestamp = time.time() if now is None else now
        return cls(
            verified_recipient=recipient,
            verified_channel=channel,
            exact_final_text=exact_final_text,
            approval_timestamp=timestamp,
            expires_at=timestamp + max(1, ttl_seconds),
            source_packet_id=source_packet_id,
            recipient_channel_body_fingerprint=cls._fingerprint(
                recipient, channel, exact_final_text, source_packet_id
            ),
        )

    def verify(
        self,
        *,
        recipient: str,
        channel: str,
        exact_final_text: str,
        now: float | None = None,
    ) -> bool:
        timestamp = time.time() if now is None else now
        expected = self._fingerprint(recipient, channel, exact_final_text, self.source_packet_id)
        return (
            self.consumed_at is None
            and timestamp <= self.expires_at
            and recipient == self.verified_recipient
            and channel.casefold() == self.verified_channel.casefold()
            and exact_final_text == self.exact_final_text
            and expected == self.recipient_channel_body_fingerprint
        )

    def consume(
        self,
        *,
        recipient: str,
        channel: str,
        exact_final_text: str,
        now: float | None = None,
    ) -> bool:
        timestamp = time.time() if now is None else now
        if not self.verify(
            recipient=recipient,
            channel=channel,
            exact_final_text=exact_final_text,
            now=timestamp,
        ):
            return False
        self.consumed_at = timestamp
        return True


def validate_send_approval_envelope(
    payload: dict[str, Any],
    exact_body: str,
    *,
    now: float | None = None,
) -> bool:
    """Runtime check used immediately before a transport send."""
    envelope = payload.get("approval_envelope")
    if not isinstance(envelope, dict):
        return False
    recipient = str(payload.get("person_id") or payload.get("handle") or "")
    channel = str(envelope.get("verified_channel") or "")
    source_packet_id = str(envelope.get("source_packet_id") or "")
    approved_recipient = str(envelope.get("verified_recipient") or "")
    approved_body = envelope.get("exact_final_text")
    fingerprint = str(envelope.get("recipient_channel_body_fingerprint") or "")
    expires_at = envelope.get("expires_at")
    if not recipient or not channel or not source_packet_id or not isinstance(expires_at, (int, float)):
        return False
    timestamp_ms = (time.time() if now is None else now) * 1000
    expected = ApprovalEnvelope._fingerprint(
        approved_recipient, channel, str(approved_body or ""), source_packet_id
    )
    return (
        approved_recipient == recipient
        and approved_body == exact_body
        and expires_at >= timestamp_ms
        and hmac.compare_digest(fingerprint, expected)
    )

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
