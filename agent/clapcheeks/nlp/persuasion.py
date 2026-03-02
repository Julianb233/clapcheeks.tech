"""Persuasion and rapport-building frameworks for dating conversations.

Implements:
- Cialdini's 6 principles: reciprocity, commitment, social proof, authority, liking, scarcity
- NLP techniques: pacing & leading, mirroring, embedded questions
- Funnel stages: attention -> interest -> desire -> action (AIDA)
- Conversational momentum: always move toward meeting

These are woven into the system prompt for the AI service.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ConversationStage(Enum):
    OPENER = "opener"         # First message -- grab attention
    BUILDING = "building"     # 2-5 messages -- build rapport
    QUALIFYING = "qualifying" # 6-10 messages -- test mutual interest
    DATE_PUSH = "date_push"   # 10+ or date-ready signals -- go for the meet
    BOOKED = "booked"         # Date confirmed


@dataclass
class PersuasionContext:
    """Context for selecting persuasion techniques."""
    stage: ConversationStage
    match_energy: str          # low | medium | high
    match_formality: float     # 0=casual, 1=formal
    days_since_match: int = 0
    has_responded: bool = True
    dry_spell: bool = False    # Match hasn't replied in 24h+


def get_persuasion_instructions(ctx: PersuasionContext) -> str:
    """Return stage-appropriate persuasion guidelines for the LLM system prompt."""

    base = _base_principles(ctx)
    stage_specific = _stage_instructions(ctx)
    mirror = _mirroring_instructions(ctx)

    return "\n".join([base, stage_specific, mirror])


def _base_principles(ctx: PersuasionContext) -> str:
    return """Persuasion principles to apply (naturally, not obviously):
- Reciprocity: share something genuine about yourself so they feel compelled to share back
- Liking: find and acknowledge genuine common ground; people say yes to those they like
- Scarcity (subtle): don't be too available; convey you have a full life
- Commitment: ask small questions they'll say yes to, building toward meeting"""


def _stage_instructions(ctx: PersuasionContext) -> str:
    if ctx.stage == ConversationStage.OPENER:
        return """Opener strategy:
- Be SPECIFIC -- reference something from their profile (not generic "hey")
- Create curiosity gap or playful misassumption to provoke a response
- End with ONE question maximum
- Goal: get them to reply, nothing else"""

    elif ctx.stage == ConversationStage.BUILDING:
        return """Rapport building strategy:
- Pace their energy: match their sentence length and enthusiasm level
- Find genuine connection points (shared interests, humor style, values)
- Use callback humor: reference something they said earlier
- Ask questions that reveal personality, not facts
- Goal: make them feel uniquely understood"""

    elif ctx.stage == ConversationStage.QUALIFYING:
        return """Qualification strategy:
- Flip the script: let them earn your attention ("you seem like someone who...")
- Test for real interest: are they asking questions back?
- Introduce light push-pull: playful challenge then warmth
- Plant seeds of meeting: "I know a great place for that"
- Goal: create mutual desire to meet"""

    elif ctx.stage == ConversationStage.DATE_PUSH:
        if ctx.days_since_match > 5:
            return """Date push strategy (urgency -- conversation going stale):
- Acknowledge the vibe directly: "we've been chatting a while, we should actually meet"
- Give two specific options (not "whenever you're free")
- Make it low-stakes: coffee, walk, drink -- not dinner
- If no response: one follow-up then let go
- Goal: get a yes to a specific time and place"""
        return """Date push strategy:
- Assume the date: "you'd like [activity]" not "would you like to..."
- Offer two concrete options: "Tuesday evening or Thursday after work?"
- Venue suggestion shows you have taste and have thought about it
- Goal: confirm time and place in THIS conversation"""

    elif ctx.stage == ConversationStage.BOOKED:
        return """Pre-date strategy:
- Confirm 24 hours before with one brief message
- Build anticipation: "looking forward to it"
- Don't over-communicate -- leave mystery
- Goal: keep them excited, prevent flaking"""

    return ""


def _mirroring_instructions(ctx: PersuasionContext) -> str:
    energy_guide = {
        "high": "Match their enthusiasm -- use similar energy and exclamation marks if they do",
        "medium": "Keep pace steady -- conversational and engaged without overdoing it",
        "low": "Stay chill -- short, confident replies; don't try to amp up the energy",
    }
    formality_guide = (
        "mirror their casual style -- contractions, slang if they use it, lowercase ok"
        if ctx.match_formality < 0.4
        else "maintain slightly polished tone since they write more formally"
    )

    return f"""Mirroring guidelines:
- Energy: {energy_guide.get(ctx.match_energy, 'match their pace')}
- Formality: {formality_guide}
- Length: aim for similar message length to theirs -- don't out-write them"""


def detect_stage(messages: list[dict]) -> ConversationStage:
    """Detect conversation stage from message history."""
    if not messages:
        return ConversationStage.OPENER

    count = len(messages)
    joined = " ".join(m.get("content", "").lower() for m in messages)
    date_confirmed = any(w in joined for w in ["see you", "confirmed", "it's a date", "can't wait"])
    date_push_words = ["meet", "coffee", "drinks", "dinner", "hang", "free", "plans", "weekend", "available"]
    date_signals = sum(1 for w in date_push_words if w in joined)

    if date_confirmed:
        return ConversationStage.BOOKED
    if count >= 8 or (date_signals >= 2 and count >= 4):
        return ConversationStage.DATE_PUSH
    if count >= 5:
        return ConversationStage.QUALIFYING
    if count >= 2:
        return ConversationStage.BUILDING
    return ConversationStage.OPENER
