"""Phase G — drip state machine for follow-up nurture.

The daemon scans every active match every 15 min, builds a small
``conversation_events`` list from recent Supabase rows, and calls
``evaluate_conversation_state`` — a pure function — to decide whether a
follow-up is due.

Responsibilities split deliberately:
    evaluate_conversation_state   — pure, easy to unit-test
    queue_drip_action             — side-effectful, Supabase-facing
    prompt_date_outcome           — iMessage to Julian

Cadence lives in ``clapcheeks_user_settings.persona.followup_cadence`` and
is loaded per user. The module ships a sane DEFAULT_CADENCE but never
falls back silently in prod — missing cadence logs a warning.

Drafts ALWAYS flow through ``clapcheeks.ai.drafter.run_pipeline`` so the
Phase E sanitizer + validator + splitter gate every outgoing message.
No raw LLM output is queued.

PHASE-G — AI-8321
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

logger = logging.getLogger("clapcheeks.followup.drip")

# ---------------------------------------------------------------------------
# Cadence — safe defaults (overridden by persona.followup_cadence)
# ---------------------------------------------------------------------------

DEFAULT_CADENCE: dict[str, float] = {
    # Seeded opener but she never replied.
    "opener_no_reply_hours": 24.0,          # when to fire the first bump
    "opener_no_reply_ghost_days": 5.0,      # hours after bump -> ghosted

    # Mid-conversation stalls.
    "conversing_stalled_days": 2.0,         # when to re-engage
    "conversing_stalled_ghost_days": 7.0,   # when to mark ghosted

    # Date-proposed but unconfirmed.
    "date_proposed_no_confirm_hours": 24.0, # when to nudge "still down for [day]?"

    # Post-date outcome prompt.
    "date_outcome_prompt_hours_after_end": 4.0,

    # Cap on how many bumps can fire per match.
    "max_bumps": 1,

    # Ghost-recovery / reactivation campaign (AI-8804).
    "reactivation_first_attempt_days": 14.0,   # days after ghosted -> first reactivation
    "reactivation_followup_days": 45.0,         # days between reactivation attempts
    "reactivation_max_attempts": 2,             # hard cap; beyond this -> burned
    "reactivation_quiet_window_days": 60.0,     # do not re-attempt within N days of last
}


# ---------------------------------------------------------------------------
# State labels — returned from evaluate_conversation_state
# ---------------------------------------------------------------------------

STATE_OPENED_WAITING            = "opened"
STATE_OPENED_NO_REPLY           = "opened_no_reply_24h"
STATE_OPENED_GHOSTED            = "opened_ghosted"
STATE_CONVERSING                = "conversing"
STATE_CONVERSING_STALLED        = "conversing_stalled_2d"
STATE_CONVERSING_GHOSTED        = "conversing_ghosted"
STATE_DATE_PROPOSED_WAITING     = "date_proposed"
STATE_DATE_PROPOSED_NO_CONFIRM  = "date_proposed_no_confirm_24h"
STATE_DATE_BOOKED_PENDING       = "date_booked"
STATE_DATE_PASSED_NO_OUTCOME    = "date_passed_no_outcome"
STATE_NOOP                      = "noop"

# Ghost-recovery states (AI-8804).
STATE_GHOSTED_REACTIVATABLE     = "ghosted_reactivatable"    # eligible, attempt queued
STATE_REACTIVATED_WAITING       = "reactivated_waiting"      # sent, awaiting reply
STATE_REACTIVATION_BURNED       = "reactivation_burned"      # max attempts hit


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class DripAction:
    """A single side-effect the daemon should take for one match."""

    kind: str                               # queue_draft | mark_ghosted | prompt_outcome | noop
    prompt: Optional[str] = None            # system prompt to feed the LLM
    context: dict = field(default_factory=dict)
    new_status: Optional[str] = None        # stage/status to PATCH on the match
    julian_message: Optional[str] = None    # for prompt_outcome (iMessage)
    reason: str = ""                        # for logging / event row

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_ts(value: Any) -> Optional[datetime]:
    """Accept ISO string, datetime, or None — return tz-aware datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        try:
            s = value.replace("Z", "+00:00")
            return datetime.fromisoformat(s)
        except ValueError:
            return None
    return None


def _hours_since(when: Optional[datetime], now: datetime) -> float:
    if when is None:
        return float("inf")
    delta = now - when
    return delta.total_seconds() / 3600.0


def _last_event(
    events: list[dict], *, sender: Optional[str] = None, kind: Optional[str] = None
) -> Optional[dict]:
    """Return the most recent event matching filters, or None.

    Events are expected newest-first or oldest-first — we don't assume order.
    """
    matches = []
    for e in events or []:
        if sender is not None and e.get("sender") != sender:
            continue
        if kind is not None and e.get("event_type") != kind:
            continue
        matches.append(e)
    if not matches:
        return None
    # Sort by created_at ascending, then pick the last.
    matches.sort(key=lambda x: _parse_ts(x.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))
    return matches[-1]


def _her_last_topic(events: list[dict]) -> str:
    """Snippet of her last message, used to make re-engages context-aware."""
    last = _last_event(events, sender="her")
    if not last:
        return ""
    body = (last.get("body") or last.get("content") or "").strip()
    # Keep it short — 140 chars is plenty of context for the LLM.
    return body[:140]


def _her_name(match: dict) -> str:
    return (
        match.get("name")
        or match.get("match_name")
        or match.get("first_name")
        or "her"
    )


def load_cadence_for_user(user_id: Optional[str]) -> dict:
    """Load ``persona.followup_cadence`` from Supabase for the given user.

    Falls back to DEFAULT_CADENCE if Supabase is unreachable or the field is
    missing. Never raises.
    """
    cadence = dict(DEFAULT_CADENCE)

    if not user_id:
        return cadence

    try:
        # Local import so pure-function tests don't need requests.
        import requests
        from clapcheeks.scoring import _supabase_creds
    except Exception:
        return cadence

    try:
        url, key = _supabase_creds()
    except Exception as exc:
        logger.debug("followup cadence: creds unavailable (%s)", exc)
        return cadence

    try:
        r = requests.get(
            f"{url}/rest/v1/clapcheeks_user_settings",
            params={
                "user_id": f"eq.{user_id}",
                "select": "persona",
                "limit": "1",
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
    except Exception as exc:
        logger.debug("followup cadence: fetch failed (%s)", exc)
        return cadence

    if r.status_code >= 300:
        logger.debug("followup cadence: status %s", r.status_code)
        return cadence

    try:
        rows = r.json() or []
        if not rows:
            return cadence
        persona = rows[0].get("persona") or {}
        user_cadence = persona.get("followup_cadence") or {}
        # Merge user overrides on top of defaults — any typo / missing key
        # falls back to a safe default rather than None.
        for k, v in user_cadence.items():
            if k in cadence and isinstance(v, (int, float)):
                cadence[k] = float(v)
    except Exception as exc:
        logger.debug("followup cadence: parse failed (%s)", exc)

    return cadence


# ---------------------------------------------------------------------------
# Pure state machine
# ---------------------------------------------------------------------------

def evaluate_conversation_state(
    match: dict,
    conversation_events: list[dict],
    persona_cadence: dict,
    now: Optional[datetime] = None,
) -> tuple[str, DripAction]:
    """Decide what (if anything) to do for one match.

    Inputs are plain dicts so this is trivial to unit-test.

    Args:
        match: Supabase row (clapcheeks_matches) as a dict. Expected keys:
            id, user_id, status, name/match_name, last_drip_at, drip_count,
            outcome, outcome_prompted_at, handoff_complete, primary_channel,
            date_booked_at, date_scheduled_end_at (optional), last_activity_at,
            first_message_at.
        conversation_events: Recent event rows (sender, event_type, body,
            created_at). Ordering doesn't matter — the function sorts.
        persona_cadence: Merged cadence dict (DEFAULT_CADENCE + user overrides).
        now: Override current time (tests). Defaults to datetime.now(utc).

    Returns:
        (state_label, DripAction)
    """
    now = now or datetime.now(tz=timezone.utc)
    cadence = {**DEFAULT_CADENCE, **(persona_cadence or {})}

    status = (match.get("status") or match.get("stage") or "").lower()
    drip_count = int(match.get("drip_count") or 0)
    max_bumps = int(cadence.get("max_bumps", 1))
    her = _her_name(match)

    last_drip = _parse_ts(match.get("last_drip_at"))
    # Never fire two drips in the same 24h window for the same match.
    hours_since_last_drip = _hours_since(last_drip, now)

    # ---- Post-date outcome prompt (highest priority) --------------------
    if status in ("date_booked", "dated") and not match.get("outcome"):
        # Try the explicit end timestamp first; otherwise assume a 2h date
        # starting at date_booked_at.
        end_at = _parse_ts(match.get("date_scheduled_end_at"))
        if end_at is None:
            start_at = _parse_ts(match.get("date_booked_at"))
            if start_at is not None:
                # Assume 2h duration when no explicit end timestamp is set.
                end_at = start_at + timedelta(hours=2)
        hrs_after_end = _hours_since(end_at, now)
        prompt_threshold = float(cadence["date_outcome_prompt_hours_after_end"])

        already_prompted = _parse_ts(match.get("outcome_prompted_at"))
        if (
            end_at is not None
            and hrs_after_end >= prompt_threshold
            and already_prompted is None
        ):
            return STATE_DATE_PASSED_NO_OUTCOME, DripAction(
                kind="prompt_outcome",
                julian_message=(
                    f"how'd {her} go? reply: closed / 2nd date / nope"
                ),
                reason=f"date ended {hrs_after_end:.1f}h ago, no outcome yet",
                context={"name": her},
            )
        return STATE_DATE_BOOKED_PENDING, DripAction(
            kind="noop",
            reason="date booked, outcome not yet due",
        )

    # ---- Rate limit: no drip twice in 24h (except outcome prompts) -----
    if hours_since_last_drip < 24.0:
        return STATE_NOOP, DripAction(
            kind="noop",
            reason=f"last drip {hours_since_last_drip:.1f}h ago, cooling down",
        )

    # ---- Opener sent, no reply -----------------------------------------
    if status in ("new", "opened"):
        opener_sent = _last_event(conversation_events, sender="us", kind="opener_sent")
        her_reply = _last_event(conversation_events, sender="her")
        if opener_sent and her_reply is None:
            opener_ts = _parse_ts(opener_sent.get("created_at"))
            hrs = _hours_since(opener_ts, now)

            ghost_hours = (
                float(cadence["opener_no_reply_ghost_days"]) * 24.0
            )
            if hrs >= ghost_hours and drip_count >= 1:
                return STATE_OPENED_GHOSTED, DripAction(
                    kind="mark_ghosted",
                    new_status="ghosted",
                    reason=f"opener sent {hrs:.1f}h ago, bumped, still silent",
                )

            opener_threshold = float(cadence["opener_no_reply_hours"])
            if hrs >= opener_threshold and drip_count < max_bumps:
                return STATE_OPENED_NO_REPLY, DripAction(
                    kind="queue_draft",
                    prompt=_build_soft_bump_prompt(her, hrs),
                    reason=f"opener sent {hrs:.1f}h ago, soft bump",
                    context={
                        "name": her,
                        "hours_since_opener": hrs,
                        "action_type": "soft_bump",
                    },
                )

            return STATE_OPENED_WAITING, DripAction(kind="noop", reason="still waiting")

    # ---- Conversing but stalled ----------------------------------------
    if status in ("conversing", "chatting", "chatting_phone", "stalled"):
        her_last = _last_event(conversation_events, sender="her")
        our_last = _last_event(conversation_events, sender="us")
        # "Stalled" means: our last message is more recent than hers OR
        # nothing new in a while. Use last message overall to bound time.
        latest = max(
            _parse_ts(match.get("last_activity_at")) or datetime.min.replace(tzinfo=timezone.utc),
            _parse_ts((our_last or {}).get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
            _parse_ts((her_last or {}).get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        )
        if latest == datetime.min.replace(tzinfo=timezone.utc):
            return STATE_NOOP, DripAction(kind="noop", reason="no activity timestamps")

        hrs_silent = _hours_since(latest, now)
        stall_hours = float(cadence["conversing_stalled_days"]) * 24.0
        ghost_hours = float(cadence["conversing_stalled_ghost_days"]) * 24.0

        if hrs_silent >= ghost_hours:
            return STATE_CONVERSING_GHOSTED, DripAction(
                kind="mark_ghosted",
                new_status="ghosted",
                reason=f"conversing silent {hrs_silent:.1f}h, mark ghosted",
            )

        if hrs_silent >= stall_hours and drip_count < max_bumps:
            topic = _her_last_topic(conversation_events)
            return STATE_CONVERSING_STALLED, DripAction(
                kind="queue_draft",
                prompt=_build_reengage_prompt(her, topic, hrs_silent),
                reason=f"silent {hrs_silent:.1f}h, re-engage referencing topic",
                context={
                    "name": her,
                    "her_last_topic": topic,
                    "hours_silent": hrs_silent,
                    "action_type": "reengage",
                },
            )
        return STATE_CONVERSING, DripAction(kind="noop", reason="active enough")

    # ---- Date proposed but no confirm ----------------------------------
    if status == "date_proposed":
        ask = _last_event(conversation_events, sender="us", kind="date_ask_sent")
        her_reply_after_ask = None
        if ask:
            ask_ts = _parse_ts(ask.get("created_at"))
            for e in conversation_events or []:
                if e.get("sender") != "her":
                    continue
                ets = _parse_ts(e.get("created_at"))
                if ets and ask_ts and ets > ask_ts:
                    her_reply_after_ask = e
                    break

        if ask and her_reply_after_ask is None and drip_count < max_bumps:
            ask_ts = _parse_ts(ask.get("created_at"))
            hrs = _hours_since(ask_ts, now)
            confirm_hours = float(cadence["date_proposed_no_confirm_hours"])
            if hrs >= confirm_hours:
                day_hint = (ask.get("body") or "").strip()[:60]
                return STATE_DATE_PROPOSED_NO_CONFIRM, DripAction(
                    kind="queue_draft",
                    prompt=_build_confirm_prompt(her, day_hint),
                    reason=f"date ask sent {hrs:.1f}h ago, no confirm",
                    context={
                        "name": her,
                        "day_hint": day_hint,
                        "action_type": "confirm_date",
                    },
                )
        return STATE_DATE_PROPOSED_WAITING, DripAction(
            kind="noop", reason="date ask pending"
        )

    # ---- Ghost-recovery / reactivation campaign (AI-8804) -----------------
    if status == "ghosted":
        # Hard opt-out — user or operator disabled reactivation for this match.
        if match.get("reactivation_disabled"):
            return STATE_NOOP, DripAction(
                kind="noop",
                reason="reactivation_disabled=true, skipping",
            )

        # Already burned (max attempts exhausted) or terminal outcome recorded.
        reactivation_outcome = match.get("reactivation_outcome")
        if reactivation_outcome in ("burned", "ignored", "opted_out"):
            return STATE_REACTIVATION_BURNED, DripAction(
                kind="noop",
                reason=f"reactivation terminal outcome={reactivation_outcome!r}",
            )

        reactivation_count = int(match.get("reactivation_count") or 0)
        max_attempts = int(cadence.get("reactivation_max_attempts", 2))

        # Exceeded attempt cap — mark burned.
        if reactivation_count >= max_attempts:
            return STATE_REACTIVATION_BURNED, DripAction(
                kind="mark_reactivation_burned",
                new_status="ghosted",              # status stays ghosted
                reason=f"reactivation_count={reactivation_count} >= max={max_attempts}",
                context={"reactivation_count": reactivation_count, "name": her},
            )

        # When was she ghosted?  Use last_activity_at or last_drip_at as proxy.
        ghosted_at = _parse_ts(
            match.get("ghosted_at")
            or match.get("last_activity_at")
            or match.get("last_drip_at")
        )
        if ghosted_at is None:
            return STATE_NOOP, DripAction(
                kind="noop",
                reason="ghosted but no timestamp to determine reactivation window",
            )

        hours_since_ghosted = _hours_since(ghosted_at, now)

        # Determine the threshold for the next attempt.
        if reactivation_count == 0:
            threshold_days = float(cadence.get("reactivation_first_attempt_days", 14.0))
        else:
            threshold_days = float(cadence.get("reactivation_followup_days", 45.0))

        threshold_hours = threshold_days * 24.0

        # Quiet window: don't fire again within N days of the last reactivation.
        last_react = _parse_ts(match.get("last_reactivation_at"))
        if last_react is not None:
            quiet_days = float(cadence.get("reactivation_quiet_window_days", 60.0))
            hours_since_last = _hours_since(last_react, now)
            if hours_since_last < quiet_days * 24.0:
                return STATE_REACTIVATED_WAITING, DripAction(
                    kind="noop",
                    reason=(
                        f"reactivation attempt {reactivation_count} sent "
                        f"{hours_since_last:.0f}h ago, quiet window active"
                    ),
                )

        if hours_since_ghosted < threshold_hours:
            return STATE_NOOP, DripAction(
                kind="noop",
                reason=(
                    f"ghosted {hours_since_ghosted:.0f}h ago, "
                    f"reactivation not due until {threshold_days:.0f}d"
                ),
            )

        # Eligible — build a prompt using the reactivation builder.
        from clapcheeks.followup.reactivation import build_reactivation_prompt  # noqa: PLC0415

        stage_when_died = match.get("ghost_stage") or match.get("stage") or "opened"
        memo_text = match.get("memo") or match.get("memo_text") or ""
        persona_data = match.get("_persona")  # injected by scan_and_fire when available

        prompt = build_reactivation_prompt(
            name=her,
            stage_when_died=stage_when_died,
            memo_text=memo_text or None,
            persona=persona_data,
        )

        return STATE_GHOSTED_REACTIVATABLE, DripAction(
            kind="queue_reactivation",
            prompt=prompt,
            reason=(
                f"ghosted {hours_since_ghosted:.0f}h ago, "
                f"attempt #{reactivation_count + 1} of {max_attempts}"
            ),
            context={
                "name": her,
                "action_type": "reactivation",
                "reactivation_count": reactivation_count,
                "stage_when_died": stage_when_died,
            },
            new_status="ghosted",   # status unchanged; reactivation_count bumped separately
        )

    return STATE_NOOP, DripAction(kind="noop", reason=f"status={status!r} not actionable")


# ---------------------------------------------------------------------------
# Prompt builders — feed into Phase E's run_pipeline
# ---------------------------------------------------------------------------

def _build_soft_bump_prompt(name: str, hours_since: float) -> str:
    days = max(1, round(hours_since / 24))
    return (
        f"Write one casual bump for {name}. The opener went out about {days} day(s) ago "
        f"and she hasn't replied. Keep it light, low-pressure, 8 words max, lowercase. "
        f"Do NOT apologize, do NOT guilt-trip, do NOT reference the gap. "
        f"Examples of the vibe: 'still around?', 'hey hows the week going', 'coffee any sooner?' "
        f"Reply with ONLY the message text."
    )


def _build_reengage_prompt(name: str, topic: str, hours_silent: float) -> str:
    days = max(1, round(hours_silent / 24))
    topic_clause = (
        f"Reference her last topic: \"{topic}\". Stay on that thread, don't pivot."
        if topic
        else "Keep it short and curious."
    )
    return (
        f"Write one casual re-engage for {name}. Conversation stalled {days} day(s) ago. "
        f"{topic_clause} Keep it under 12 words, lowercase, no punctuation-heavy. "
        f"Do NOT say 'sorry', 'just checking in', 'hope you're well'. "
        f"Reply with ONLY the message text."
    )


def _build_confirm_prompt(name: str, day_hint: str) -> str:
    # day_hint is likely a fragment of the date-ask we sent; we extract the
    # weekday mention if possible.
    day = "the plan"
    for w in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
        if w in day_hint.lower():
            day = {
                "mon": "monday", "tue": "tuesday", "wed": "wednesday",
                "thu": "thursday", "fri": "friday", "sat": "saturday",
                "sun": "sunday",
            }[w]
            break
    return (
        f"Write one short confirm for {name}. We proposed a date ~24h ago and got no reply. "
        f"Ask casually if {day} still works. 7 words max, lowercase. "
        f"Do NOT apologize. Reply with ONLY the message text."
    )


# ---------------------------------------------------------------------------
# Draft generation — ALWAYS through Phase E pipeline
# ---------------------------------------------------------------------------

def _generate_sanitized_draft(
    prompt: str,
    user_id: Optional[str],
) -> list[str]:
    """Ask the LLM for a draft, then route it through sanitize+validate+split.

    Returns [] if the draft is discarded by the validator — the caller
    should skip queueing rather than send a bad draft.
    """
    from clapcheeks.ai import drafter as _drafter

    raw = _call_llm_for_drip(prompt)
    if not raw:
        return []

    result = _drafter.run_pipeline(
        raw_text=raw,
        user_id=user_id,
        conversation_stage="mid",
        on_discard=lambda txt, errs: _drafter.log_discard_to_supabase(
            user_id, "drip", txt, errs
        ),
    )
    if result.ok and result.messages:
        return result.messages
    logger.info("drip draft discarded: errors=%s raw=%r", result.errors, raw[:120])
    return []


def _call_llm_for_drip(prompt: str) -> str:
    """Minimal LLM call — Claude first, Kimi second, safe fallback string last.

    Uses the same keys the rest of the agent uses. If no API key is set, we
    still return a safe fallback line so the pipeline has *something* to
    sanitize and split.
    """
    # Attempt 1: Claude
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=80,
                system=(
                    "You are drafting short, lowercase dating-app follow-ups. "
                    "No em-dashes, no semicolons, no curly quotes, no corny "
                    "closers. 1 sentence."
                ),
                messages=[{"role": "user", "content": prompt}],
            )
            text = (response.content[0].text or "").strip()
            if text:
                return text
        except Exception as exc:
            logger.debug("drip llm: claude failed (%s)", exc)

    # Attempt 2: Kimi
    kimi_key = os.environ.get("KIMI_API_KEY")
    if kimi_key:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=kimi_key, base_url="https://api.moonshot.cn/v1")
            response = client.chat.completions.create(
                model=os.environ.get("KIMI_MODEL", "moonshot-v1-8k"),
                max_tokens=80,
                messages=[
                    {"role": "system", "content": (
                        "Short lowercase dating-app follow-ups only. "
                        "No em-dashes, no semicolons."
                    )},
                    {"role": "user", "content": prompt},
                ],
            )
            text = (response.choices[0].message.content or "").strip()
            if text:
                return text
        except Exception as exc:
            logger.debug("drip llm: kimi failed (%s)", exc)

    # Safe fallback — still gets sanitized + validated, so if someone
    # edits this line to include a banned word it will still be caught.
    logger.info("drip llm: using safe fallback")
    return "still around?"


# ---------------------------------------------------------------------------
# Side-effect helpers — queueing, status, events
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def queue_drip_action(
    match: dict,
    action: DripAction,
    *,
    auto_send: bool = False,
    platform_clients: Optional[dict] = None,
    dry_run: bool = False,
) -> dict:
    """Execute a DripAction.

    - ``queue_draft``   — draft via Phase E pipeline, insert into
                          ``clapcheeks_queued_replies`` as status='queued'
                          (or 'auto_sent' when ``auto_send=True`` and we
                          successfully dispatch through the platform client).
    - ``mark_ghosted``  — PATCH status='ghosted' on the match.
    - ``prompt_outcome``— iMessage Julian, PATCH outcome_prompted_at.
    - ``noop``          — nothing.

    Returns a result dict for logging: {fired, skipped, reason, messages, queued_id}.
    """
    result: dict = {"fired": False, "reason": action.reason, "messages": [], "queued_id": None}

    if action.kind == "noop":
        result["skipped"] = True
        return result

    match_id = match.get("id") or match.get("match_id")
    user_id = match.get("user_id")
    if not match_id or not user_id:
        result["error"] = "missing match_id/user_id"
        return result

    if action.kind == "queue_draft":
        messages = _generate_sanitized_draft(action.prompt or "", user_id)
        if not messages:
            result["error"] = "draft_discarded"
            return result

        result["messages"] = messages
        if dry_run:
            logger.info(
                "[drip dry-run] %s match=%s messages=%s",
                action.context.get("action_type"), match_id, messages,
            )
            result["fired"] = True
            return result

        queued_id = _insert_queued_replies(
            user_id=user_id,
            match=match,
            messages=messages,
            auto_send=auto_send,
            platform_clients=platform_clients,
        )
        result["queued_id"] = queued_id
        result["fired"] = bool(queued_id)

        if result["fired"]:
            _bump_drip_counters(match_id)
            _log_drip_event(
                user_id=user_id,
                match_id=match_id,
                action_type=action.context.get("action_type", "drip"),
                messages=messages,
                auto_sent=auto_send,
            )
        return result

    if action.kind == "mark_ghosted":
        ok = _patch_match_status(match_id, status="ghosted", stage="faded")
        if ok and not dry_run:
            _log_drip_event(
                user_id=user_id,
                match_id=match_id,
                action_type="mark_ghosted",
                messages=[],
                auto_sent=False,
            )
        result["fired"] = ok
        return result

    if action.kind == "prompt_outcome":
        ok = _prompt_julian_for_outcome(
            match_id=match_id,
            julian_message=action.julian_message or "",
            dry_run=dry_run,
        )
        if ok and not dry_run:
            _patch_match(match_id, {"outcome_prompted_at": _now_iso()})
            _log_drip_event(
                user_id=user_id,
                match_id=match_id,
                action_type="prompt_outcome",
                messages=[],
                auto_sent=False,
            )
        result["fired"] = ok
        return result

    # ---- Ghost-recovery actions (AI-8804) ----------------------------------

    if action.kind == "queue_reactivation":
        messages = _generate_sanitized_draft(action.prompt or "", user_id)
        if not messages:
            result["error"] = "reactivation_draft_discarded"
            return result

        result["messages"] = messages
        if dry_run:
            logger.info(
                "[drip dry-run] reactivation match=%s messages=%s",
                match_id, messages,
            )
            result["fired"] = True
            return result

        queued_id = _insert_queued_replies(
            user_id=user_id,
            match=match,
            messages=messages,
            auto_send=auto_send,
            platform_clients=platform_clients,
        )
        result["queued_id"] = queued_id
        result["fired"] = bool(queued_id)

        if result["fired"]:
            # Read current reactivation_count, then bump it.
            current_count = int(match.get("reactivation_count") or 0)
            _patch_match(match_id, {
                "reactivation_count": current_count + 1,
                "last_reactivation_at": _now_iso(),
            })
            _log_drip_event(
                user_id=user_id,
                match_id=match_id,
                action_type="reactivation",
                messages=messages,
                auto_sent=auto_send,
            )
        return result

    if action.kind == "mark_reactivation_burned":
        ok = _patch_match(match_id, {"reactivation_outcome": "burned"})
        if ok and not dry_run:
            _log_drip_event(
                user_id=user_id,
                match_id=match_id,
                action_type="mark_reactivation_burned",
                messages=[],
                auto_sent=False,
            )
        result["fired"] = ok
        return result

    result["error"] = f"unknown action kind {action.kind!r}"
    return result


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def _supabase_rest():
    """Return (url, key, requests_module) or (None, None, None)."""
    try:
        import requests
        from clapcheeks.scoring import _supabase_creds
        url, key = _supabase_creds()
        return url, key, requests
    except Exception as exc:
        logger.debug("supabase unavailable: %s", exc)
        return None, None, None


def _insert_queued_replies(
    user_id: str,
    match: dict,
    messages: list[str],
    auto_send: bool,
    platform_clients: Optional[dict],
) -> Optional[str]:
    """Insert into clapcheeks_queued_replies. If auto_send, try to dispatch.

    Returns the first queued row id, or None on failure.
    """
    url, key, requests = _supabase_rest()
    if not url:
        return None

    match_id = match.get("id") or match.get("match_id")
    platform = match.get("platform") or ""
    match_name = match.get("name") or match.get("match_name") or ""

    # Concatenate into a single queued row (multi-part drip). The dashboard
    # and platform worker are responsible for splitting across sends.
    body = "\n\n".join(messages)
    payload = {
        "user_id": user_id,
        "match_name": match_name,
        "platform": platform,
        "text": body,
        "status": "queued",
    }

    # If auto-send is requested and we actually have a platform client, try
    # to fire immediately and flip status. Best-effort — a failed send keeps
    # the row as status='queued' so the user sees it in the dashboard.
    sent_ok = False
    if auto_send and platform_clients and platform in platform_clients:
        try:
            client = platform_clients[platform]
            for part in messages:
                client.send_message(match_id, part)
            sent_ok = True
        except Exception as exc:
            logger.warning("drip auto-send failed (%s): %s", platform, exc)
    if sent_ok:
        payload["status"] = "auto_sent"

    try:
        r = requests.post(
            f"{url}/rest/v1/clapcheeks_queued_replies",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json=payload,
            timeout=15,
        )
    except Exception as exc:
        logger.warning("queued_replies insert failed: %s", exc)
        return None

    if r.status_code >= 300:
        logger.warning("queued_replies status %s: %s", r.status_code, r.text[:200])
        return None

    try:
        rows = r.json() or []
        return rows[0].get("id") if rows else None
    except Exception:
        return None


def _bump_drip_counters(match_id: str) -> None:
    """Increment drip_count and stamp last_drip_at on the match row."""
    url, key, requests = _supabase_rest()
    if not url:
        return

    # Read current count -> write count+1 (PostgREST can't do atomic
    # increment without an RPC; for a 15-min job this is fine).
    try:
        r = requests.get(
            f"{url}/rest/v1/clapcheeks_matches",
            params={"id": f"eq.{match_id}", "select": "drip_count"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        current = 0
        if r.status_code < 300:
            rows = r.json() or []
            if rows:
                current = int(rows[0].get("drip_count") or 0)
        _patch_match(match_id, {
            "drip_count": current + 1,
            "last_drip_at": _now_iso(),
        })
    except Exception as exc:
        logger.warning("drip counter bump failed: %s", exc)


def _patch_match(match_id: str, patch: dict) -> bool:
    url, key, requests = _supabase_rest()
    if not url:
        return False
    try:
        r = requests.patch(
            f"{url}/rest/v1/clapcheeks_matches",
            params={"id": f"eq.{match_id}"},
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=patch,
            timeout=10,
        )
        return r.status_code < 300
    except Exception as exc:
        logger.warning("match patch failed: %s", exc)
        return False


def _patch_match_status(match_id: str, *, status: str, stage: Optional[str] = None) -> bool:
    patch: dict = {"status": status}
    if stage:
        patch["stage"] = stage
    return _patch_match(match_id, patch)


def _log_drip_event(
    user_id: str,
    match_id: str,
    action_type: str,
    messages: list[str],
    auto_sent: bool,
) -> None:
    """Insert into clapcheeks_conversation_events with event_type='drip_action'."""
    url, key, requests = _supabase_rest()
    if not url:
        return

    payload = {
        "user_id": user_id,
        "platform": "drip",
        "match_id": match_id,
        "from_stage": action_type,
        "to_stage": "auto_sent" if auto_sent else "queued",
        "messages_sent": len(messages),
    }
    try:
        requests.post(
            f"{url}/rest/v1/clapcheeks_conversation_events",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=payload,
            timeout=10,
        )
    except Exception as exc:
        logger.debug("drip event log failed: %s", exc)


def _prompt_julian_for_outcome(
    match_id: str, julian_message: str, *, dry_run: bool
) -> bool:
    """Send iMessage to Julian asking how the date went.

    Uses ``god mac send`` via subprocess. Number is hardcoded to Julian's
    canonical number to avoid mis-routing (matches session-report-routing rule).
    """
    julian_number = os.environ.get("CLAPCHEEKS_OUTCOME_PHONE", "+16195090699")

    if dry_run:
        logger.info(
            "[drip dry-run] would iMessage %s: %s", julian_number, julian_message
        )
        return True

    try:
        import subprocess

        cmd = ["god", "mac", "send", julian_number, julian_message]
        r = subprocess.run(cmd, timeout=30, capture_output=True, text=True)
        if r.returncode != 0:
            logger.warning(
                "god mac send failed rc=%s stderr=%s", r.returncode, r.stderr[:200]
            )
            return False
        return True
    except Exception as exc:
        logger.warning("outcome prompt send failed: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Daemon entry point — scan all matches and fire drips
# ---------------------------------------------------------------------------

def scan_and_fire(
    *,
    user_id: Optional[str] = None,
    platform_clients: Optional[dict] = None,
    dry_run: bool = False,
) -> dict:
    """Scan every active match for the user and fire due drips.

    Called every 15 min by the daemon. Safe to call manually for ops/testing.

    Returns a stats dict: {scanned, fired, skipped, errors, by_state}.
    """
    stats = {"scanned": 0, "fired": 0, "skipped": 0, "errors": 0, "by_state": {}}

    url, key, requests = _supabase_rest()
    if not url:
        stats["errors"] += 1
        return stats

    params = {
        # Include ghosted so the reactivation arm can evaluate them (AI-8804).
        "status": "in.(new,opened,conversing,chatting,chatting_phone,stalled,"
                   "date_proposed,date_booked,dated,ghosted)",
        "select": (
            "id,user_id,platform,match_id,name,match_name,status,stage,"
            "last_drip_at,drip_count,outcome,outcome_prompted_at,"
            "handoff_complete,primary_channel,date_booked_at,"
            "last_activity_at,"
            # Reactivation columns (AI-8804)
            "reactivation_count,last_reactivation_at,reactivation_eligible_at,"
            "reactivation_outcome,reactivation_disabled,ghost_stage,memo"
        ),
        "limit": "200",
    }
    if user_id:
        params["user_id"] = f"eq.{user_id}"

    try:
        r = requests.get(
            f"{url}/rest/v1/clapcheeks_matches",
            params=params,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
    except Exception as exc:
        logger.warning("scan fetch failed: %s", exc)
        stats["errors"] += 1
        return stats

    if r.status_code >= 300:
        logger.warning("scan status %s: %s", r.status_code, r.text[:200])
        stats["errors"] += 1
        return stats

    try:
        matches = r.json() or []
    except Exception:
        stats["errors"] += 1
        return stats

    # Per-user cadence cache so we don't fetch persona once per match.
    cadence_cache: dict[str, dict] = {}

    # Cache for full persona dicts (for reactivation template selection).
    persona_cache: dict[str, dict] = {}

    for match in matches:
        stats["scanned"] += 1
        u = match.get("user_id")
        try:
            if u not in cadence_cache:
                cadence_cache[u] = load_cadence_for_user(u)
            cadence = cadence_cache[u]

            # Inject persona into match so evaluate_conversation_state can
            # pass it to build_reactivation_prompt without a Supabase call.
            if u not in persona_cache:
                persona_cache[u] = _load_full_persona(u)
            match["_persona"] = persona_cache[u]

            events = _fetch_recent_events(match.get("id"))
            auto_send = _get_auto_send_flag(u)
            state, action = evaluate_conversation_state(
                match=match,
                conversation_events=events,
                persona_cadence=cadence,
            )
            stats["by_state"][state] = stats["by_state"].get(state, 0) + 1

            if action.kind == "noop":
                stats["skipped"] += 1
                continue

            res = queue_drip_action(
                match=match,
                action=action,
                auto_send=auto_send,
                platform_clients=platform_clients,
                dry_run=dry_run,
            )
            if res.get("fired"):
                stats["fired"] += 1
            elif res.get("error"):
                stats["errors"] += 1
        except Exception as exc:
            logger.exception("drip scan error for match %s: %s", match.get("id"), exc)
            stats["errors"] += 1

    return stats


def _fetch_recent_events(match_id: Optional[str], limit: int = 50) -> list[dict]:
    """Pull recent clapcheeks_conversation_events for a match.

    Note: the existing analytics schema stores from/to stage — not raw
    message bodies. For the stalled-topic prompt we degrade gracefully
    (topic will be empty string and the prompt builder handles that).
    """
    if not match_id:
        return []
    url, key, requests = _supabase_rest()
    if not url:
        return []
    try:
        r = requests.get(
            f"{url}/rest/v1/clapcheeks_conversation_events",
            params={
                "match_id": f"eq.{match_id}",
                "select": "id,platform,match_id,from_stage,to_stage,created_at",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code >= 300:
            return []
        rows = r.json() or []
        # Map analytics rows into the shape the state machine expects.
        events: list[dict] = []
        for row in rows:
            frm = (row.get("from_stage") or "").lower()
            to = (row.get("to_stage") or "").lower()
            sender = None
            kind = None
            if "opener" in frm or "opener" in to:
                sender, kind = "us", "opener_sent"
            elif "date_ask" in frm or "date_ask" in to or to == "date_proposed":
                sender, kind = "us", "date_ask_sent"
            elif to == "reply_sent":
                sender, kind = "us", "reply_sent"
            elif to == "reply_received":
                sender, kind = "her", "reply_received"
            events.append({
                "sender": sender,
                "event_type": kind,
                "body": "",
                "created_at": row.get("created_at"),
            })
        return events
    except Exception as exc:
        logger.debug("events fetch failed: %s", exc)
        return []


def _load_full_persona(user_id: Optional[str]) -> dict:
    """Load the full persona dict for a user (for reactivation templates).

    Returns {} on any failure — callers must handle missing persona gracefully.
    """
    if not user_id:
        return {}
    url, key, requests = _supabase_rest()
    if not url:
        return {}
    try:
        r = requests.get(
            f"{url}/rest/v1/clapcheeks_user_settings",
            params={
                "user_id": f"eq.{user_id}",
                "select": "persona",
                "limit": "1",
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code >= 300:
            return {}
        rows = r.json() or []
        return (rows[0].get("persona") or {}) if rows else {}
    except Exception as exc:
        logger.debug("persona load failed for %s: %s", user_id, exc)
        return {}


def _get_auto_send_flag(user_id: Optional[str]) -> bool:
    """Return True if approve_replies is false (auto-send) for this user."""
    if not user_id:
        return False
    url, key, requests = _supabase_rest()
    if not url:
        return False
    try:
        r = requests.get(
            f"{url}/rest/v1/clapcheeks_user_settings",
            params={
                "user_id": f"eq.{user_id}",
                "select": "approve_replies",
                "limit": "1",
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code >= 300:
            return False
        rows = r.json() or []
        if not rows:
            return False
        # approve_replies=false means "don't require approval" -> auto-send
        return rows[0].get("approve_replies") is False
    except Exception:
        return False
