"""AI-8809 — unit tests for the AI active gate.

Tests cover all combinations:
  - user on  / match on  -> active
  - user off / match on  -> paused
  - user on  / match off -> paused
  - snooze active (ai_paused_until in the future) -> paused
  - snooze expired (ai_paused_until in the past)  -> active
  - missing row (new user/match)                  -> default active
  - lookup failure                                -> default active (fail-open)
  - empty user_id / match_id                      -> default active
"""
from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

import pytest

from clapcheeks.autonomy.gate import is_ai_active


# ─── helpers ─────────────────────────────────────────────────────────────────

def _future(hours: float = 2.0) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _past(hours: float = 2.0) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _mock_supabase(row: dict | None) -> MagicMock:
    sb = MagicMock()
    chain = sb.from_.return_value
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.single.return_value = chain
    chain.execute.return_value = MagicMock(data=row)
    return sb


UID = "user-uuid-1"
MID = "match-uuid-1"


# ─── tests ───────────────────────────────────────────────────────────────────

def test_both_active():
    sb = _mock_supabase({"is_active": True, "ai_paused_until": None, "ai_paused_reason": None})
    assert is_ai_active(sb, UID, MID) is True


def test_user_off():
    sb = _mock_supabase({"is_active": False, "ai_paused_until": None, "ai_paused_reason": "Manual mode"})
    assert is_ai_active(sb, UID, MID) is False


def test_match_off():
    sb = _mock_supabase({"is_active": False, "ai_paused_until": None, "ai_paused_reason": None})
    assert is_ai_active(sb, UID, MID) is False


def test_snooze_active_future():
    sb = _mock_supabase({
        "is_active": False,
        "ai_paused_until": _future(3),
        "ai_paused_reason": "On a date",
    })
    assert is_ai_active(sb, UID, MID) is False


def test_snooze_expired():
    sb = _mock_supabase({
        "is_active": True,
        "ai_paused_until": _past(1),
        "ai_paused_reason": "On a date",
    })
    assert is_ai_active(sb, UID, MID) is True


def test_missing_row_defaults_active():
    sb = _mock_supabase(None)
    assert is_ai_active(sb, UID, MID) is True


def test_lookup_exception_defaults_active():
    sb = MagicMock()
    sb.from_.side_effect = RuntimeError("db down")
    assert is_ai_active(sb, UID, MID) is True


def test_empty_user_id_defaults_active():
    sb = MagicMock()
    assert is_ai_active(sb, "", MID) is True
    sb.from_.assert_not_called()


def test_empty_match_id_defaults_active():
    sb = MagicMock()
    assert is_ai_active(sb, UID, "") is True
    sb.from_.assert_not_called()
