"""Phase G - drip state machine tests.

Covers:
- All 8 states + transitions with fake timestamps
- Bump cap honored (drip_count >= max_bumps blocks queue_draft)
- Cadence is read from persona (not hardcoded)
- Outcome prompt fires exactly once per date
- Drafts route through Phase E's run_pipeline (sanitize+validate+split)
- No regressions when status is unknown

Run: pytest agent/tests/test_drip_state_machine.py -v

PHASE-G - AI-8321
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from clapcheeks.followup import drip as drip_mod  # noqa: E402
from clapcheeks.followup.drip import (  # noqa: E402
    DEFAULT_CADENCE,
    DripAction,
    STATE_CONVERSING,
    STATE_CONVERSING_GHOSTED,
    STATE_CONVERSING_STALLED,
    STATE_DATE_BOOKED_PENDING,
    STATE_DATE_PASSED_NO_OUTCOME,
    STATE_DATE_PROPOSED_NO_CONFIRM,
    STATE_DATE_PROPOSED_WAITING,
    STATE_NOOP,
    STATE_OPENED_GHOSTED,
    STATE_OPENED_NO_REPLY,
    STATE_OPENED_WAITING,
    evaluate_conversation_state,
    queue_drip_action,
)


NOW = datetime(2026, 4, 20, 12, 0, 0, tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def hours_ago(hrs: float) -> str:
    return iso(NOW - timedelta(hours=hrs))


def days_ago(d: float) -> str:
    return iso(NOW - timedelta(days=d))


@pytest.fixture
def cadence() -> dict:
    return {
        "opener_no_reply_hours": 24.0,
        "opener_no_reply_ghost_days": 5.0,
        "conversing_stalled_days": 2.0,
        "conversing_stalled_ghost_days": 7.0,
        "date_proposed_no_confirm_hours": 24.0,
        "date_outcome_prompt_hours_after_end": 4.0,
        "max_bumps": 1,
    }


@pytest.fixture
def match_opened():
    return {
        "id": "m-opened",
        "user_id": "u-1",
        "platform": "tinder",
        "name": "Emma",
        "status": "opened",
        "drip_count": 0,
        "last_drip_at": None,
        "outcome": None,
        "outcome_prompted_at": None,
    }


@pytest.fixture
def match_conversing():
    return {
        "id": "m-conv",
        "user_id": "u-1",
        "platform": "hinge",
        "name": "Sophie",
        "status": "conversing",
        "drip_count": 0,
        "last_drip_at": None,
        "last_activity_at": days_ago(3),
    }


@pytest.fixture
def match_date_proposed():
    return {
        "id": "m-dp",
        "user_id": "u-1",
        "platform": "tinder",
        "name": "Maya",
        "status": "date_proposed",
        "drip_count": 0,
        "last_drip_at": None,
    }


@pytest.fixture
def match_date_booked():
    # Date booked 6h ago, 2h assumed duration, so ended 4h ago.
    return {
        "id": "m-db",
        "user_id": "u-1",
        "platform": "tinder",
        "name": "Chloe",
        "status": "date_booked",
        "drip_count": 0,
        "last_drip_at": None,
        "outcome": None,
        "outcome_prompted_at": None,
        "date_booked_at": hours_ago(6),
    }


# ---------------------------------------------------------------------------
# State 1: opened + no reply 24h -> queue bump
# ---------------------------------------------------------------------------

class TestState01_OpenedNoReply:
    def test_24h_no_reply_queues_bump(self, match_opened, cadence):
        events = [
            {"sender": "us", "event_type": "opener_sent", "created_at": hours_ago(26)},
        ]
        state, action = evaluate_conversation_state(
            match_opened, events, cadence, now=NOW,
        )
        assert state == STATE_OPENED_NO_REPLY
        assert action.kind == "queue_draft"
        assert action.context.get("action_type") == "soft_bump"
        assert action.prompt and "Emma" in action.prompt

    def test_12h_no_reply_holds(self, match_opened, cadence):
        events = [
            {"sender": "us", "event_type": "opener_sent", "created_at": hours_ago(12)},
        ]
        state, action = evaluate_conversation_state(
            match_opened, events, cadence, now=NOW,
        )
        assert state == STATE_OPENED_WAITING
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# State 2: opened + no reply 5d + already bumped -> ghosted
# ---------------------------------------------------------------------------

class TestState02_OpenedGhosted:
    def test_5d_plus_bumped_marks_ghosted(self, match_opened, cadence):
        match_opened["drip_count"] = 1
        match_opened["last_drip_at"] = days_ago(4)  # clear cooldown
        events = [
            {"sender": "us", "event_type": "opener_sent", "created_at": days_ago(6)},
        ]
        state, action = evaluate_conversation_state(
            match_opened, events, cadence, now=NOW,
        )
        assert state == STATE_OPENED_GHOSTED
        assert action.kind == "mark_ghosted"
        assert action.new_status == "ghosted"


# ---------------------------------------------------------------------------
# State 3: conversing stalled 2d -> reengage referencing topic
# ---------------------------------------------------------------------------

class TestState03_ConversingStalled:
    def test_stalled_2d_with_topic(self, match_conversing, cadence):
        match_conversing["last_activity_at"] = days_ago(2.5)
        events = [
            {"sender": "her", "event_type": "reply_received",
             "body": "pasta any day of the week",
             "created_at": days_ago(2.5)},
            {"sender": "us", "event_type": "reply_sent",
             "created_at": days_ago(3)},
        ]
        state, action = evaluate_conversation_state(
            match_conversing, events, cadence, now=NOW,
        )
        assert state == STATE_CONVERSING_STALLED
        assert action.kind == "queue_draft"
        assert "Sophie" in action.prompt
        assert "pasta" in action.prompt.lower()

    def test_silent_7d_marks_ghosted(self, match_conversing, cadence):
        match_conversing["last_activity_at"] = days_ago(8)
        state, action = evaluate_conversation_state(
            match_conversing, [], cadence, now=NOW,
        )
        assert state == STATE_CONVERSING_GHOSTED
        assert action.kind == "mark_ghosted"
        assert action.new_status == "ghosted"

    def test_active_holds(self, match_conversing, cadence):
        match_conversing["last_activity_at"] = hours_ago(6)
        state, action = evaluate_conversation_state(
            match_conversing, [], cadence, now=NOW,
        )
        assert state == STATE_CONVERSING
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# State 4: date_proposed + no confirm 24h -> nudge
# ---------------------------------------------------------------------------

class TestState04_DateProposedNoConfirm:
    def test_no_confirm_24h_fires_nudge(self, match_date_proposed, cadence):
        events = [
            {"sender": "us", "event_type": "date_ask_sent",
             "body": "free thursday or friday?",
             "created_at": hours_ago(25)},
        ]
        state, action = evaluate_conversation_state(
            match_date_proposed, events, cadence, now=NOW,
        )
        assert state == STATE_DATE_PROPOSED_NO_CONFIRM
        assert action.kind == "queue_draft"
        assert "Maya" in action.prompt

    def test_she_confirmed_holds(self, match_date_proposed, cadence):
        events = [
            {"sender": "us", "event_type": "date_ask_sent",
             "created_at": hours_ago(26)},
            {"sender": "her", "event_type": "reply_received",
             "body": "thursday works!",
             "created_at": hours_ago(25)},
        ]
        state, action = evaluate_conversation_state(
            match_date_proposed, events, cadence, now=NOW,
        )
        assert state == STATE_DATE_PROPOSED_WAITING
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# State 5: date_booked + past end -> prompt Julian
# ---------------------------------------------------------------------------

class TestState05_DatePassedNoOutcome:
    def test_fires_prompt_4h_after_end(self, match_date_booked, cadence):
        state, action = evaluate_conversation_state(
            match_date_booked, [], cadence, now=NOW,
        )
        assert state == STATE_DATE_PASSED_NO_OUTCOME
        assert action.kind == "prompt_outcome"
        assert "Chloe" in (action.julian_message or "")
        assert "closed" in (action.julian_message or "").lower()

    def test_already_prompted_holds(self, match_date_booked, cadence):
        match_date_booked["outcome_prompted_at"] = hours_ago(1)
        state, action = evaluate_conversation_state(
            match_date_booked, [], cadence, now=NOW,
        )
        assert state == STATE_DATE_BOOKED_PENDING
        assert action.kind == "noop"

    def test_outcome_set_holds(self, match_date_booked, cadence):
        match_date_booked["outcome"] = "closed"
        match_date_booked["status"] = "dated"
        match_date_booked["last_drip_at"] = days_ago(5)
        state, action = evaluate_conversation_state(
            match_date_booked, [], cadence, now=NOW,
        )
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# State 6: conversing - active, noop
# ---------------------------------------------------------------------------

class TestState06_ConversingActive:
    def test_recent_activity_noop(self, match_conversing, cadence):
        match_conversing["last_activity_at"] = hours_ago(2)
        state, action = evaluate_conversation_state(
            match_conversing, [], cadence, now=NOW,
        )
        assert state == STATE_CONVERSING
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# State 7: date_proposed still fresh (< 24h) - noop
# ---------------------------------------------------------------------------

class TestState07_DateProposedFresh:
    def test_12h_holds(self, match_date_proposed, cadence):
        events = [
            {"sender": "us", "event_type": "date_ask_sent",
             "created_at": hours_ago(12)},
        ]
        state, action = evaluate_conversation_state(
            match_date_proposed, events, cadence, now=NOW,
        )
        assert state == STATE_DATE_PROPOSED_WAITING
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# State 8: date_booked but not past end time yet
# ---------------------------------------------------------------------------

class TestState08_DateBookedFuture:
    def test_future_date_holds(self, match_date_booked, cadence):
        match_date_booked["date_booked_at"] = iso(NOW + timedelta(hours=4))
        state, action = evaluate_conversation_state(
            match_date_booked, [], cadence, now=NOW,
        )
        assert state == STATE_DATE_BOOKED_PENDING
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# Bump cap - don't double-bump
# ---------------------------------------------------------------------------

class TestBumpCap:
    def test_max_bumps_respected_opened(self, match_opened, cadence):
        match_opened["drip_count"] = 1
        match_opened["last_drip_at"] = days_ago(2)
        events = [
            {"sender": "us", "event_type": "opener_sent",
             "created_at": days_ago(3)},
        ]
        state, action = evaluate_conversation_state(
            match_opened, events, cadence, now=NOW,
        )
        assert action.kind == "noop"

    def test_max_bumps_respected_conversing(self, match_conversing, cadence):
        match_conversing["drip_count"] = 1
        match_conversing["last_drip_at"] = days_ago(2)
        match_conversing["last_activity_at"] = days_ago(3)
        state, action = evaluate_conversation_state(
            match_conversing, [], cadence, now=NOW,
        )
        assert action.kind == "noop"

    def test_cadence_max_bumps_2_allows_second_bump(self, match_opened, cadence):
        cadence = {**cadence, "max_bumps": 2}
        match_opened["drip_count"] = 1
        match_opened["last_drip_at"] = days_ago(2)
        events = [
            {"sender": "us", "event_type": "opener_sent",
             "created_at": days_ago(3)},
        ]
        state, action = evaluate_conversation_state(
            match_opened, events, cadence, now=NOW,
        )
        assert state == STATE_OPENED_NO_REPLY
        assert action.kind == "queue_draft"


# ---------------------------------------------------------------------------
# Cadence from persona (not hardcoded)
# ---------------------------------------------------------------------------

class TestCadenceFromPersona:
    def test_custom_cadence_longer_opener_window(self, match_opened):
        persona_cadence = {**DEFAULT_CADENCE, "opener_no_reply_hours": 48.0}
        events = [
            {"sender": "us", "event_type": "opener_sent", "created_at": hours_ago(30)},
        ]
        state, action = evaluate_conversation_state(
            match_opened, events, persona_cadence, now=NOW,
        )
        assert state == STATE_OPENED_WAITING
        assert action.kind == "noop"

        events = [
            {"sender": "us", "event_type": "opener_sent", "created_at": hours_ago(50)},
        ]
        state, action = evaluate_conversation_state(
            match_opened, events, persona_cadence, now=NOW,
        )
        assert state == STATE_OPENED_NO_REPLY

    def test_default_cadence_applied_when_persona_empty(self, match_opened):
        events = [
            {"sender": "us", "event_type": "opener_sent", "created_at": hours_ago(25)},
        ]
        state, action = evaluate_conversation_state(
            match_opened, events, {}, now=NOW,
        )
        assert state == STATE_OPENED_NO_REPLY


# ---------------------------------------------------------------------------
# Rate limit cooldown
# ---------------------------------------------------------------------------

class TestRateLimitCooldown:
    def test_recent_drip_blocks_new(self, match_conversing, cadence):
        match_conversing["last_drip_at"] = hours_ago(6)
        match_conversing["last_activity_at"] = days_ago(3)
        state, action = evaluate_conversation_state(
            match_conversing, [], cadence, now=NOW,
        )
        assert state == STATE_NOOP
        assert action.kind == "noop"
        assert "cooling down" in action.reason


# ---------------------------------------------------------------------------
# Outcome prompt fires EXACTLY once per date
# ---------------------------------------------------------------------------

class TestOutcomePromptOnce:
    def test_first_call_fires(self, match_date_booked, cadence):
        state, action = evaluate_conversation_state(
            match_date_booked, [], cadence, now=NOW,
        )
        assert state == STATE_DATE_PASSED_NO_OUTCOME
        assert action.kind == "prompt_outcome"

    def test_second_call_holds(self, match_date_booked, cadence):
        match_date_booked["outcome_prompted_at"] = hours_ago(1)
        state, action = evaluate_conversation_state(
            match_date_booked, [], cadence, now=NOW,
        )
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# Phase E pipeline integration - drafts are sanitized
# ---------------------------------------------------------------------------

class TestDrafterPipelineIntegration:
    def test_queue_draft_routes_through_phase_e(self, monkeypatch):
        """queue_draft MUST flow through drafter.run_pipeline (em-dash gets sanitized)."""
        captured = {}

        def fake_llm(prompt: str) -> str:
            captured["prompt"] = prompt
            return "hey \u2014 hows your week going"

        monkeypatch.setattr(drip_mod, "_call_llm_for_drip", fake_llm)

        messages = drip_mod._generate_sanitized_draft(
            prompt="write something nice to Emma",
            user_id=None,
        )
        assert messages, "pipeline returned no messages"
        joined = " ".join(messages)
        assert "\u2014" not in joined
        assert ";" not in joined
        assert captured["prompt"] == "write something nice to Emma"

    def test_discarded_draft_returns_empty(self, monkeypatch):
        """Draft with banned word must be dropped, not queued."""
        def banned_llm(prompt: str) -> str:
            return "let me delve into your bookshelf"

        monkeypatch.setattr(drip_mod, "_call_llm_for_drip", banned_llm)

        messages = drip_mod._generate_sanitized_draft(
            prompt="anything",
            user_id=None,
        )
        assert messages == []


# ---------------------------------------------------------------------------
# queue_drip_action - noop and dry-run paths
# ---------------------------------------------------------------------------

class TestQueueDripActionNoop:
    def test_noop_action_returns_skipped(self):
        action = DripAction(kind="noop", reason="nothing to do")
        result = queue_drip_action(
            match={"id": "m", "user_id": "u"}, action=action, dry_run=True,
        )
        assert result["fired"] is False
        assert result.get("skipped") is True

    def test_queue_draft_dry_run(self, match_opened, monkeypatch):
        def fake_llm(prompt: str) -> str:
            return "still around?"

        monkeypatch.setattr(drip_mod, "_call_llm_for_drip", fake_llm)

        action = DripAction(
            kind="queue_draft",
            prompt="bump Emma",
            context={"name": "Emma", "action_type": "soft_bump"},
            reason="test",
        )
        result = queue_drip_action(
            match=match_opened, action=action, dry_run=True,
        )
        assert result["fired"] is True
        assert result["messages"]
        assert result["queued_id"] is None


# ---------------------------------------------------------------------------
# Unknown status gracefully noops
# ---------------------------------------------------------------------------

class TestUnknownStatus:
    def test_unknown_status_noop(self, cadence):
        match = {
            "id": "m-wut",
            "user_id": "u-1",
            "status": "something_weird",
            "drip_count": 0,
        }
        state, action = evaluate_conversation_state(match, [], cadence, now=NOW)
        assert state == STATE_NOOP
        assert action.kind == "noop"
