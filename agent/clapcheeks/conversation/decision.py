"""Fail-closed conversation routing before any dating-message draft is generated."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class ConversationState(str, Enum):
    NEW_MATCH = "new_match"
    OPENER_SENT = "opener_sent"
    EARLY_RAPPORT = "early_rapport"
    ACTIVE_RAPPORT = "active_rapport"
    CONVERSION_READY = "conversion_ready"
    OFF_APP_REQUESTED = "off_app_requested"
    OFF_APP_COMPLETE = "off_app_complete"
    DATE_READY = "date_ready"
    DATE_PROPOSED = "date_proposed"
    AWAITING_DAY = "awaiting_day"
    AWAITING_TIME = "awaiting_time"
    AWAITING_PLACE = "awaiting_place"
    DATE_CONFIRMED = "date_confirmed"
    RESCHEDULE_REQUESTED = "reschedule_requested"
    POST_DATE = "post_date"
    FOLLOWUP_CANDIDATE = "followup_candidate"
    STALE_REACTIVATION_CANDIDATE = "stale_reactivation_candidate"
    DORMANT = "dormant"
    JULIAN_ALREADY_HANDLING = "julian_already_handling"
    IDENTITY_UNCERTAIN = "identity_uncertain"
    DELIVERY_FAILURE = "delivery_failure"
    BOUNDARY_OR_REJECTION = "boundary_or_rejection"
    SENSITIVE_CONTEXT = "sensitive_context"
    CLOSED = "closed"


class NextAction(str, Enum):
    ANSWER_AND_SHARE = "answer_and_share"
    SPECIFIC_QUESTION = "specific_question"
    PLAYFUL_CALLBACK = "playful_callback"
    LIGHT_TEASE = "light_tease"
    EMPATHETIC_RESPONSE = "empathetic_response"
    ASK_FOR_NUMBER = "ask_for_number"
    PROPOSE_DATE = "propose_date"
    CLARIFY_DAY = "clarify_day"
    CLARIFY_TIME = "clarify_time"
    CLARIFY_PLACE = "clarify_place"
    CONFIRM_PLAN = "confirm_plan"
    RESCHEDULE = "reschedule"
    POST_DATE_FOLLOWUP = "post_date_followup"
    SOFT_NUDGE = "soft_nudge"
    SPECIFIC_REACTIVATION = "specific_reactivation"
    PAUSE = "pause"
    HUMAN_REVIEW = "human_review"
    CLOSE = "close"


@dataclass(frozen=True)
class ConversationContext:
    inbound_text: str = ""
    latest_sender: str = "them"
    reciprocity_score: float = 0.0
    cadence_window: tuple[int, int] | None = None
    unanswered_outbound_count: int = 0
    prior_cta: str | None = None
    verified_context_facts: tuple[str, ...] = ()
    risk_flags: tuple[str, ...] = ()
    identity_verified: bool = True
    delivery_failed: bool = False
    julian_sent_at: datetime | None = None
    proposed_day: str | None = None
    proposed_time: str | None = None
    proposed_place: str | None = None
    boundary_or_rejection: bool = False
    closed: bool = False


@dataclass(frozen=True)
class ConversationDecision:
    state: ConversationState
    next_action: NextAction
    reciprocity_score: float
    cadence_window: tuple[int, int] | None
    unanswered_outbound_count: int
    prior_cta: str | None
    verified_context_facts: tuple[str, ...]
    risk_flags: tuple[str, ...]
    draft_or_null: str | None = None


_SENSITIVE_TERMS = (
    "urgent care",
    "hospital",
    "injury",
    "hurt my",
    "surgery",
    "assault",
    "unsafe",
    "panic attack",
    "grief",
)


def decide_conversation(
    context: ConversationContext,
    *,
    now: datetime | None = None,
) -> ConversationDecision:
    """Select exactly one action; pause/review/close decisions never include a draft."""
    now = now or datetime.now(timezone.utc)
    text = context.inbound_text.casefold()

    if context.closed:
        return _decision(context, ConversationState.CLOSED, NextAction.CLOSE)
    if context.boundary_or_rejection:
        return _decision(context, ConversationState.BOUNDARY_OR_REJECTION, NextAction.CLOSE)
    if not context.identity_verified:
        return _decision(context, ConversationState.IDENTITY_UNCERTAIN, NextAction.HUMAN_REVIEW)
    if context.delivery_failed:
        return _decision(context, ConversationState.DELIVERY_FAILURE, NextAction.HUMAN_REVIEW)
    if context.julian_sent_at is not None:
        sent_at = context.julian_sent_at
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        if 0 <= (now - sent_at).total_seconds() <= 600:
            return _decision(
                context,
                ConversationState.JULIAN_ALREADY_HANDLING,
                NextAction.PAUSE,
            )
    if context.risk_flags or any(term in text for term in _SENSITIVE_TERMS):
        return _decision(context, ConversationState.SENSITIVE_CONTEXT, NextAction.HUMAN_REVIEW)

    if context.prior_cta == "date":
        if not context.proposed_day:
            return _decision(context, ConversationState.AWAITING_DAY, NextAction.CLARIFY_DAY)
        if not context.proposed_time:
            return _decision(context, ConversationState.AWAITING_TIME, NextAction.CLARIFY_TIME)
        if not context.proposed_place:
            return _decision(context, ConversationState.AWAITING_PLACE, NextAction.CLARIFY_PLACE)
        return _decision(context, ConversationState.DATE_CONFIRMED, NextAction.CONFIRM_PLAN)

    if context.unanswered_outbound_count >= 2:
        return _decision(context, ConversationState.DORMANT, NextAction.PAUSE)
    if context.reciprocity_score >= 0.75:
        return _decision(context, ConversationState.CONVERSION_READY, NextAction.PROPOSE_DATE)
    if context.reciprocity_score >= 0.4:
        return _decision(context, ConversationState.ACTIVE_RAPPORT, NextAction.ANSWER_AND_SHARE)
    return _decision(context, ConversationState.EARLY_RAPPORT, NextAction.SPECIFIC_QUESTION)


def decision_from_history(
    conversation_history: list[dict[str, Any]],
    *,
    match_profile: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> ConversationDecision:
    """Build the mandatory pre-draft decision from available thread evidence."""
    profile = match_profile or {}
    latest = conversation_history[-1] if conversation_history else {}
    latest_sender = "julian" if latest.get("role") == "assistant" else "them"
    latest_inbound = (
        str(latest.get("content") or "") if latest_sender == "them" else ""
    )
    trailing_outbound = 0
    for message in reversed(conversation_history):
        if message.get("role") != "assistant":
            break
        trailing_outbound += 1
    inbound_count = sum(message.get("role") != "assistant" for message in conversation_history)
    outbound_count = sum(message.get("role") == "assistant" for message in conversation_history)
    if inbound_count >= 2 and outbound_count >= 1:
        reciprocity = 0.75
    elif inbound_count >= 1:
        reciprocity = 0.5
    else:
        reciprocity = 0.0
    risk_flags = tuple(
        str(flag)
        for message in conversation_history
        for flag in (message.get("risk_flags") or [])
    )
    verified_facts = tuple(str(fact) for fact in (profile.get("verified_context_facts") or []))
    julian_sent_at = profile.get("julian_sent_at")
    if not isinstance(julian_sent_at, datetime):
        julian_sent_at = None
    return decide_conversation(
        ConversationContext(
            inbound_text=latest_inbound,
            latest_sender=latest_sender,
            reciprocity_score=float(profile.get("reciprocity_score", reciprocity)),
            cadence_window=profile.get("cadence_window"),
            unanswered_outbound_count=int(
                profile.get("unanswered_outbound_count", trailing_outbound)
            ),
            prior_cta=profile.get("prior_cta"),
            verified_context_facts=verified_facts,
            risk_flags=risk_flags,
            identity_verified=bool(profile.get("identity_verified", True)),
            delivery_failed=bool(profile.get("delivery_failed", False)),
            julian_sent_at=julian_sent_at,
            proposed_day=profile.get("proposed_day"),
            proposed_time=profile.get("proposed_time"),
            proposed_place=profile.get("proposed_place"),
            boundary_or_rejection=bool(profile.get("boundary_or_rejection", False)),
            closed=bool(profile.get("closed", False)),
        ),
        now=now,
    )


def _decision(
    context: ConversationContext,
    state: ConversationState,
    action: NextAction,
) -> ConversationDecision:
    return ConversationDecision(
        state=state,
        next_action=action,
        reciprocity_score=max(0.0, min(1.0, context.reciprocity_score)),
        cadence_window=context.cadence_window,
        unanswered_outbound_count=max(0, context.unanswered_outbound_count),
        prior_cta=context.prior_cta,
        verified_context_facts=context.verified_context_facts,
        risk_flags=context.risk_flags,
        draft_or_null=None,
    )
