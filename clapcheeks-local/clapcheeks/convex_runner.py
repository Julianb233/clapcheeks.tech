"""convex_runner — Mac Mini side Convex job consumer.

AI-9500-F: pattern_interrupt template family + DISC-based sub-style chooser.

This module is consumed by the Mac Mini daemon when it picks up
``send_imessage`` agent_jobs whose ``prompt_template`` field is set to
``pattern_interrupt_<sub_style>``.

Flow (fireOne in Convex touches.ts) ─────────────────────────────────────────
  1. Convex fires a scheduled_touch with type="pattern_interrupt" and
     prompt_template="pattern_interrupt_<sub_style>".
  2. Convex enqueues an agent_jobs row with job_type="send_imessage" and
     the prompt_template in the payload.
  3. Mac Mini daemon polls agent_jobs, sees the row, calls
     _draft_with_template(person, template_key) to get a draft body.
  4. Draft goes through the standard drafter pipeline (sanitize → validate →
     split → queue / auto-send).

Sub-styles
──────────
  callback              — reference an earlier conversation moment
  meme_reference        — light pop-culture nudge
  low_pressure_check_in — "hope your week's been chill"
  bold_direct           — "haven't heard from you — figured I'd just say hey"
  seasonal_hook         — tied to current season/month

DISC chooser
────────────
  D (Dominance)         → bold_direct
  I (Influence)         → meme_reference
  S (Steadiness)        → low_pressure_check_in
  C (Conscientiousness) → callback
  default / unknown     → seasonal_hook

The same logic is mirrored in TypeScript at
  web/convex/enrichment.ts → pickPatternInterruptSubStyle()
Keep the two in sync.
"""
from __future__ import annotations

import calendar
import datetime
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pattern interrupt sub-style templates
# ---------------------------------------------------------------------------
# Each template is a *system prompt* string fed into the drafter pipeline
# (clapcheeks.ai.drafter.run_pipeline).  {name} is interpolated with the
# person's first name before the LLM call.
#
# Rules applied here (mirroring reactivation.py conventions):
#   - 12 words max (the *instruction* constrains the LLM, not the template).
#   - Lowercase output.
#   - No banned openers: "hey stranger", "long time no talk", "just checking in",
#     "miss me?", "remember me?", "did I do something wrong".
#   - No apology, no reference to silence / gap / not-texting.
#   - The template is intentionally short so the LLM stays tightly scoped.

_PATTERN_INTERRUPT_TEMPLATES: dict[str, str] = {
    "callback": (
        "Write one very short, casual message for {name}. "
        "Reference a specific earlier moment from the conversation — an inside joke, "
        "something she mentioned she was excited about, or a shared reference point. "
        "Make it feel like you genuinely thought of her because of that thing, not "
        "because a script fired. 12 words max, lowercase. "
        "Do NOT say 'hey stranger', 'just checking in', 'long time no talk'. "
        "Do NOT mention any gap or silence. "
        "Reply with ONLY the message text."
    ),
    "meme_reference": (
        "Write one very short, playful message for {name}. "
        "Drop a light, current pop-culture or internet-culture reference — "
        "something that feels natural to forward to someone you're thinking about. "
        "Tone: fun, not try-hard. 10 words max, lowercase. "
        "No reference to not-texting, no apology. "
        "Reply with ONLY the message text."
    ),
    "low_pressure_check_in": (
        "Write one very short, warm, low-pressure message for {name}. "
        "Something like 'hope your week's been good' or 'been thinking about you' — "
        "easy, no expectation of a long reply, genuinely warm. "
        "10 words max, lowercase. "
        "Do NOT say 'just checking in', 'long time no talk', 'hey stranger'. "
        "No guilt, no apology, no reference to silence. "
        "Reply with ONLY the message text."
    ),
    "bold_direct": (
        "Write one very short, confident, direct message for {name}. "
        "The kind of thing a secure guy says when he's been thinking about someone "
        "and just decides to reach out — no preamble, no apology. "
        "Example energy: 'figured I'd just say hey'. "
        "10 words max, lowercase. "
        "Do NOT reference the silence or apologise for it. "
        "Reply with ONLY the message text."
    ),
    "seasonal_hook": (
        "Write one very short, casual message for {name} that's relevant to the "
        "current time of year — the season, a recent holiday, weather, or a cultural "
        "moment happening right now. "
        "Make it feel spontaneous, like something in your environment reminded you "
        "of her. 12 words max, lowercase. "
        "Do NOT say 'hey stranger', 'just checking in', 'long time no talk'. "
        "No apology, no reference to silence. "
        "Reply with ONLY the message text."
    ),
}

# Valid sub-style keys — matches TypeScript enum in enrichment.ts.
VALID_SUB_STYLES = frozenset(_PATTERN_INTERRUPT_TEMPLATES.keys())


# ---------------------------------------------------------------------------
# DISC-based sub-style chooser
# ---------------------------------------------------------------------------

def pick_sub_style(person: dict[str, Any]) -> str:
    """Return the best pattern_interrupt sub-style for this person.

    Reads ``disc_primary`` from the person dict (Convex people row).
    Mirror of TypeScript ``pickPatternInterruptSubStyle`` in enrichment.ts.

    DISC mapping:
      D → bold_direct
      I → meme_reference
      S → low_pressure_check_in
      C → callback
      other / None → seasonal_hook

    Args:
        person: A dict with at least an optional ``disc_primary`` key (str).
                Can also contain ``courtship_stage`` for future refinements.

    Returns:
        One of: "bold_direct", "meme_reference", "low_pressure_check_in",
                "callback", "seasonal_hook".
    """
    disc = (person.get("disc_primary") or "").strip().upper()
    if disc == "D":
        return "bold_direct"
    if disc == "I":
        return "meme_reference"
    if disc == "S":
        return "low_pressure_check_in"
    if disc == "C":
        return "callback"
    # Default: seasonal_hook.  Also falls back gracefully for unknown values.
    return "seasonal_hook"


# ---------------------------------------------------------------------------
# Template getter (with seasonal context injection)
# ---------------------------------------------------------------------------

def _current_season() -> str:
    """Return the Northern Hemisphere season name for the current month."""
    month = datetime.date.today().month
    if month in (12, 1, 2):
        return "winter"
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    return "fall"


def get_template(sub_style: str) -> str:
    """Return the system-prompt template string for the given sub_style.

    Falls back to ``seasonal_hook`` for unrecognised keys.

    For ``seasonal_hook``, the template includes the *current* season name
    injected at call time so the LLM has concrete temporal context.
    """
    if sub_style not in _PATTERN_INTERRUPT_TEMPLATES:
        logger.warning(
            "pattern_interrupt: unknown sub_style %r — falling back to seasonal_hook",
            sub_style,
        )
        sub_style = "seasonal_hook"

    template = _PATTERN_INTERRUPT_TEMPLATES[sub_style]

    # Inject current season for the seasonal hook variant.
    if sub_style == "seasonal_hook":
        season = _current_season()
        month_name = calendar.month_name[datetime.date.today().month]
        template = (
            f"[Context: It is currently {month_name}, {season}.]\n\n{template}"
        )

    return template


# ---------------------------------------------------------------------------
# Main draft entrypoint — called by Mac Mini daemon's agent_jobs consumer
# ---------------------------------------------------------------------------

def _draft_with_template(
    person: dict[str, Any],
    template_key: str,
    *,
    user_id: Optional[str] = None,
    supabase: Any = None,
) -> list[str]:
    """Draft a pattern_interrupt message and run it through the pipeline.

    Args:
        person: Convex people row (dict).  Must have ``display_name``.
        template_key: Full template key, e.g. ``"pattern_interrupt_bold_direct"``.
                      May also be the bare sub-style key (``"bold_direct"``).
        user_id: Supabase user id (for AI gate check + discard logging).
        supabase: Supabase client (for AI gate check).

    Returns:
        List of 1-3 message strings to send sequentially.
        Falls back to the ``bold_direct`` hardcoded default if the pipeline
        rejects the draft.
    """
    # Strip prefix if caller passed the full template key.
    sub_style = template_key
    if sub_style.startswith("pattern_interrupt_"):
        sub_style = sub_style[len("pattern_interrupt_"):]
    if sub_style not in VALID_SUB_STYLES:
        sub_style = pick_sub_style(person)

    template = get_template(sub_style)
    name = (person.get("display_name") or "").split()[0] or "her"
    system_prompt = template.format(name=name)

    try:
        from clapcheeks.ai import drafter as _drafter

        result = _drafter.run_pipeline(
            raw_text=system_prompt,   # drafter forwards this to the LLM
            user_id=user_id,
            conversation_stage="mid",
            supabase=supabase,
            match_id=str(person.get("_id") or ""),
            on_discard=lambda txt, errs: _drafter.log_discard_to_supabase(
                user_id, "pattern_interrupt", txt, errs
            ),
        )

        if result.ok and result.messages:
            return result.messages

        logger.info(
            "pattern_interrupt draft discarded for %s: %s",
            person.get("display_name"),
            result.errors,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("pattern_interrupt _draft_with_template error: %s", exc)

    # Hardcoded fallback — always safe to send.
    return ["figured I'd just say hey"]
