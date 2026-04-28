"""AI-8809 — iMessage sender respects the AI gate.

When user_id + match_id + supabase are provided and the gate returns False,
send_imessage must return a refusal SendResult (ok=False, error="ai_paused")
without attempting any outbound send.
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import MagicMock, patch

from clapcheeks.imessage.sender import send_imessage, SendResult


def _mock_supabase_inactive() -> MagicMock:
    sb = MagicMock()
    chain = sb.from_.return_value
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.single.return_value = chain
    chain.execute.return_value = MagicMock(data={"is_active": False, "ai_paused_until": None, "ai_paused_reason": "test"})
    return sb


def _mock_supabase_active() -> MagicMock:
    sb = MagicMock()
    chain = sb.from_.return_value
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.single.return_value = chain
    chain.execute.return_value = MagicMock(data={"is_active": True, "ai_paused_until": None, "ai_paused_reason": None})
    return sb


def test_sender_refused_when_gate_paused():
    sb = _mock_supabase_inactive()
    result = send_imessage(
        "+16195090699",
        "Hello there",
        user_id="u1",
        match_id="m1",
        supabase=sb,
    )
    assert result.ok is False
    assert result.error == "ai_paused"


def test_sender_no_gate_provided_proceeds_to_transport():
    """No gate = no block. The call falls through to transport (dry-run to avoid actual send)."""
    result = send_imessage("+16195090699", "Hello there", dry_run=True)
    # With dry_run=True and no gate, it should succeed the gate and return a noop send
    assert result.channel == "noop"
    # ok=True for dry_run
    assert result.ok is True


def test_sender_gate_active_proceeds():
    """With an active gate, the call is not blocked at the gate level."""
    sb = _mock_supabase_active()
    # Use dry_run to prevent actual network call; just verify we don't get ai_paused error
    result = send_imessage(
        "+16195090699",
        "Hello there",
        dry_run=True,
        user_id="u1",
        match_id="m1",
        supabase=sb,
    )
    # dry_run returns early AFTER the gate, so ok=True and no ai_paused error
    assert result.error != "ai_paused"
