"""Persona loader — pulls full persona JSON from Supabase and caches for the run.

Reads clapcheeks_user_settings.persona for a given user_id. Falls back to the
local Persona dataclass when Supabase is unreachable. Result is cached
per-process so we don't hit Supabase on every draft.

The returned dict shape:
{
  "voice_style": str,
  "signature_phrases": list[str],
  "banned_words": list[str],
  "attraction_hooks": list[str],
  "flex_rules": dict,
  "message_formatting_rules": dict,
  "platform_handoff": dict,
  "banned_punctuation": list[str],   # from message_formatting_rules
  "examples_good": list[str],
  "examples_bad_never_send": list[str],
  ...anything else in the row
}

PHASE-E - AI-8319
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# In-process cache: {user_id: persona_dict}. Never shared across workers.
_CACHE: dict[str, dict[str, Any]] = {}

# Default formatting rules — used when persona doesn't specify.
_DEFAULT_FORMATTING_RULES: dict[str, Any] = {
    "banned_punctuation": [
        "\u2014", "\u2013", ";", "\u2026",
        "\u201c", "\u201d", "\u2018", "\u2019",
        "\u00a0",
    ],
    "allowed_punctuation": [".", ",", "?", "!", "'", '"', "-", "(", ")", "/", ":"],
    "length": {
        "ideal_max_chars": 80,
        "hard_max_chars": 160,
        "opener_hard_max": 140,
    },
    "splitting_rule": (
        "If the draft has 2 or more distinct thoughts, split them into separate "
        "messages. Each message short, one thought each. Platform will send with "
        "3-8 second pauses between."
    ),
    "voice_checks": [
        "lowercase-first is natural",
        "minimal punctuation is better than over-punctuation",
        "no em-dashes, en-dashes, semicolons, ellipsis, curly quotes",
        "never sound like an AI",
        "reference something specific from HER profile",
    ],
    "examples_good": [
        "hey saw your hiking pic, where was that?",
        "you have good taste in books",
        "ok but seriously what's your go-to karaoke song",
    ],
    "examples_bad_never_send": [
        "Hello! I noticed from your profile that you enjoy hiking - I too am an avid hiker!",
        "Looking forward to hearing from you :)",
        "Your profile really stood out to me; I'd love to learn more.",
    ],
    "emoji_policy": {
        "max_emojis": 1,
        "early_convo_emojis": 0,
    },
}


def _default_persona() -> dict[str, Any]:
    return {
        "voice_style": (
            "smooth, confident, playful, direct. lowercase-first feels natural. "
            "curiosity over performance. short, human-typed, never AI."
        ),
        "signature_phrases": [],
        "banned_words": [
            "delve", "tapestry", "navigate", "journey", "embark",
            "in today's fast-paced world", "let me know your thoughts",
            "I hope this message finds you well", "I would love to",
            "furthermore", "moreover", "nevertheless",
            "albeit", "whilst", "thus",
            "paramount", "quintessential", "robust",
            "unleash", "leverage", "synergy",
        ],
        "attraction_hooks": [],
        "flex_rules": {
            "surface_one_at_a_time": True,
            "warmest_first": True,
            "never_list_more_than_one": True,
        },
        "message_formatting_rules": _DEFAULT_FORMATTING_RULES,
        "platform_handoff": {},
    }


def _merge_defaults(persona: dict[str, Any]) -> dict[str, Any]:
    """Fill in missing fields from defaults — non-destructive."""
    base = _default_persona()
    out = {**base, **persona}

    # Deep-merge message_formatting_rules
    rules = {**_DEFAULT_FORMATTING_RULES, **(persona.get("message_formatting_rules") or {})}
    # Ensure nested length dict has all keys
    rules_length = {**_DEFAULT_FORMATTING_RULES["length"], **(rules.get("length") or {})}
    rules["length"] = rules_length
    rules_emoji = {
        **_DEFAULT_FORMATTING_RULES["emoji_policy"],
        **(rules.get("emoji_policy") or {}),
    }
    rules["emoji_policy"] = rules_emoji
    out["message_formatting_rules"] = rules

    # Deep-merge flex_rules
    out["flex_rules"] = {**base["flex_rules"], **(persona.get("flex_rules") or {})}

    # Always merge banned_words (don't let persona blank them out)
    persona_banned = persona.get("banned_words") or []
    out["banned_words"] = list({*base["banned_words"], *persona_banned})

    return out


def _load_from_supabase(user_id: str) -> dict[str, Any] | None:
    """Fetch persona JSON from clapcheeks_user_settings for the given user."""
    try:
        from clapcheeks.sync import _load_supabase_env
        from supabase import create_client
    except Exception as exc:
        logger.debug("Supabase client not available: %s", exc)
        return None

    url, key = _load_supabase_env()
    if not url or not key:
        logger.debug("Supabase env missing, using default persona")
        return None

    try:
        client = create_client(url, key)
        resp = (
            client.table("clapcheeks_user_settings")
            .select("persona")
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        data = getattr(resp, "data", None) or {}
        persona = data.get("persona") or {}
        if isinstance(persona, str):
            persona = json.loads(persona)
        if not isinstance(persona, dict):
            return None
        return persona
    except Exception as exc:
        logger.debug("Supabase persona fetch failed for %s: %s", user_id, exc)
        return None


def _load_from_local() -> dict[str, Any]:
    """Fallback: read ~/.clapcheeks/persona.json if present."""
    path = Path.home() / ".clapcheeks" / "persona.json"
    try:
        raw = json.loads(path.read_text())
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def load_persona(user_id: str | None = None, force_refresh: bool = False) -> dict[str, Any]:
    """Return the full persona dict for the given user, with defaults merged in.

    user_id=None returns a local-or-default persona (useful for single-user CLI).
    Cached per user_id per process. Pass force_refresh=True to bypass cache.
    """
    cache_key = user_id or "__local__"
    if not force_refresh and cache_key in _CACHE:
        return _CACHE[cache_key]

    persona: dict[str, Any] = {}
    if user_id:
        persona = _load_from_supabase(user_id) or {}

    if not persona:
        persona = _load_from_local()

    merged = _merge_defaults(persona)
    _CACHE[cache_key] = merged
    return merged


def clear_cache() -> None:
    _CACHE.clear()


# ---------------------------------------------------------------------------
# Prompt rendering — inject persona verbatim into the system prompt
# ---------------------------------------------------------------------------

def render_persona_prompt(persona: dict[str, Any]) -> str:
    """Render the persona into a system-prompt-ready string.

    Includes voice_style, signature_phrases (rotate), banned_words,
    attraction_hooks (don't list, pick relevant ones), flex_rules,
    and message_formatting_rules (verbatim JSON — the model reads directly).
    """
    lines: list[str] = ["=== VOICE + DRAFTING RULES (follow exactly) ==="]

    voice = persona.get("voice_style", "")
    if voice:
        lines.append(f"Voice: {voice}")

    sig = persona.get("signature_phrases") or []
    if sig:
        lines.append(
            "Signature phrases I actually say (rotate naturally, don't overuse one): "
            + ", ".join(f'"{s}"' for s in sig[:10])
        )

    banned_words = persona.get("banned_words") or []
    if banned_words:
        lines.append(
            "NEVER use these words or phrases: "
            + ", ".join(banned_words[:30])
        )

    hooks = persona.get("attraction_hooks") or []
    if hooks:
        lines.append(
            "Attraction hooks (pick AT MOST ONE relevant to the message, "
            "never list, surface warmest-first): "
            + "; ".join(hooks[:8])
        )

    flex = persona.get("flex_rules") or {}
    if flex:
        lines.append(
            "Flex rules: surface one at a time, warmest first, never list more than one."
        )

    # Inject the formatting rules as JSON so the model reads them exactly.
    rules = persona.get("message_formatting_rules") or {}
    if rules:
        lines.append("Message formatting rules (READ THESE LITERALLY):")
        lines.append(json.dumps(rules, indent=2))

    handoff = persona.get("platform_handoff") or {}
    golden = (handoff.get("julian_golden_template") or {}).get("full_text") if isinstance(handoff, dict) else None
    if golden:
        lines.append("Canonical handoff template (match this voice when handing off a number):")
        lines.append(golden)

    lines.append("")
    lines.append("CRITICAL VOICE RULES (hard constraints):")
    lines.append(
        "- Short, sweet, to the point. Lowercase-first is natural and good."
    )
    lines.append(
        "- No em-dashes, en-dashes, semicolons, ellipsis, curly quotes ever."
    )
    lines.append(
        "- If you have 2+ thoughts, write them as separate sentences so they "
        "can be split into separate messages."
    )
    lines.append(
        "- Zero to one emoji max. Zero in the first 1-2 messages."
    )
    lines.append(
        "- Reference something specific from HER profile (name, prompt, "
        "interest, photo detail) in every draft."
    )
    lines.append(
        "- Never sound like an AI. No corny closers. No pickup lines. No walls of text."
    )
    lines.append("")
    good = rules.get("examples_good") or []
    bad = rules.get("examples_bad_never_send") or []
    if good:
        lines.append("GOOD examples (sound like this):")
        for g in good[:6]:
            lines.append(f"  - {g}")
    if bad:
        lines.append("BAD examples (NEVER sound like this):")
        for b in bad[:6]:
            lines.append(f"  - {b}")

    return "\n".join(lines)
