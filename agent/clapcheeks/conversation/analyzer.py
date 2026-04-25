"""Conversation analysis engine — CONV-01 (Phase 41 / AI-8326).

Ingests a conversation history and extracts structured signals used by the
strategy generator (CONV-02) and downstream drafting (CONV-03).

Signals extracted:
  - topics:              dict[topic_name -> mention_count]
  - sentiment_score:     float in [-1.0, +1.0] (her side weighted)
  - sentiment_trend:     "rising" | "flat" | "falling"
  - engagement_level:    "cold" | "warm" | "hot"
  - engagement_per_topic: dict[topic_name -> "cold"|"warm"|"hot"]
  - engagement_peaks:    list[int] (message indices of high-engagement bursts)
  - response_time:       dict (median seconds, fastest/slowest, by side)
  - emoji_frequency:     emojis per message (her)
  - question_to_statement_ratio: floats per side
  - flirtation_level:    float in [0.0, 1.0]
  - message_count:       int
  - her_message_count:   int
  - us_message_count:    int

Inputs are platform-agnostic — works with the existing conversation message
shape used elsewhere in the codebase:

    [
        {"role": "user"|"her"|"contact"|"assistant"|"us",
         "content": "text",
         "sent_at": "2026-04-19T19:30:00Z" | None},
        ...
    ]

Either `role` or `sender` keys are accepted. Either `content` or `text`.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Topic taxonomy — broad dating-conversation categories with keyword cues.
# Order matters only for tie-breaking. Keywords are lowercased substrings.
# ---------------------------------------------------------------------------

_TOPIC_KEYWORDS: dict[str, list[str]] = {
    "travel": [
        "travel", "trip", "vacation", "flight", "flying", "tokyo", "paris",
        "europe", "mexico", "bali", "thailand", "japan", "italy", "spain",
        "passport", "airport", "hotel", "airbnb",
    ],
    "fitness": [
        "gym", "workout", "lifting", "lift", "crossfit", "yoga", "pilates",
        "run", "running", "5k", "10k", "marathon", "hike", "hiking", "climb",
        "rock climbing", "bouldering", "swim", "swimming", "surf", "surfing",
    ],
    "food": [
        "food", "eat", "ate", "dinner", "lunch", "brunch", "breakfast",
        "cook", "cooked", "cooking", "recipe", "restaurant", "ramen",
        "sushi", "pizza", "tacos", "burger", "coffee", "matcha", "tea",
    ],
    "drinks": [
        "drink", "drinks", "beer", "wine", "cocktail", "bar", "brewery",
        "tequila", "vodka", "whiskey", "margarita", "happy hour",
    ],
    "music": [
        "music", "song", "album", "concert", "festival", "spotify", "playlist",
        "band", "show", "dj", "edm", "rap", "hip hop", "country", "indie",
    ],
    "movies_tv": [
        "movie", "film", "show", "netflix", "hbo", "watch", "watching",
        "series", "season", "episode", "documentary",
    ],
    "work": [
        "work", "job", "office", "boss", "client", "meeting", "deadline",
        "project", "career", "company", "startup", "founder", "ceo",
    ],
    "school": [
        "school", "college", "university", "class", "professor", "exam",
        "degree", "major", "grad school", "phd", "thesis",
    ],
    "family": [
        "family", "mom", "dad", "sister", "brother", "parents", "siblings",
        "cousin", "kids", "nephew", "niece", "grandma", "grandpa",
    ],
    "pets": [
        "dog", "puppy", "cat", "kitten", "pet", "vet", "leash", "walk the",
        "walking the dog",
    ],
    "weekend_plans": [
        "weekend", "saturday", "sunday", "friday night", "free this", "tonight",
        "later this week", "tomorrow",
    ],
    "date_proposal": [
        "meet up", "meet you", "grab a", "grab drinks", "grab coffee",
        "let's meet", "want to meet", "should meet", "down to grab",
        "free for", "we should", "wanna get", "wanna grab", "wanna hang",
    ],
    "sex_flirt": [
        "kiss", "kissing", "naughty", "tease", "teasing", "spicy", "lingerie",
        "sleep over", "stay over", "in bed", "shower together", "naked",
    ],
    "future_plans": [
        "future", "long term", "looking for", "kids someday", "marriage",
        "settle down", "five years",
    ],
    "san_diego_local": [
        "san diego", "la jolla", "encinitas", "north park", "pacific beach",
        "ocean beach", "del mar", "balboa park", "gaslamp", "coronado",
        "carlsbad", "oceanside", "downtown",
    ],
    "instagram": [
        "instagram", "ig", "follow you", "follow me", "stories", "post",
        "reel",
    ],
}

# Words and patterns indicating engagement quality
_HIGH_ENGAGEMENT_WORDS = {
    "love", "obsessed", "literally", "omg", "amazing", "yes!!", "hell yeah",
    "for sure", "no way", "haha", "lol", "lmao", "stop", "wait what",
    "tell me more", "what about you",
}
_LOW_ENGAGEMENT_REPLIES = {"k", "ok", "lol", "haha", "yeah", "yea", "no", "nah", "cool", "nice", "lmao"}

# Sentiment lexicon (tiny — heuristic, no external deps)
_POSITIVE_LEX = {
    "love", "loved", "great", "amazing", "incredible", "awesome", "fun",
    "happy", "excited", "stoked", "yay", "cute", "haha", "lol", "lmao",
    "perfect", "yes", "best", "favorite", "good", "beautiful", "nice",
    "down", "obsessed",
}
_NEGATIVE_LEX = {
    "hate", "hated", "annoying", "tired", "stressed", "ugh", "sad", "bored",
    "no", "nope", "bad", "awful", "terrible", "lame", "sucks", "boring",
    "worried", "anxious", "exhausted", "drained",
}
_NEGATION = {"not", "never", "don't", "dont", "didnt", "didn't"}

# Flirtation cues — heuristic, weighted by intensity
_FLIRT_HIGH = {
    "kiss", "lingerie", "tease", "naughty", "in bed", "shower", "spicy",
    "naked", "sleep over", "stay over",
}
_FLIRT_MID = {
    "cute", "handsome", "pretty", "sexy", "hot", "gorgeous", "fine",
    "wink", "smirk", "blush",
}
_FLIRT_LOW = {"😉", "😘", "😏", "🥵", "🔥", "💋", "😈"}

_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002600-\U000026FF"
    "]+",
    flags=re.UNICODE,
)

_HER_ROLES = {"user", "her", "contact", "match"}
_US_ROLES = {"assistant", "us", "julian", "me"}


@dataclass
class ResponseTimeStats:
    her_median_seconds: float | None = None
    us_median_seconds: float | None = None
    her_fastest_seconds: float | None = None
    her_slowest_seconds: float | None = None
    her_response_count: int = 0
    us_response_count: int = 0


@dataclass
class ConversationAnalysis:
    """Structured output of `analyze_conversation`."""

    message_count: int = 0
    her_message_count: int = 0
    us_message_count: int = 0

    # Topics
    topics: dict[str, int] = field(default_factory=dict)
    primary_topic: str | None = None

    # Sentiment
    sentiment_score: float = 0.0           # [-1.0, +1.0]
    sentiment_trend: str = "flat"          # rising | flat | falling

    # Engagement
    engagement_level: str = "warm"         # cold | warm | hot
    engagement_per_topic: dict[str, str] = field(default_factory=dict)
    engagement_peaks: list[int] = field(default_factory=list)

    # Style + behavior
    response_time: ResponseTimeStats = field(default_factory=ResponseTimeStats)
    emoji_frequency: float = 0.0           # her emojis per message
    question_to_statement_ratio: dict[str, float] = field(default_factory=dict)
    flirtation_level: float = 0.0          # [0.0, 1.0]

    def to_dict(self) -> dict:
        return {
            "message_count": self.message_count,
            "her_message_count": self.her_message_count,
            "us_message_count": self.us_message_count,
            "topics": self.topics,
            "primary_topic": self.primary_topic,
            "sentiment_score": round(self.sentiment_score, 3),
            "sentiment_trend": self.sentiment_trend,
            "engagement_level": self.engagement_level,
            "engagement_per_topic": self.engagement_per_topic,
            "engagement_peaks": self.engagement_peaks,
            "response_time": {
                "her_median_seconds": self.response_time.her_median_seconds,
                "us_median_seconds": self.response_time.us_median_seconds,
                "her_fastest_seconds": self.response_time.her_fastest_seconds,
                "her_slowest_seconds": self.response_time.her_slowest_seconds,
                "her_response_count": self.response_time.her_response_count,
                "us_response_count": self.response_time.us_response_count,
            },
            "emoji_frequency": round(self.emoji_frequency, 3),
            "question_to_statement_ratio": {
                k: round(v, 3) for k, v in self.question_to_statement_ratio.items()
            },
            "flirtation_level": round(self.flirtation_level, 3),
        }


def _normalize_messages(messages: Iterable[dict]) -> list[dict]:
    """Return a uniform list with side, text, ts."""
    out: list[dict] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        text = m.get("content") or m.get("text") or ""
        if not isinstance(text, str):
            text = str(text)
        role = (m.get("role") or m.get("sender") or "").lower()
        if role in _HER_ROLES:
            side = "her"
        elif role in _US_ROLES:
            side = "us"
        else:
            # Heuristic fallback — anything not us is treated as her so we
            # don't drop messages from unfamiliar shapes.
            side = "her"
        ts = _parse_ts(m.get("sent_at") or m.get("timestamp") or m.get("ts"))
        out.append({"side": side, "text": text.strip(), "ts": ts})
    return out


def _parse_ts(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (ValueError, OSError):
            return None
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _topic_hits(text: str) -> list[str]:
    low = text.lower()
    hits: list[str] = []
    for topic, cues in _TOPIC_KEYWORDS.items():
        for c in cues:
            if c in low:
                hits.append(topic)
                break
    return hits


def _sentiment_score(text: str) -> float:
    """Return per-message sentiment in [-1, +1]. Tiny lexicon w/ negation."""
    if not text:
        return 0.0
    tokens = re.findall(r"[A-Za-z']+", text.lower())
    if not tokens:
        return 0.0
    score = 0.0
    matches = 0
    for i, tok in enumerate(tokens):
        sign = -1 if (i > 0 and tokens[i - 1] in _NEGATION) else 1
        if tok in _POSITIVE_LEX:
            score += 1.0 * sign
            matches += 1
        elif tok in _NEGATIVE_LEX:
            score -= 1.0 * sign
            matches += 1
    if matches == 0:
        return 0.0
    return max(-1.0, min(1.0, score / max(matches, 1)))


def _sentiment_trend(scores: list[float]) -> str:
    """First-half avg vs second-half avg."""
    if len(scores) < 4:
        return "flat"
    mid = len(scores) // 2
    first = sum(scores[:mid]) / max(mid, 1)
    second = sum(scores[mid:]) / max(len(scores) - mid, 1)
    delta = second - first
    if delta >= 0.15:
        return "rising"
    if delta <= -0.15:
        return "falling"
    return "flat"


def _engagement_for_text(text: str, all_words: int) -> str:
    """Per-message engagement bucket."""
    if not text.strip():
        return "cold"
    low = text.lower().strip()
    word_count = len(low.split())
    # One-word lazy reply = cold
    if word_count <= 1 and low in _LOW_ENGAGEMENT_REPLIES:
        return "cold"
    # Long, multi-question, high-energy = hot
    high_hits = sum(1 for w in _HIGH_ENGAGEMENT_WORDS if w in low)
    has_q = "?" in text
    if word_count >= 12 and (has_q or high_hits >= 1):
        return "hot"
    if word_count >= 6 or high_hits >= 1 or has_q:
        return "warm"
    return "cold"


def _flirtation_level(her_texts: list[str]) -> float:
    if not her_texts:
        return 0.0
    score = 0.0
    for t in her_texts:
        low = t.lower()
        for w in _FLIRT_HIGH:
            if w in low:
                score += 0.5
        for w in _FLIRT_MID:
            if w in low:
                score += 0.25
        for e in _FLIRT_LOW:
            if e in t:
                score += 0.15
    # Normalize per-message average then cap at 1.0
    per_msg = score / len(her_texts)
    return max(0.0, min(1.0, per_msg))


def _response_times(messages: list[dict]) -> ResponseTimeStats:
    her_gaps: list[float] = []
    us_gaps: list[float] = []
    for prev, cur in zip(messages, messages[1:]):
        if prev["ts"] is None or cur["ts"] is None:
            continue
        if prev["side"] == cur["side"]:
            continue
        gap = (cur["ts"] - prev["ts"]).total_seconds()
        if gap < 0:
            continue
        if cur["side"] == "her":
            her_gaps.append(gap)
        else:
            us_gaps.append(gap)
    stats = ResponseTimeStats(
        her_median_seconds=statistics.median(her_gaps) if her_gaps else None,
        us_median_seconds=statistics.median(us_gaps) if us_gaps else None,
        her_fastest_seconds=min(her_gaps) if her_gaps else None,
        her_slowest_seconds=max(her_gaps) if her_gaps else None,
        her_response_count=len(her_gaps),
        us_response_count=len(us_gaps),
    )
    return stats


def _question_to_statement(texts: list[str]) -> float:
    if not texts:
        return 0.0
    questions = sum(1 for t in texts if "?" in t)
    statements = sum(1 for t in texts if t.strip() and "?" not in t)
    if statements == 0:
        return float(questions) if questions else 0.0
    return questions / statements


def _engagement_overall(per_msg: list[str]) -> str:
    if not per_msg:
        return "cold"
    counts = {"cold": 0, "warm": 0, "hot": 0}
    for level in per_msg:
        counts[level] = counts.get(level, 0) + 1
    total = sum(counts.values())
    hot_share = counts["hot"] / total
    cold_share = counts["cold"] / total
    if hot_share >= 0.30:
        return "hot"
    if cold_share >= 0.60:
        return "cold"
    return "warm"


def analyze_conversation(messages: Iterable[dict]) -> ConversationAnalysis:
    """Run CONV-01 analysis on a conversation history.

    Robust to partial inputs — missing timestamps, mixed key shapes, empty
    bodies. Only message *content* drives topic/sentiment/engagement signals;
    timestamps drive response-time signals (skipped if absent).
    """
    norm = _normalize_messages(messages)
    her = [m for m in norm if m["side"] == "her"]
    us = [m for m in norm if m["side"] == "us"]
    her_texts = [m["text"] for m in her if m["text"]]
    us_texts = [m["text"] for m in us if m["text"]]

    out = ConversationAnalysis(
        message_count=len(norm),
        her_message_count=len(her),
        us_message_count=len(us),
    )

    # Topics — count weighted by side, but topic counts are total mentions
    topic_counts: dict[str, int] = {}
    per_topic_engagement: dict[str, list[str]] = {}
    per_msg_engagement: list[str] = []
    sentiment_per_her: list[float] = []
    peaks: list[int] = []

    total_words = sum(len(m["text"].split()) for m in norm)

    for idx, m in enumerate(norm):
        text = m["text"]
        if not text:
            continue
        hits = _topic_hits(text)
        for topic in hits:
            topic_counts[topic] = topic_counts.get(topic, 0) + 1
        eng = _engagement_for_text(text, total_words)
        per_msg_engagement.append(eng)
        for topic in hits:
            per_topic_engagement.setdefault(topic, []).append(eng)
        if eng == "hot":
            peaks.append(idx)
        if m["side"] == "her":
            sentiment_per_her.append(_sentiment_score(text))

    out.topics = dict(sorted(topic_counts.items(), key=lambda kv: -kv[1]))
    if out.topics:
        out.primary_topic = next(iter(out.topics))

    # Per-topic engagement bucket = the dominant level for that topic
    for topic, levels in per_topic_engagement.items():
        out.engagement_per_topic[topic] = _engagement_overall(levels)

    out.engagement_level = _engagement_overall(per_msg_engagement)
    out.engagement_peaks = peaks

    # Sentiment
    if sentiment_per_her:
        out.sentiment_score = sum(sentiment_per_her) / len(sentiment_per_her)
        out.sentiment_trend = _sentiment_trend(sentiment_per_her)

    # Response times
    out.response_time = _response_times(norm)

    # Emoji frequency on her side
    if her_texts:
        emoji_total = sum(len(_EMOJI_RE.findall(t)) for t in her_texts)
        out.emoji_frequency = emoji_total / len(her_texts)

    # Question/statement ratio
    out.question_to_statement_ratio = {
        "her": _question_to_statement(her_texts),
        "us": _question_to_statement(us_texts),
    }

    # Flirtation
    out.flirtation_level = _flirtation_level(her_texts)

    return out


__all__ = [
    "ConversationAnalysis",
    "ResponseTimeStats",
    "analyze_conversation",
]
