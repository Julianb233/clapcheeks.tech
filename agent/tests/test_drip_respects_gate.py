"""AI-8809 — drip state machine respects the AI gate.

When the gate flag _supabase_gate is set on the match dict and the gate
returns False (AI paused), evaluate_conversation_state must return
(STATE_NOOP, DripAction(kind="noop", reason="ai_paused")) regardless of
what the underlying conversation state would otherwise be.
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

from clapcheeks.followup.drip import (
    evaluate_conversation_state,
    STATE_NOOP,
    STATE_OPENED_NO_REPLY,
    DEFAULT_CADENCE,
)


def _mock_supabase_inactive() -> MagicMock:
    sb = MagicMock()
    chain = sb.from_.return_value
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.single.return_value = chain
    chain.execute.return_value = MagicMock(data={"is_active": False, "ai_paused_until": None, "ai_paused_reason": "test"})
    return sb


def _base_match(supabase=None) -> dict:
    return {
        "id": "m1",
        "user_id": "u1",
        "status": "opened",
        "drip_count": 0,
        "last_drip_at": None,
        "outcome": None,
        "outcome_prompted_at": None,
        "handoff_complete": False,
        "date_booked_at": None,
        "first_message_at": (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat(),
        "last_activity_at": (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat(),
        "_supabase_gate": supabase,
    }


def test_gate_paused_returns_noop():
    sb = _mock_supabase_inactive()
    match = _base_match(supabase=sb)
    # Even though conversation_state would normally be STATE_OPENED_NO_REPLY,
    # the gate kicks in first and we get NOOP.
    state, action = evaluate_conversation_state(match, [], DEFAULT_CADENCE)
    assert state == STATE_NOOP
    assert action.reason == "ai_paused"


def test_gate_active_proceeds_normally():
    """When gate is active, drip logic runs normally."""
    sb = MagicMock()
    chain = sb.from_.return_value
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.single.return_value = chain
    chain.execute.return_value = MagicMock(data={"is_active": True, "ai_paused_until": None, "ai_paused_reason": None})
    match = _base_match(supabase=sb)
    state, action = evaluate_conversation_state(match, [], DEFAULT_CADENCE)
    # With 30h elapsed and no reply, it should NOT be NOOP (could be no_reply or similar)
    assert state != STATE_NOOP or action.reason != "ai_paused"


def test_no_gate_provided_runs_normally():
    """When _supabase_gate is None, gate check is skipped entirely."""
    match = _base_match(supabase=None)
    # Should not raise — gate is simply skipped.
    state, action = evaluate_conversation_state(match, [], DEFAULT_CADENCE)
    # Any state is fine as long as it didn't error.
    assert isinstance(state, str)
