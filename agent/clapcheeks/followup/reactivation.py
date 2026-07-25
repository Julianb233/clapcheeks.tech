"""Ghost-recovery reactivation prompt builder — Phase G2, AI-8804.

**Playbook reference:** docs/playbooks/reactivation-campaign.md
  The full teachable methodology behind this module — timing ladder,
  banned phrases, cross-domain adaptations, operator guide, and research
  bibliography — lives there. If you're extending this module or tuning
  templates, read Part 2 (Clapcheeks Implementation) and Part 1
  (Universal Strategy) first.

  Machine-readable banned phrases: docs/playbooks/banned-phrases.json
  Decision tree and tracker templates: docs/playbooks/templates/

This is a **pure function** module — no Supabase calls, no LLM calls.
It takes the context of a ghosted match and returns a fully-formed
system prompt to feed into the existing Phase E pipeline
(clapcheeks.ai.drafter.run_pipeline).

Design principles:
- Templates live in ``persona.reactivation.templates_by_stage``, NOT here.
  If a persona provides templates, we interpolate them. If not, we use the
  safe built-in defaults below — which deliberately avoid the most common
  clichés that women instantly recognise as mass outreach.
- Banned phrases are checked by the Phase E sanitizer AFTER generation, so
  this module does NOT need to re-check them. But we include the key list
  as a docstring so any future default-template editor knows what to avoid.

Banned reactivation openers (sanitizer enforces; listed for reference):
    "hey stranger"
    "long time no talk"
    "long time no see"
    "did i do something wrong"
    "miss me?"
    "remember me?"
    "i know it's been a while"
    "just checking in"
    "circling back"
    "touching base"

Preferred tone: casual, specific, low-pressure. Act like you thought of her
because something in your life reminded you of the conversation, not because
a daemon fired.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional


@dataclass(frozen=True)
class ReactivationContext:
    native_thread_current: bool
    prior_reciprocity: bool
    identity_verified: bool
    specific_callback: str | None
    latest_julian_outbound_at: datetime
    consecutive_unanswered_outbounds: int
    prior_cta: str | None = None
    prior_reactivation_attempts: int = 0
    boundary_or_rejection: bool = False
    delivery_failure: bool = False
    sensitive_context: bool = False
    manual_handling: bool = False


@dataclass(frozen=True)
class ReactivationDecision:
    eligible: bool
    reason: str
    priority: str | None = None
    must_rebuild_reciprocity: bool = False
    allow_off_app_request: bool = False
    allow_date_request: bool = False


def evaluate_reactivation(
    context: ReactivationContext,
    *,
    now: datetime | None = None,
) -> ReactivationDecision:
    """One-shot stale recovery using only current native-thread evidence."""
    now = now or datetime.now(timezone.utc)
    sent_at = context.latest_julian_outbound_at
    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)
    age_hours = (now - sent_at).total_seconds() / 3600

    if context.prior_reactivation_attempts >= 1:
        return ReactivationDecision(False, "recovery_cycle_exhausted")
    if (
        context.boundary_or_rejection
        or context.delivery_failure
        or context.sensitive_context
        or context.manual_handling
    ):
        return ReactivationDecision(False, "stop_condition")
    if not context.native_thread_current:
        return ReactivationDecision(False, "native_thread_uncertified")
    if not context.identity_verified:
        return ReactivationDecision(False, "identity_unverified")
    if not context.prior_reciprocity:
        return ReactivationDecision(False, "no_prior_reciprocity")
    if context.consecutive_unanswered_outbounds >= 2:
        return ReactivationDecision(False, "too_many_unanswered_outbounds")
    if age_hours < 72:
        return ReactivationDecision(False, "too_soon")
    if age_hours > 90 * 24:
        return ReactivationDecision(False, "manual_review_over_90_days")
    if age_hours > 7 * 24 and not (context.specific_callback or "").strip():
        return ReactivationDecision(False, "specific_callback_required")

    priority = "highest" if age_hours <= 7 * 24 else "normal"
    rebuild = context.prior_cta in {"phone", "date"}
    return ReactivationDecision(
        True,
        "eligible",
        priority=priority,
        must_rebuild_reciprocity=rebuild,
        allow_off_app_request=False,
        allow_date_request=False,
    )

# ---------------------------------------------------------------------------
# Default template map (stage -> template string)
# ---------------------------------------------------------------------------
# Keys match the clapcheeks_matches.status / stage values at the time the
# match was marked ghosted.  Use {name} for interpolation.
# These are intentionally short so the LLM stays tightly constrained.

_DEFAULT_TEMPLATES: dict[str, str] = {
    "opened": (
        "Write one very short, casual, low-pressure message for {name}. "
        "We matched and sent an opener but never heard back. "
        "Act like something in real life reminded you of a detail from her profile — "
        "be genuine, not gimmicky. 10 words max, lowercase. "
        "Do NOT say 'hey stranger', 'long time no talk', 'remember me?', "
        "'just checking in', or 'miss me?'. "
        "Do NOT apologise or reference the gap. "
        "Reply with ONLY the message text."
    ),
    "conversing": (
        "Write one very short, casual follow-up for {name}. "
        "We were having a good conversation but it stalled and she went quiet. "
        "Reference something light and current — not the gap. "
        "12 words max, lowercase, no punctuation-heavy. "
        "Do NOT say 'hey stranger', 'long time no talk', "
        "'did i do something wrong', 'just checking in'. "
        "Reply with ONLY the message text."
    ),
    "date_proposed": (
        "Write one very short, casual message for {name}. "
        "We asked her out, she never confirmed, and it fizzled. "
        "Keep it breezy — just pop back into her world as if you thought of her. "
        "10 words max, lowercase. "
        "Do NOT mention the previous date ask, do NOT apologise. "
        "Reply with ONLY the message text."
    ),
    "default": (
        "Write one very short, casual, low-pressure message for {name}. "
        "We matched and things went quiet. "
        "Keep it light and genuine — like you genuinely thought of her. "
        "10 words max, lowercase. "
        "Do NOT say 'hey stranger', 'long time no talk', 'just checking in', "
        "'remember me?', 'miss me?', 'did i do something wrong'. "
        "Reply with ONLY the message text."
    ),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_reactivation_prompt(
    name: str,
    stage_when_died: str,
    memo_text: Optional[str] = None,
    persona: Optional[dict[str, Any]] = None,
) -> str:
    """Return a prompt string to feed into ``drafter.run_pipeline``.

    Args:
        name: Her first name (used in {name} interpolation).
        stage_when_died: The match status / stage at the time she ghosted
            (e.g. "opened", "conversing", "date_proposed"). Drives template
            selection.
        memo_text: Free-text memo about the match (e.g. from
            clapcheeks_memos). If provided, the prompt instructs the LLM to
            weave in a specific detail — making the reactivation feel personal
            rather than templated.
        persona: Full persona dict from clapcheeks_user_settings.
            May contain ``persona.reactivation.templates_by_stage`` — a dict
            of stage -> template strings that override the built-in defaults.

    Returns:
        A system prompt string (not the final message — the LLM generates
        the final message from this prompt via the Phase E pipeline).
    """
    template = _pick_template(stage_when_died, persona)
    prompt = template.format(name=name or "her")

    if memo_text and memo_text.strip():
        # Append a memo clause so the LLM can anchor to a real detail.
        memo_snippet = memo_text.strip()[:200]
        prompt = (
            f"{prompt} "
            f"Optional detail you can weave in naturally if it fits: \"{memo_snippet}\" "
            f"— only use it if it makes the message feel more genuine, not forced."
        )

    return prompt


def _pick_template(stage: str, persona: Optional[dict[str, Any]]) -> str:
    """Select the best template string for this stage + persona combo."""
    # 1. Persona-provided templates take priority.
    if persona:
        persona_templates = (
            persona.get("reactivation", {}).get("templates_by_stage", {})
        )
        if persona_templates and isinstance(persona_templates, dict):
            # Try exact match, then "default", then fall through.
            if stage in persona_templates and isinstance(persona_templates[stage], str):
                return persona_templates[stage]
            if "default" in persona_templates and isinstance(
                persona_templates["default"], str
            ):
                return persona_templates["default"]

    # 2. Built-in defaults.
    return _DEFAULT_TEMPLATES.get(stage, _DEFAULT_TEMPLATES["default"])
