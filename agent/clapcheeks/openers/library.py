"""Load + score opener templates from templates.yaml.

Used at conversation start (no prior messages). Picks the right formula
given the match's profile and emits a system-prompt addendum that the
LLM (Ollama / Kimi / Claude) can append to its existing opener prompt.

Source data:
- Hinge 500k-conversation analysis: observation+question gets 67% higher
  reply rate than question-only or statement-only.
- Hinge data: comments on PROMPTS beat photo comments by 47%.
- Hinge: two-truths-and-a-lie is their #1 opener.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("clapcheeks.openers.library")

TEMPLATES_PATH = Path(__file__).parent / "templates.yaml"


def load_templates() -> dict[str, Any]:
    """Read templates.yaml off disk. Returns empty skeleton if missing."""
    if not TEMPLATES_PATH.exists():
        logger.warning("openers/templates.yaml missing at %s", TEMPLATES_PATH)
        return {"formulas": {}, "constraints": {}}
    try:
        return yaml.safe_load(TEMPLATES_PATH.read_text()) or {}
    except yaml.YAMLError as exc:
        logger.error("openers/templates.yaml is malformed: %s", exc)
        return {"formulas": {}, "constraints": {}}


def pick_formula(profile_data: dict | None, prefer: str | None = None) -> dict:
    """Pick the best formula given a match's profile.

    Heuristic:
        - explicit ``prefer`` wins if it names a known formula
        - prompts present  -> prompt_callback (47% lift over photo comments)
        - photo descriptions present -> oq_formula (67% lift)
        - else -> two_truths_lie (Hinge's #1 opener; structure carries it)
    """
    templates = load_templates()
    formulas = templates.get("formulas", {}) or {}

    if prefer and prefer in formulas:
        return formulas[prefer]

    profile_data = profile_data or {}

    if profile_data.get("prompts"):
        return formulas.get("prompt_callback", {})

    if profile_data.get("photo_descriptions"):
        return formulas.get("oq_formula", {})

    return formulas.get("two_truths_lie", {})


def build_opener_prompt(formula: dict, profile_data: dict | None) -> str:
    """Build a system-prompt addendum that constrains the LLM to follow
    the chosen formula using the match's actual profile data.

    Returns a string ready to be appended to the existing system prompt.
    """
    profile_data = profile_data or {}
    lines = [
        f"OPENER FORMULA: {formula.get('description', '')}",
        f"PATTERN: {formula.get('pattern', '')}",
        "EXAMPLES:",
    ]
    for ex in (formula.get("examples", []) or [])[:3]:
        lines.append(f"  {ex!r}")
    lines.append("")
    lines.append(
        "Generate ONE opener that follows this exact pattern using the "
        "match's actual profile data below. Output ONLY the opener text."
    )
    lines.append("")
    if profile_data.get("prompts"):
        lines.append(f"Her prompts: {profile_data['prompts']}")
    if profile_data.get("photo_descriptions"):
        lines.append(f"Her photos show: {profile_data['photo_descriptions']}")
    if profile_data.get("bio"):
        lines.append(f"Her bio: {profile_data['bio']}")
    return "\n".join(lines)


class OpenerService:
    """Convenience wrapper that callers (drafter, daemon, queue UI) can
    use to get a ready-to-append prompt for the LLM at conversation start.

    Usage::

        svc = OpenerService()
        prompt_addendum = svc.build_for(profile_data)
        # then: combined_system = base_system + "\\n\\n" + prompt_addendum
    """

    def __init__(self, prefer: str | None = None) -> None:
        self._prefer = prefer

    def build_for(
        self,
        profile_data: dict | None,
        *,
        prefer: str | None = None,
    ) -> str:
        formula = pick_formula(profile_data, prefer=prefer or self._prefer)
        if not formula:
            return ""
        return build_opener_prompt(formula, profile_data)

    @staticmethod
    def constraints() -> list[dict]:
        return load_templates().get("constraints", []) or []
