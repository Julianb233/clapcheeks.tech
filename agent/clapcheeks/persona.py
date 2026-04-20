"""User persona — what the AI should sound like and what to reference.

Two purposes:
1. Voice calibration (rizz / swagger / confidence) so every generated message
   sounds like the user, not generic ChatGPT.
2. Attraction anchors (stories, hooks, values, what makes him attractive) that
   the AI can weave into replies, openers, and date-asks.

Stored at ~/.clapcheeks/persona.json. Edited via CLI (`clapcheeks setup-persona`)
or the web settings page.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_PERSONA_DIR = Path.home() / ".clapcheeks"
_PERSONA_PATH = _PERSONA_DIR / "persona.json"


@dataclass
class Persona:
    # --- Identity -------------------------------------------------------
    first_name: str = ""
    age: int = 0
    location: str = ""
    occupation: str = ""          # "founder / engineer / personal trainer"
    height_in: int = 0            # inches — height is a hook; surface it subtly

    # --- Voice / rizz ---------------------------------------------------
    voice_style: str = "confident, playful, direct — witty without trying too hard"
    humor_flavor: str = "dry, observational, a bit mischievous"
    signature_phrases: list[str] = field(default_factory=list)   # things he actually says
    banned_words: list[str] = field(default_factory=list)        # words to never use
    confidence_anchors: list[str] = field(default_factory=list)  # "I run my own company", "I train daily"

    # --- Stories & hooks (the stuff worth bringing up) -----------------
    attraction_hooks: list[str] = field(default_factory=list)
    # e.g. ["runs own agency", "pilot in training", "cooks a mean risotto",
    #       "half-marathon runner", "raised a rescue dog"]

    best_stories: list[str] = field(default_factory=list)
    # short prose — the AI will pull on these as conversational anchors.

    values: list[str] = field(default_factory=list)
    # e.g. ["curious", "driven but not grinding", "family-first", "growth over comfort"]

    # --- Conversational posture ----------------------------------------
    date_proposal_style: str = "direct and plan-oriented — suggest a specific place + time"
    avoid_topics: list[str] = field(default_factory=list)

    # --- Housekeeping --------------------------------------------------
    updated_at: str = ""


def _fields() -> set[str]:
    return {f for f in Persona.__dataclass_fields__.keys()}


def load() -> Persona:
    try:
        raw = json.loads(_PERSONA_PATH.read_text())
        return Persona(**{k: v for k, v in raw.items() if k in _fields()})
    except Exception:
        return Persona()


def save(p: Persona) -> None:
    p.updated_at = datetime.now(timezone.utc).isoformat()
    _PERSONA_DIR.mkdir(parents=True, exist_ok=True)
    _PERSONA_PATH.write_text(json.dumps(asdict(p), indent=2))


def exists() -> bool:
    return _PERSONA_PATH.exists()


# ---------------------------------------------------------------------------
# Prompt formatting
# ---------------------------------------------------------------------------

def format_for_system_prompt(p: Persona | None = None) -> str:
    """Render the persona as a short block for injection into any AI prompt.

    Output is compact (<500 tokens) — the AI's system prompt should lead
    with this so tone + facts ground every response.
    """
    p = p or load()
    if not p.first_name and not p.voice_style:
        return ""  # no persona configured yet

    lines: list[str] = ["=== WHO I AM (write in my voice) ==="]
    if p.first_name:
        ident = f"- I'm {p.first_name}"
        if p.age:
            ident += f", {p.age}"
        if p.occupation:
            ident += f", {p.occupation}"
        if p.location:
            ident += f" in {p.location}"
        if p.height_in:
            feet, inches = divmod(p.height_in, 12)
            ident += f". I'm {feet}'{inches}\""
        lines.append(ident + ".")

    if p.voice_style:
        lines.append(f"- Voice: {p.voice_style}.")
    if p.humor_flavor:
        lines.append(f"- Humor: {p.humor_flavor}.")
    if p.signature_phrases:
        lines.append(
            "- Words/phrases I'd actually use: " + ", ".join(
                f'"{s}"' for s in p.signature_phrases[:8]
            ) + "."
        )
    if p.banned_words:
        lines.append(
            "- NEVER use these words: " + ", ".join(p.banned_words) + "."
        )
    if p.confidence_anchors:
        lines.append(
            "- Confidence anchors (reference casually, never brag): "
            + "; ".join(p.confidence_anchors[:5]) + "."
        )
    if p.attraction_hooks:
        lines.append(
            "- Things that make me attractive to women (weave in naturally, never list): "
            + "; ".join(p.attraction_hooks[:8]) + "."
        )
    if p.best_stories:
        lines.append("- Story anchors to draw on:")
        for s in p.best_stories[:4]:
            lines.append(f"    • {s}")
    if p.values:
        lines.append(f"- Values: {', '.join(p.values[:6])}.")
    if p.date_proposal_style:
        lines.append(f"- When asking for a date: {p.date_proposal_style}.")
    if p.avoid_topics:
        lines.append(f"- Avoid these topics: {', '.join(p.avoid_topics)}.")

    lines.append(
        "- Rules: confidence > cleverness. Specifics > generics. Curiosity > "
        "performance. Never sound like ChatGPT. Never use pickup lines. Match "
        "her energy, don't out-energy her."
    )
    return "\n".join(lines)


def merge_into_system(base_system: str, p: Persona | None = None) -> str:
    """Prepend the persona block to an existing system prompt."""
    block = format_for_system_prompt(p)
    if not block:
        return base_system
    return f"{block}\n\n{base_system}"
