"""Autonomy Engine — auto-swipe, auto-respond, approval gates (Phase 44, AI-8329)."""
from clapcheeks.autonomy.config import AutonomyLevel, get_effective_level
from clapcheeks.autonomy.preference_model import PreferenceModel
from clapcheeks.autonomy.auto_swipe import AutoSwiper
from clapcheeks.autonomy.auto_respond import AutoResponder
from clapcheeks.autonomy.approval import ApprovalGate

__all__ = ["AutonomyLevel", "get_effective_level", "PreferenceModel", "AutoSwiper", "AutoResponder", "ApprovalGate"]
