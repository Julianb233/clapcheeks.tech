"""Strategy generator — CONV-02 (Phase 41 / AI-8326).

Given a match's full profile (zodiac, IG interests, conversation analysis,
communication profile), produces a per-match conversation strategy:

  - try_topics:           5 topics to bring up (specific to this match)
  - avoid_topics:         3 topics to steer away from
  - suggested_tone:       "playful" | "warm" | "direct" | "flirty"
  - ideal_message_length: "short" (<=60 chars) | "medium" (60-120) | "long" (120-160)
  - best_send_window:     "morning" | "afternoon" | "evening" | "late_night"
  - move_to_text_score:   int 0-100 ("are we ready to ask for the number / move to iMessage")
  - rationale:            short string explaining the score

This module is rule-based — it does NOT call an LLM. Strategy is fed back
into reply.py / generate-replies.ts as a constraints block on the system
prompt. Keeping it deterministic means we get the same strategy from the
same inputs (testable + cheap + offline-friendly).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from clapcheeks.conversation.analyzer import ConversationAnalysis


# Explicit handoff/escalation cues from her side — strongest move-to-text signal.
_HANDOFF_REQUEST_RE = re.compile(
    r"\b(give me your number|whats?\s*your\s*number|"
    r"send\s+(?:me\s+)?your\s+(?:number|digits|whatsapp|insta|ig)|"
    r"text me|hit me up|let'?s\s+(?:meet|grab|get)|"
    r"we\s+should\s+(?:meet|grab|get)|"
    r"want to (?:meet|grab|get)|"
    r"i'?ll\s+text\s+you|"
    r"add me on\s+(?:ig|insta|whatsapp))\b",
    re.I,
)


# Generic topic pool — used as fallback when a match has no IG/profile interests
_GENERIC_TOPICS = [
    "weekend_plans",
    "food",
    "travel",
    "music",
    "movies_tv",
]

# Topics that almost never advance a dating conversation early on
_LOW_VALUE_TOPICS = {"work", "school", "family"}

# Avoid pile if she shows particular flags
_RED_FLAG_TO_AVOID: dict[str, list[str]] = {
    "no_hookups": ["sex_flirt", "future_plans"],
    "gym_required": ["food"],          # don't lean food-heavy if she's gym-strict
    "height_requirement": ["work"],    # don't grind small talk
}


@dataclass
class ConversationStrategy:
    try_topics: list[str] = field(default_factory=list)
    avoid_topics: list[str] = field(default_factory=list)
    suggested_tone: str = "warm"
    ideal_message_length: str = "medium"
    best_send_window: str = "evening"
    move_to_text_score: int = 0
    rationale: str = ""

    def to_dict(self) -> dict:
        return {
            "try_topics": self.try_topics,
            "avoid_topics": self.avoid_topics,
            "suggested_tone": self.suggested_tone,
            "ideal_message_length": self.ideal_message_length,
            "best_send_window": self.best_send_window,
            "move_to_text_score": self.move_to_text_score,
            "rationale": self.rationale,
        }


def _interests_from_profile(profile: dict | None) -> list[str]:
    """Pull human-named interests out of any of the shapes we ingest."""
    if not profile:
        return []
    pool: list[str] = []
    # match_intel.extract output shape
    pool.extend(profile.get("interests") or [])
    # IG enrichment shape
    ig = profile.get("instagram_intel") or {}
    if isinstance(ig, dict):
        pool.extend(ig.get("hashtags") or [])
        pool.extend(ig.get("topics") or [])
    # Vision summary
    vision = profile.get("vision_summary") or {}
    if isinstance(vision, dict):
        pool.extend(vision.get("activities") or [])
        pool.extend(vision.get("scenes") or [])
    # Prompt themes
    pool.extend(profile.get("prompt_themes") or [])
    # De-dupe preserving order, lowercase, strip
    seen: set[str] = set()
    out: list[str] = []
    for x in pool:
        if not isinstance(x, str):
            continue
        norm = x.strip().lower().lstrip("#")
        if norm and norm not in seen:
            seen.add(norm)
            out.append(norm)
    return out


def _send_window_from_response_time(analysis: ConversationAnalysis) -> str:
    """Heuristic: if her median response time is <2 min during evenings,
    evening is the right window. Without timestamps we default to evening."""
    rt = analysis.response_time
    if rt.her_median_seconds is None:
        return "evening"
    # Fast responder overall — ping her any time
    if rt.her_median_seconds < 60 * 5:
        return "evening"
    # Slow responder — try mornings (she catches up before work)
    if rt.her_median_seconds > 60 * 60 * 6:
        return "morning"
    return "evening"


def _message_length_from_her_style(profile: dict | None) -> str:
    """If she writes short, write short. Default to medium."""
    if not profile:
        return "medium"
    style = profile.get("style_profile") or profile.get("comms") or {}
    if not isinstance(style, dict):
        return "medium"
    avg_words = style.get("avg_message_length") or style.get("avg_words")
    if isinstance(avg_words, (int, float)):
        if avg_words < 8:
            return "short"
        if avg_words > 18:
            return "long"
    return "medium"


def _tone_from_signals(analysis: ConversationAnalysis, profile: dict | None) -> str:
    """Choose tone based on flirtation level + sentiment + her energy."""
    if analysis.flirtation_level >= 0.4:
        return "flirty"
    if analysis.sentiment_score > 0.3 and analysis.engagement_level == "hot":
        return "playful"
    if analysis.sentiment_score < -0.1 or analysis.engagement_level == "cold":
        # She's lukewarm — don't push, be warm
        return "warm"
    # Default for healthy mid-conversation
    return "playful" if analysis.message_count >= 4 else "warm"


def _her_explicit_handoff(conversation: list[dict] | None) -> bool:
    """True if any of her messages is an explicit ask-for-number / move-to-text."""
    if not conversation:
        return False
    from clapcheeks.conversation.analyzer import _HER_ROLES, _normalize_messages
    norm = _normalize_messages(conversation)
    for m in norm:
        if m["side"] == "her" and _HANDOFF_REQUEST_RE.search(m["text"]):
            return True
    return False


def _move_to_text_score(
    analysis: ConversationAnalysis,
    conversation: list[dict] | None = None,
) -> tuple[int, str]:
    """Compose a 0-100 readiness score for asking-for-number / app-to-text.

    Components (weights):
      messages_exchanged    30
      sentiment_score       15
      engagement_level      20
      flirtation_level      15
      question_to_statement 10  (does she ask back?)
      response_speed         5
      her_explicit_handoff +25  (overrides everything if she literally asked)
    """
    score = 0.0
    parts: list[str] = []

    # 0. Explicit ask — strongest signal possible. She wants to move.
    explicit = _her_explicit_handoff(conversation)
    if explicit:
        score += 25
        parts.append("she asked for the move")

    # 1. Volume
    n = analysis.message_count
    if n >= 14:
        score += 30
        parts.append(f"{n} msgs (plenty)")
    elif n >= 10:
        score += 24
        parts.append(f"{n} msgs (enough)")
    elif n >= 6:
        score += 18
        parts.append(f"{n} msgs (warming)")
    elif n >= 3:
        score += 8
        parts.append(f"{n} msgs (early)")
    else:
        parts.append(f"{n} msgs (too early)")

    # 2. Sentiment
    s = analysis.sentiment_score
    if s >= 0.3:
        score += 15
        parts.append(f"sentiment +{s:.2f}")
    elif s >= 0.0:
        score += 8
        parts.append(f"sentiment ~{s:.2f}")
    else:
        parts.append(f"sentiment {s:.2f} (cool)")

    # 3. Engagement
    if analysis.engagement_level == "hot":
        score += 20
        parts.append("hot engagement")
    elif analysis.engagement_level == "warm":
        score += 12
        parts.append("warm engagement")
    else:
        parts.append("cold engagement")

    # 4. Flirtation
    flirt = analysis.flirtation_level
    if flirt >= 0.5:
        score += 15
        parts.append("clearly flirty")
    elif flirt >= 0.2:
        score += 8
        parts.append("some flirtation")

    # 5. Reciprocal questioning
    her_q = analysis.question_to_statement_ratio.get("her", 0.0)
    if her_q >= 0.4:
        score += 10
        parts.append("she asks back")
    elif her_q >= 0.2:
        score += 5

    # 6. Response speed
    rt = analysis.response_time
    if rt.her_median_seconds is not None and rt.her_median_seconds < 60 * 10:
        score += 5
        parts.append("quick replies")

    score_int = max(0, min(100, int(round(score))))
    rationale = ", ".join(parts) if parts else "limited signal"
    return score_int, rationale


def generate_strategy(
    match_profile: dict | None,
    conversation: list[dict] | None = None,
    analysis: ConversationAnalysis | None = None,
) -> ConversationStrategy:
    """Build a per-match conversation strategy.

    Args:
        match_profile: Raw match dict — anything with keys like `name`,
            `interests`, `instagram_intel`, `vision_summary`, `red_flags`,
            `style_profile`. Missing keys are tolerated.
        conversation:  Optional message history. If provided and `analysis`
            is None, it's analyzed automatically.
        analysis:      Pre-computed ConversationAnalysis if you already ran
            CONV-01.

    Returns: ConversationStrategy
    """
    profile = match_profile or {}
    if analysis is None:
        from clapcheeks.conversation.analyzer import analyze_conversation
        analysis = analyze_conversation(conversation or [])

    # ------ TRY TOPICS ------
    interests = _interests_from_profile(profile)
    # Prioritize interests that already appeared as topics in the conversation
    # but with cold engagement — those are the safest specific moves to try
    # again with a sharper angle.
    cold_topics = {
        t for t, level in analysis.engagement_per_topic.items()
        if level in {"cold", "warm"}
    }
    try_topics: list[str] = []
    for x in interests:
        if x not in try_topics:
            try_topics.append(x)
        if len(try_topics) >= 5:
            break
    # Top up from generic pool if she has too few signals
    for t in _GENERIC_TOPICS:
        if len(try_topics) >= 5:
            break
        if t not in try_topics:
            try_topics.append(t)

    # ------ AVOID TOPICS ------
    avoid: list[str] = []
    # Topics that already went cold in the conversation
    for topic, level in analysis.engagement_per_topic.items():
        if level == "cold" and topic not in avoid:
            avoid.append(topic)
    # Profile-stated red flags map to avoidance
    for flag in (profile.get("red_flags") or []):
        for t in _RED_FLAG_TO_AVOID.get(flag, []):
            if t not in avoid:
                avoid.append(t)
    # Always discourage low-value early-conversation topics
    for t in _LOW_VALUE_TOPICS:
        if t not in avoid:
            avoid.append(t)
    avoid_topics = avoid[:3]

    # ------ TONE / LENGTH / WINDOW ------
    tone = _tone_from_signals(analysis, profile)
    length = _message_length_from_her_style(profile)
    window = _send_window_from_response_time(analysis)

    # ------ MOVE TO TEXT ------
    score, rationale = _move_to_text_score(analysis, conversation)

    return ConversationStrategy(
        try_topics=try_topics[:5],
        avoid_topics=avoid_topics,
        suggested_tone=tone,
        ideal_message_length=length,
        best_send_window=window,
        move_to_text_score=score,
        rationale=rationale,
    )


def render_strategy_for_prompt(strategy: ConversationStrategy) -> str:
    """Compact text block for injection into the LLM system prompt.

    Mirrors the shape of `match_intel.format_for_system_prompt` so it slots
    in next to it without a layout change in callers.
    """
    lines = ["=== CONVERSATION STRATEGY ==="]
    if strategy.try_topics:
        lines.append("- Topics to lean into: " + ", ".join(strategy.try_topics))
    if strategy.avoid_topics:
        lines.append("- Topics to avoid: " + ", ".join(strategy.avoid_topics))
    lines.append(f"- Suggested tone: {strategy.suggested_tone}.")
    lines.append(f"- Ideal length: {strategy.ideal_message_length}.")
    if strategy.move_to_text_score >= 70:
        lines.append(
            f"- Move-to-text readiness: {strategy.move_to_text_score}/100 "
            "(GOOD — this turn or next, ask for the number / suggest meeting)."
        )
    elif strategy.move_to_text_score >= 40:
        lines.append(
            f"- Move-to-text readiness: {strategy.move_to_text_score}/100 "
            "(BUILDING — keep escalating, do not ask yet)."
        )
    else:
        lines.append(
            f"- Move-to-text readiness: {strategy.move_to_text_score}/100 "
            "(NOT READY — stay light, build rapport)."
        )
    return "\n".join(lines)


__all__ = [
    "ConversationStrategy",
    "generate_strategy",
    "render_strategy_for_prompt",
]
