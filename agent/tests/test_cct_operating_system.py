from datetime import datetime, timedelta, timezone
import sys
import types
from unittest.mock import patch

import pytest

from clapcheeks.autonomy.approval import ApprovalEnvelope, validate_send_approval_envelope
from clapcheeks.conversation.decision import (
    ConversationContext,
    ConversationState,
    NextAction,
    decide_conversation,
)
from clapcheeks.conversation.cadence import CadenceBand, calculate_cadence
from clapcheeks.followup.reactivation import ReactivationContext, evaluate_reactivation
from clapcheeks.photos.analytics import evidence_status
from clapcheeks.ai.reply import generate_reply, generate_reply_with_pipeline
from clapcheeks.conversation.manager import ConversationManager


def test_sensitive_context_forces_human_review_without_a_draft():
    decision = decide_conversation(
        ConversationContext(
            inbound_text="i hurt my ankle and i'm at urgent care",
            latest_sender="them",
            reciprocity_score=0.8,
            verified_context_facts=("she mentioned urgent care",),
        )
    )
    assert decision.state is ConversationState.SENSITIVE_CONTEXT
    assert decision.next_action is NextAction.HUMAN_REVIEW
    assert decision.draft_or_null is None


def test_date_logistics_advance_one_missing_field_at_a_time():
    decision = decide_conversation(
        ConversationContext(
            inbound_text="thursday works",
            latest_sender="them",
            reciprocity_score=0.9,
            prior_cta="date",
            proposed_day="thursday",
        )
    )
    assert decision.state is ConversationState.AWAITING_TIME
    assert decision.next_action is NextAction.CLARIFY_TIME


def test_recent_julian_message_suppresses_generation():
    decision = decide_conversation(
        ConversationContext(
            inbound_text="sounds fun",
            latest_sender="julian",
            reciprocity_score=0.9,
            julian_sent_at=datetime.now(timezone.utc) - timedelta(minutes=4),
        )
    )
    assert decision.state is ConversationState.JULIAN_ALREADY_HANDLING
    assert decision.next_action is NextAction.PAUSE
    assert decision.draft_or_null is None


def test_cadence_excludes_overnight_backfill_and_delivery_failures():
    cadence = calculate_cadence(
        recent_response_minutes=[8, 45, 700, 1_100, 3],
        overnight_indexes={3},
        backfill_indexes={4},
        delivery_failure_indexes={2},
        live_reciprocal=False,
    )
    assert cadence.band is CadenceBand.WARM_SAME_DAY
    assert cadence.minimum_minutes == 20
    assert cadence.maximum_minutes == 120


def test_reactivation_is_one_shot_specific_and_cta_aware():
    now = datetime.now(timezone.utc)
    candidate = evaluate_reactivation(
        ReactivationContext(
            native_thread_current=True,
            prior_reciprocity=True,
            identity_verified=True,
            specific_callback="her pottery class",
            latest_julian_outbound_at=now - timedelta(days=4),
            consecutive_unanswered_outbounds=1,
            prior_cta="phone",
            prior_reactivation_attempts=0,
        ),
        now=now,
    )
    assert candidate.eligible is True
    assert candidate.must_rebuild_reciprocity is True
    assert candidate.allow_off_app_request is False

    stopped = evaluate_reactivation(
        ReactivationContext(
            native_thread_current=True,
            prior_reciprocity=True,
            identity_verified=True,
            specific_callback="her pottery class",
            latest_julian_outbound_at=now - timedelta(days=4),
            consecutive_unanswered_outbounds=1,
            prior_reactivation_attempts=1,
        ),
        now=now,
    )
    assert stopped.eligible is False
    assert stopped.reason == "recovery_cycle_exhausted"


def test_approval_envelope_binds_recipient_channel_and_exact_body():
    envelope = ApprovalEnvelope.create(
        recipient="match_123",
        channel="hinge",
        exact_final_text="thursday or saturday work better for you?",
        source_packet_id="packet_abc",
        ttl_seconds=300,
    )
    assert envelope.verify(
        recipient="match_123",
        channel="hinge",
        exact_final_text="thursday or saturday work better for you?",
        now=envelope.approval_timestamp,
    )
    assert not envelope.verify(
        recipient="match_123",
        channel="hinge",
        exact_final_text="friday or saturday work better for you?",
        now=envelope.approval_timestamp,
    )
    assert not envelope.consume(
        recipient="wrong_match",
        channel="hinge",
        exact_final_text="thursday or saturday work better for you?",
        now=envelope.approval_timestamp,
    )
    assert envelope.consume(
        recipient="match_123",
        channel="hinge",
        exact_final_text="thursday or saturday work better for you?",
        now=envelope.approval_timestamp,
    )
    assert not envelope.consume(
        recipient="match_123",
        channel="hinge",
        exact_final_text="thursday or saturday work better for you?",
        now=envelope.approval_timestamp,
    )


@pytest.mark.parametrize(
    ("exposures", "matches", "expected"),
    [(0, 2, "insufficient evidence"), (8, 4, "insufficient evidence"), (100, 9, "measurable")],
)
def test_photo_experiments_require_denominators(exposures, matches, expected):
    assert evidence_status(exposures=exposures, matches=matches) == expected


def test_reply_generation_has_no_generic_fallback(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("KIMI_API_KEY", raising=False)
    monkeypatch.setitem(
        sys.modules,
        "ollama",
        types.SimpleNamespace(chat=lambda **_: (_ for _ in ()).throw(ConnectionError())),
    )
    with patch("clapcheeks.ai.reply.load_config", return_value={}):
        assert generate_reply([], "hinge") is None
        assert generate_reply_with_pipeline([], "hinge") == []


def test_sensitive_history_is_stopped_before_any_provider_call(monkeypatch):
    called = False

    def provider_call(**_):
        nonlocal called
        called = True
        return {"message": {"content": "should never be generated"}}

    monkeypatch.setitem(sys.modules, "ollama", types.SimpleNamespace(chat=provider_call))
    with patch("clapcheeks.ai.reply.load_config", return_value={}):
        assert generate_reply(
            [{"role": "user", "content": "i'm at urgent care after an injury"}],
            "hinge",
        ) is None
    assert called is False


def test_legacy_conversation_manager_is_always_shadow_only(monkeypatch):
    class FakeClient:
        sent: list[tuple[str, str]] = []

        def send_message(self, match_id, body):
            self.sent.append((match_id, body))
            return True

    client = FakeClient()
    manager = ConversationManager(client, "hinge", {"dry_run": False})
    monkeypatch.setattr(manager, "suggest_reply", lambda **_: "one exact draft")
    assert manager.send_opener({"id": "match_1", "name": "A"}) is True
    assert client.sent == []


def test_runner_rejects_body_edit_after_approval():
    envelope = ApprovalEnvelope.create(
        recipient="person_1",
        channel="imessage",
        exact_final_text="thursday or saturday?",
        source_packet_id="touch:1",
        ttl_seconds=300,
    )
    payload = {
        "person_id": "person_1",
        "draft_body": "friday or saturday?",
        "approval_envelope": {
            "verified_recipient": envelope.verified_recipient,
            "verified_channel": envelope.verified_channel,
            "exact_final_text": envelope.exact_final_text,
            "approval_timestamp": envelope.approval_timestamp * 1000,
            "expires_at": envelope.expires_at * 1000,
            "source_packet_id": envelope.source_packet_id,
            "recipient_channel_body_fingerprint": envelope.recipient_channel_body_fingerprint,
        },
    }
    assert validate_send_approval_envelope(payload, "friday or saturday?") is False
