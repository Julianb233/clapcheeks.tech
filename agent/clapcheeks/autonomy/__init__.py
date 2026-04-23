"""Autonomy Engine — auto-swipe, auto-respond, approval gates (Phase 44, AI-8329).

Core capabilities:
1. Preference Learning (AUTO-01) — preference_model.py
2. Auto-Swipe (AUTO-02) — auto_swipe.py
3. Auto-Respond (AUTO-03) — auto_respond.py
4. Stale Recovery (AUTO-04) — recovery.py
5. Approval Gates (AUTO-05) — config.py + approval.py + queue.py
6. Confidence Dashboard (AUTO-06) — confidence.py
"""
from clapcheeks.autonomy.config import AutonomyLevel, AutonomyConfig, get_effective_level
from clapcheeks.autonomy.preference_model import PreferenceModel, ProfileFeatures, extract_features
from clapcheeks.autonomy.auto_swipe import AutoSwiper
from clapcheeks.autonomy.auto_respond import AutoResponder
from clapcheeks.autonomy.approval import ApprovalGate
from clapcheeks.autonomy.recovery import StaleRecovery
from clapcheeks.autonomy.queue import ApprovalQueue
from clapcheeks.autonomy.confidence import build_dashboard, DashboardMetrics

__all__ = [
    "AutonomyLevel",
    "AutonomyConfig",
    "get_effective_level",
    "PreferenceModel",
    "ProfileFeatures",
    "extract_features",
    "AutoSwiper",
    "AutoResponder",
    "ApprovalGate",
    "StaleRecovery",
    "ApprovalQueue",
    "build_dashboard",
    "DashboardMetrics",
]
