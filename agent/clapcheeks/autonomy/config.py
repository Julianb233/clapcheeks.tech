"""Autonomy configuration — levels, thresholds, per-match overrides (AUTO-05)."""
from __future__ import annotations
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)

class AutonomyLevel(str, Enum):
    SUPERVISED = "supervised"
    SEMI_AUTO = "semi_auto"
    FULL_AUTO = "full_auto"

@dataclass
class AutonomyConfig:
    user_id: str
    global_level: AutonomyLevel = AutonomyLevel.SUPERVISED
    auto_swipe_enabled: bool = False
    auto_swipe_confidence_min: int = 70
    auto_respond_enabled: bool = False
    auto_respond_confidence_min: int = 80
    auto_reengage_enabled: bool = False
    max_auto_swipes_per_hour: int = 20
    max_auto_replies_per_hour: int = 10
    stale_hours_threshold: int = 48
    stale_recovery_enabled: bool = False
    notify_on_auto_send: bool = True
    notify_on_low_confidence: bool = True
    notify_on_queue_item: bool = True

@dataclass
class MatchAutonomyOverride:
    match_id: str
    match_name: str
    level: AutonomyLevel | None = None
    auto_respond_enabled: bool | None = None
    auto_reengage_enabled: bool | None = None

def get_effective_level(config: AutonomyConfig, override: MatchAutonomyOverride | None = None) -> AutonomyLevel:
    if override and override.level is not None:
        return override.level
    return config.global_level

def should_auto_respond(config: AutonomyConfig, override: MatchAutonomyOverride | None = None, confidence: float = 0.0) -> str:
    level = get_effective_level(config, override)
    enabled = config.auto_respond_enabled
    if override and override.auto_respond_enabled is not None:
        enabled = override.auto_respond_enabled
    if not enabled or level == AutonomyLevel.SUPERVISED:
        return "queue"
    if confidence >= config.auto_respond_confidence_min:
        return "send"
    elif confidence >= 50:
        return "queue"
    return "notify"

def should_auto_reengage(config: AutonomyConfig, override: MatchAutonomyOverride | None = None) -> bool:
    level = get_effective_level(config, override)
    enabled = config.auto_reengage_enabled
    if override and override.auto_reengage_enabled is not None:
        enabled = override.auto_reengage_enabled
    return enabled and level == AutonomyLevel.FULL_AUTO

def needs_approval(action_type: str, config: AutonomyConfig, override: MatchAutonomyOverride | None = None) -> bool:
    level = get_effective_level(config, override)
    if level == AutonomyLevel.SUPERVISED:
        return True
    if level == AutonomyLevel.SEMI_AUTO:
        return action_type in ("date_booking", "app_to_text", "stage_transition")
    if level == AutonomyLevel.FULL_AUTO:
        return action_type == "date_booking"
    return True

def config_from_row(row: dict[str, Any]) -> AutonomyConfig:
    return AutonomyConfig(
        user_id=row.get("user_id", ""),
        global_level=AutonomyLevel(row.get("global_level", "supervised")),
        auto_swipe_enabled=row.get("auto_swipe_enabled", False),
        auto_swipe_confidence_min=row.get("auto_swipe_confidence_min", 70),
        auto_respond_enabled=row.get("auto_respond_enabled", False),
        auto_respond_confidence_min=row.get("auto_respond_confidence_min", 80),
        auto_reengage_enabled=row.get("auto_reengage_enabled", False),
        max_auto_swipes_per_hour=row.get("max_auto_swipes_per_hour", 20),
        max_auto_replies_per_hour=row.get("max_auto_replies_per_hour", 10),
        stale_hours_threshold=row.get("stale_hours_threshold", 48),
        stale_recovery_enabled=row.get("stale_recovery_enabled", False),
        notify_on_auto_send=row.get("notify_on_auto_send", True),
        notify_on_low_confidence=row.get("notify_on_low_confidence", True),
        notify_on_queue_item=row.get("notify_on_queue_item", True),
    )
