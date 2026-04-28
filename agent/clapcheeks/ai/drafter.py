"""Drafter pipeline — the single path every message draft flows through.

Flow:
    system_prompt_with_persona
      -> Claude / Ollama / Kimi (raw_text)
      -> sanitize_draft (unicode -> ASCII)
      -> validate_draft (reject banned_words, AI tells, over-length)
      -> split_draft_into_messages (multi-thought -> array)
      -> queue as array

If validate_draft fails after sanitize, the draft is DISCARDED and logged to
clapcheeks_agent_events. Do NOT queue a bad draft.

This module wraps (not replaces) opener.py / reply.py / date_ask.py so the
existing research-backed logic stays intact while every output is gated.

PHASE-E - AI-8319
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from clapcheeks.ai.persona_loader import load_persona, render_persona_prompt
from clapcheeks.ai.sanitizer import sanitize_and_validate
from clapcheeks.ai.splitter import split_draft_into_messages

logger = logging.getLogger(__name__)


@dataclass
class DraftResult:
    """Result of running a raw LLM output through the pipeline."""
    ok: bool
    messages: list[str] = field(default_factory=list)  # array of 1-3 short msgs
    raw_text: str = ""                                 # raw LLM output
    cleaned_text: str = ""                             # post-sanitize
    errors: list[str] = field(default_factory=list)   # validator errors
    persona_used: bool = False


def inject_persona_into_system_prompt(
    base_system: str,
    persona: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> str:
    """Prepend the persona rules block to a base system prompt.

    If persona is None, loads it from Supabase for user_id (or local fallback).
    """
    if persona is None:
        persona = load_persona(user_id)
    block = render_persona_prompt(persona)
    if not block:
        return base_system
    return f"{block}\n\n{base_system}"


def run_pipeline(
    raw_text: str,
    persona: dict[str, Any] | None = None,
    user_id: str | None = None,
    conversation_stage: str = "mid",
    on_discard: Callable[[str, list[str]], None] | None = None,
    match_id: str | None = None,
    supabase: Any | None = None,
) -> DraftResult:
    """Run sanitize -> validate -> split on a raw LLM output.

    Args:
        raw_text: Whatever the LLM returned.
        persona: Loaded persona dict. If None, loads from Supabase/local.
        user_id: User id for persona lookup (only used if persona is None).
        conversation_stage: "early" | "mid" | "late" — affects emoji policy.
        on_discard: Optional callback fired when validator rejects the draft.
                    Signature: (raw_text, errors_list) -> None
        match_id: Match UUID — used for the AI-8809 gate check when supabase
                  is also provided.
        supabase: Supabase client — when provided together with user_id +
                  match_id, the AI gate is checked before running the pipeline.

    Returns:
        DraftResult with ok=True + messages populated on success,
        ok=False + errors populated on failure.
    """
    # AI-8809: gate check — bail early if AI is paused for this match.
    if supabase is not None and user_id and match_id:
        from clapcheeks.autonomy.gate import is_ai_active
        if not is_ai_active(supabase, user_id, match_id):
            return DraftResult(ok=False, raw_text=raw_text, errors=["ai_paused"])

    if persona is None:
        persona = load_persona(user_id)

    ok, cleaned, errors = sanitize_and_validate(raw_text, persona, conversation_stage)

    result = DraftResult(
        ok=ok,
        raw_text=raw_text,
        cleaned_text=cleaned,
        errors=errors,
        persona_used=bool(persona),
    )

    if not ok:
        logger.warning(
            "Draft discarded by sanitizer/validator. Errors: %s. Raw: %r",
            errors,
            raw_text[:160],
        )
        if on_discard:
            try:
                on_discard(raw_text, errors)
            except Exception as exc:
                logger.debug("on_discard callback failed: %s", exc)
        return result

    # Split into 1-3 short messages per splitting rule.
    rules = (persona or {}).get("message_formatting_rules", {}) or {}
    length = rules.get("length", {}) or {}
    ideal = length.get("ideal_max_chars", 80)
    hard = length.get("hard_max_chars", 160)

    messages = split_draft_into_messages(
        cleaned,
        ideal_max_chars=ideal,
        hard_max_chars=hard,
        max_messages=3,
    )
    result.messages = messages
    return result


def log_discard_to_supabase(
    user_id: str | None,
    platform: str,
    raw_text: str,
    errors: list[str],
) -> None:
    """Write a `draft_discarded` row to clapcheeks_agent_events. Best-effort."""
    if not user_id:
        return
    try:
        from clapcheeks.sync import _load_supabase_env
        from supabase import create_client
    except Exception:
        return
    try:
        url, key = _load_supabase_env()
        if not url or not key:
            return
        client = create_client(url, key)
        client.table("clapcheeks_agent_events").insert({
            "user_id": user_id,
            "event_type": "draft_discarded",
            "data": {
                "platform": platform,
                "errors": errors,
                "raw_text_preview": raw_text[:200],
            },
        }).execute()
    except Exception as exc:
        logger.debug("draft_discarded event log failed: %s", exc)
