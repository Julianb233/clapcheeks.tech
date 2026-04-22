"""Approval Queue — manages pending actions awaiting user approval (AUTO-05).

Provides local queue management that syncs with the backend API
for persistence. Used by the approval gate to store items for review.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)


@dataclass
class QueueItem:
    """A single item in the approval queue."""
    id: str
    action_type: str  # reply, opener, date_booking, recovery, etc.
    platform: str
    match_id: str
    match_name: str
    text: str
    confidence: float
    status: str = "pending"  # pending, approved, rejected, expired
    context: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    resolved_at: float | None = None
    edited_text: str | None = None
    reject_reason: str | None = None


class ApprovalQueue:
    """In-memory approval queue with sync capability.

    Items are added when the ApprovalGate routes an action to "queue".
    The user reviews and approves/rejects via the dashboard UI.
    """

    def __init__(self) -> None:
        self._items: dict[str, QueueItem] = {}

    def add(
        self,
        action_type: str,
        platform: str,
        match_id: str,
        match_name: str,
        text: str,
        confidence: float,
        context: dict[str, Any] | None = None,
    ) -> QueueItem:
        """Add an item to the approval queue."""
        item = QueueItem(
            id=str(uuid.uuid4()),
            action_type=action_type,
            platform=platform,
            match_id=match_id,
            match_name=match_name,
            text=text,
            confidence=confidence,
            context=context or {},
        )
        self._items[item.id] = item
        log.info("Queued %s for %s (confidence=%.1f)", action_type, match_name, confidence)
        return item

    def approve(self, item_id: str, edited_text: str | None = None) -> QueueItem | None:
        """Approve a queued item. Optionally provide edited text."""
        item = self._items.get(item_id)
        if not item or item.status != "pending":
            return None
        item.status = "approved"
        item.resolved_at = time.time()
        if edited_text:
            item.edited_text = edited_text
        return item

    def reject(self, item_id: str, reason: str = "") -> QueueItem | None:
        """Reject a queued item."""
        item = self._items.get(item_id)
        if not item or item.status != "pending":
            return None
        item.status = "rejected"
        item.resolved_at = time.time()
        item.reject_reason = reason
        return item

    def get_pending(self) -> list[QueueItem]:
        """Get all pending items, newest first."""
        pending = [i for i in self._items.values() if i.status == "pending"]
        return sorted(pending, key=lambda i: i.created_at, reverse=True)

    def get_item(self, item_id: str) -> QueueItem | None:
        """Get a single queue item by ID."""
        return self._items.get(item_id)

    @property
    def pending_count(self) -> int:
        """Number of items awaiting approval."""
        return sum(1 for i in self._items.values() if i.status == "pending")

    def expire_old(self, max_age_hours: int = 72) -> int:
        """Expire items older than max_age_hours. Returns count expired."""
        now = time.time()
        threshold = max_age_hours * 3600
        expired = 0
        for item in self._items.values():
            if item.status == "pending" and (now - item.created_at) > threshold:
                item.status = "expired"
                item.resolved_at = now
                expired += 1
        return expired

    def to_dicts(self, status: str | None = None) -> list[dict[str, Any]]:
        """Export queue items as dicts (for API sync)."""
        items = self._items.values()
        if status:
            items = [i for i in items if i.status == status]
        return [
            {
                "id": i.id,
                "action_type": i.action_type,
                "platform": i.platform,
                "match_id": i.match_id,
                "match_name": i.match_name,
                "text": i.edited_text or i.text,
                "confidence": i.confidence,
                "status": i.status,
                "context": i.context,
                "created_at": i.created_at,
                "resolved_at": i.resolved_at,
            }
            for i in sorted(items, key=lambda x: x.created_at, reverse=True)
        ]
