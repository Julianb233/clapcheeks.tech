"""Ghost-recovery / reactivation campaign tests — AI-8804.

Covers:
- 14d ghosted -> queue_reactivation (STATE_GHOSTED_REACTIVATABLE)
- 14d ghosted + reactivation_disabled=True -> noop
- 2 attempts exhausted -> mark_reactivation_burned (STATE_REACTIVATION_BURNED)
- reply after reactivation flips match to conversing (daemon exits ghosted arm)
- Quiet window prevents a second reactivation attempt too soon
- Sanitizer regression: banned reactivation opener phrases rejected

Run: pytest agent/tests/test_reactivation_campaign.py -v

PHASE-G2 - AI-8804
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from clapcheeks.followup.drip import (  # noqa: E402
    DEFAULT_CADENCE,
    DripAction,
    STATE_GHOSTED_REACTIVATABLE,
    STATE_NOOP,
    STATE_REACTIVATED_WAITING,
    STATE_REACTIVATION_BURNED,
    evaluate_conversation_state,
    queue_drip_action,
)
import clapcheeks.followup.drip as drip_mod  # noqa: E402
from clapcheeks.ai.sanitizer import sanitize_and_validate  # noqa: E402


NOW = datetime(2026, 4, 20, 12, 0, 0, tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def days_ago(d: float) -> str:
    return iso(NOW - timedelta(days=d))


def hours_ago(h: float) -> str:
    return iso(NOW - timedelta(hours=h))


@pytest.fixture
def cadence() -> dict:
    return {
        **DEFAULT_CADENCE,
        "reactivation_first_attempt_days": 14.0,
        "reactivation_followup_days": 45.0,
        "reactivation_max_attempts": 2,
        "reactivation_quiet_window_days": 60.0,
    }


@pytest.fixture
def match_ghosted():
    return {
        "id": "m-ghost",
        "user_id": "u-1",
        "platform": "hinge",
        "name": "Zoe",
        "status": "ghosted",
        "stage": "conversing",
        "ghost_stage": "conversing",
        "drip_count": 1,
        "last_drip_at": days_ago(20),
        "reactivation_count": 0,
        "last_reactivation_at": None,
        "reactivation_eligible_at": None,
        "reactivation_outcome": None,
        "reactivation_disabled": False,
        # Ghosted 15 days ago (> 14d threshold)
        "last_activity_at": days_ago(15),
        "outcome": None,
        "outcome_prompted_at": None,
    }


# ---------------------------------------------------------------------------
# Test 1: 14d ghosted -> queue_reactivation
# ---------------------------------------------------------------------------

class TestReactivationEligible:
    def test_14d_ghosted_queues_reactivation(self, match_ghosted, cadence):
        state, action = evaluate_conversation_state(
            match_ghosted, [], cadence, now=NOW,
        )
        assert state == STATE_GHOSTED_REACTIVATABLE, f"Expected reactivatable, got {state}"
        assert action.kind == "queue_reactivation"
        assert action.context.get("action_type") == "reactivation"
        assert action.context.get("reactivation_count") == 0
        assert action.prompt and "Zoe" in action.prompt

    def test_13d_ghosted_not_yet_eligible(self, match_ghosted, cadence):
        """Under the threshold — should not yet reactivate."""
        match_ghosted["last_activity_at"] = days_ago(13)
        state, action = evaluate_conversation_state(
            match_ghosted, [], cadence, now=NOW,
        )
        assert action.kind == "noop"
        assert state == STATE_NOOP


# ---------------------------------------------------------------------------
# Test 2: reactivation_disabled=True -> noop
# ---------------------------------------------------------------------------

class TestReactivationDisabled:
    def test_disabled_flag_prevents_reactivation(self, match_ghosted, cadence):
        match_ghosted["reactivation_disabled"] = True
        state, action = evaluate_conversation_state(
            match_ghosted, [], cadence, now=NOW,
        )
        assert state == STATE_NOOP
        assert action.kind == "noop"
        assert "reactivation_disabled" in action.reason


# ---------------------------------------------------------------------------
# Test 3: 2 attempts exhausted -> mark_reactivation_burned
# ---------------------------------------------------------------------------

class TestReactivationBurned:
    def test_max_attempts_triggers_burned_action(self, match_ghosted, cadence):
        match_ghosted["reactivation_count"] = 2  # == max_attempts (2)
        match_ghosted["last_reactivation_at"] = days_ago(50)
        state, action = evaluate_conversation_state(
            match_ghosted, [], cadence, now=NOW,
        )
        assert state == STATE_REACTIVATION_BURNED
        assert action.kind == "mark_reactivation_burned"
        assert "max" in action.reason

    def test_outcome_burned_is_terminal(self, match_ghosted, cadence):
        """If reactivation_outcome is already 'burned', state machine just noops."""
        match_ghosted["reactivation_outcome"] = "burned"
        state, action = evaluate_conversation_state(
            match_ghosted, [], cadence, now=NOW,
        )
        assert state == STATE_REACTIVATION_BURNED
        assert action.kind == "noop"

    def test_queue_reactivation_dry_run_fires_no_db(self, match_ghosted, monkeypatch):
        """queue_reactivation in dry-run must not patch Supabase."""
        patched = {"called": False}

        def fake_llm(prompt: str) -> str:
            return "hey how's it going"

        monkeypatch.setattr(drip_mod, "_call_llm_for_drip", fake_llm)
        monkeypatch.setattr(
            drip_mod,
            "_patch_match",
            lambda *a, **kw: patched.__setitem__("called", True) or True,
        )

        action = DripAction(
            kind="queue_reactivation",
            prompt="reactivate Zoe",
            context={
                "name": "Zoe",
                "action_type": "reactivation",
                "reactivation_count": 0,
            },
            reason="test",
        )
        result = queue_drip_action(
            match=match_ghosted, action=action, dry_run=True,
        )
        assert result["fired"] is True
        assert result["messages"]
        assert result["queued_id"] is None
        # In dry-run mode _patch_match must NOT be called
        assert not patched["called"]


# ---------------------------------------------------------------------------
# Test 4: reply after reactivation -> state machine exits ghosted arm
# ---------------------------------------------------------------------------

class TestReplyAfterReactivation:
    def test_reply_after_reactivation_routes_to_conversing_arm(self, cadence):
        """When a ghosted match replies, the platform ingest flips status to
        'conversing'. The state machine must handle that match in the
        conversing arm — not the ghosted arm — so reactivation does not re-fire.
        """
        match = {
            "id": "m-returned",
            "user_id": "u-1",
            "platform": "hinge",
            "name": "Zoe",
            "status": "conversing",    # platform ingest flipped this on reply
            "stage": "conversing",
            "drip_count": 1,
            "last_drip_at": days_ago(20),
            "last_activity_at": hours_ago(2),  # she replied 2h ago — very recent
            "reactivation_count": 1,
            "reactivation_outcome": None,
            "outcome": None,
            "outcome_prompted_at": None,
        }
        state, action = evaluate_conversation_state(
            match, [], cadence, now=NOW,
        )
        # Must NOT enter the ghosted-arm states
        assert state not in (
            STATE_GHOSTED_REACTIVATABLE,
            STATE_REACTIVATION_BURNED,
            STATE_REACTIVATED_WAITING,
        ), f"Unexpected ghosted-arm state after reply: {state}"
        # She just replied 2h ago — active conversation, so noop
        assert action.kind == "noop"


# ---------------------------------------------------------------------------
# Test 5: quiet window prevents a second immediate attempt
# ---------------------------------------------------------------------------

class TestReactivationQuietWindow:
    def test_quiet_window_blocks_second_attempt(self, match_ghosted, cadence):
        """If last_reactivation_at was only 10 days ago, don't fire again."""
        match_ghosted["reactivation_count"] = 1
        match_ghosted["last_reactivation_at"] = days_ago(10)  # within 60d quiet window
        state, action = evaluate_conversation_state(
            match_ghosted, [], cadence, now=NOW,
        )
        assert state == STATE_REACTIVATED_WAITING
        assert action.kind == "noop"
        assert "quiet window" in action.reason


# ---------------------------------------------------------------------------
# Sanitizer regression: banned reactivation opener phrases
# ---------------------------------------------------------------------------

REACTIVATION_BANNED_PHRASES = [
    "hey stranger",
    "long time no talk",
    "long time no see",
    "did i do something wrong",
]

REACTIVATION_BANNED_PERSONA = {
    "banned_words": REACTIVATION_BANNED_PHRASES,
}


class TestSanitizerReactivationBannedPhrases:
    @pytest.mark.parametrize("phrase", REACTIVATION_BANNED_PHRASES)
    def test_banned_phrase_is_rejected(self, phrase):
        """Reactivation openers that scream 'mass outreach' must be rejected
        by the sanitizer/validator when the persona.banned_words includes them.
        """
        draft = f"{phrase}, how have you been?"
        ok, cleaned, errors = sanitize_and_validate(
            draft,
            persona=REACTIVATION_BANNED_PERSONA,
            conversation_stage="mid",
        )
        assert not ok, (
            f"Expected draft to be rejected for banned phrase {phrase!r}, "
            f"but validator approved it. errors={errors!r}"
        )
        assert any(
            phrase.lower() in err.lower() or "banned_words" in err.lower()
            for err in errors
        ), f"Expected a banned_words error, got {errors!r}"
