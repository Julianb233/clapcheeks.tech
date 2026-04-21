"""Phase G — follow-up drip daemon.

State machine + queueing for automated bumps, re-engages, date confirms, and
post-date outcome prompts. Cadence is loaded from
``clapcheeks_user_settings.persona.followup_cadence`` — never hardcoded.

PHASE-G — AI-8321
"""
from clapcheeks.followup.drip import (
    DEFAULT_CADENCE,
    DripAction,
    evaluate_conversation_state,
    load_cadence_for_user,
    queue_drip_action,
)

__all__ = [
    "DEFAULT_CADENCE",
    "DripAction",
    "evaluate_conversation_state",
    "load_cadence_for_user",
    "queue_drip_action",
]
