"""Confidence Dashboard — aggregates stats from all autonomy subsystems (AUTO-06).

Provides a unified view of autonomy system performance for the
frontend dashboard to consume.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from clapcheeks.autonomy.config import AutonomyConfig, AutonomyLevel
from clapcheeks.autonomy.preference_model import PreferenceModel


@dataclass
class DashboardMetrics:
    """Aggregated metrics for the confidence dashboard."""
    # Config state
    global_level: str = "supervised"
    auto_swipe_enabled: bool = False
    auto_respond_enabled: bool = False
    stale_recovery_enabled: bool = False

    # Preference model stats
    model_trained: bool = False
    model_accuracy: float | None = None
    model_training_size: int = 0
    model_version: int = 0

    # Last 24h activity
    auto_swipes_24h: int = 0
    auto_replies_24h: int = 0
    recoveries_24h: int = 0
    queued_24h: int = 0
    avg_confidence_24h: float = 0.0

    # Queue status
    pending_approvals: int = 0

    # Thresholds
    swipe_confidence_min: int = 70
    respond_confidence_min: int = 80
    stale_hours_threshold: int = 48

    def to_dict(self) -> dict[str, Any]:
        """Convert to API-friendly dict."""
        return {
            "config": {
                "global_level": self.global_level,
                "auto_swipe_enabled": self.auto_swipe_enabled,
                "auto_respond_enabled": self.auto_respond_enabled,
                "stale_recovery_enabled": self.stale_recovery_enabled,
            },
            "preference_model": {
                "is_trained": self.model_trained,
                "accuracy": self.model_accuracy,
                "training_size": self.model_training_size,
                "version": self.model_version,
            },
            "activity_24h": {
                "auto_swipes": self.auto_swipes_24h,
                "auto_replies": self.auto_replies_24h,
                "recoveries": self.recoveries_24h,
                "queued": self.queued_24h,
                "avg_confidence": self.avg_confidence_24h,
            },
            "queue": {
                "pending_approvals": self.pending_approvals,
            },
            "thresholds": {
                "swipe_confidence_min": self.swipe_confidence_min,
                "respond_confidence_min": self.respond_confidence_min,
                "stale_hours_threshold": self.stale_hours_threshold,
            },
        }


def build_dashboard(
    config: AutonomyConfig,
    model: PreferenceModel | None = None,
    recent_actions: list[dict[str, Any]] | None = None,
    pending_count: int = 0,
) -> DashboardMetrics:
    """Build dashboard metrics from current state.

    Args:
        config: Current autonomy config
        model: Current preference model (if loaded)
        recent_actions: List of recent auto-action dicts from the last 24h
        pending_count: Number of pending approval items

    Returns:
        DashboardMetrics with all fields populated
    """
    actions = recent_actions or []

    # Count activity types
    auto_swipes = sum(1 for a in actions if a.get("action_type") == "swipe")
    auto_replies = sum(1 for a in actions if a.get("action_type") in ("reply", "opener"))
    recoveries = sum(1 for a in actions if a.get("action_type") == "recovery")
    queued = sum(1 for a in actions if a.get("decision") == "queue")

    # Average confidence
    confidences = [a.get("confidence", 0) for a in actions if a.get("confidence")]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    return DashboardMetrics(
        global_level=config.global_level.value,
        auto_swipe_enabled=config.auto_swipe_enabled,
        auto_respond_enabled=config.auto_respond_enabled,
        stale_recovery_enabled=config.stale_recovery_enabled,
        model_trained=(model.training_size >= 50) if model else False,
        model_accuracy=model.accuracy if model else None,
        model_training_size=model.training_size if model else 0,
        model_version=model.version if model else 0,
        auto_swipes_24h=auto_swipes,
        auto_replies_24h=auto_replies,
        recoveries_24h=recoveries,
        queued_24h=queued,
        avg_confidence_24h=round(avg_confidence, 1),
        pending_approvals=pending_count,
        swipe_confidence_min=config.auto_swipe_confidence_min,
        respond_confidence_min=config.auto_respond_confidence_min,
        stale_hours_threshold=config.stale_hours_threshold,
    )
