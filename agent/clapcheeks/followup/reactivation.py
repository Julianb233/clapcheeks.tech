"""Ghost-recovery reactivation prompt builder — Phase G2, AI-8804.

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

from typing import Any, Optional

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
