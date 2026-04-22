"""Communication style profiler — builds a per-contact profile from messages.

Analyzes a stream of messages (newest first) and produces a style dict that
mirrors the clapcheeks_contact_style_profiles schema. The daemon calls this
after each new message or as a batch job when first indexing a contact.

Usage:
    from clapcheeks.conversation.comms_profiler import build_style_profile

    messages = [
        {"sender": "contact", "text": "heyy whats up 😊", "sent_at": "2026-04-19T19:30:00Z"},
        {"sender": "user",    "text": "Not much, just got back from a hike", "sent_at": "2026-04-19T18:45:00Z"},
        ...
    ]
    profile = build_style_profile(messages)
    # => { avg_message_length, emoji_frequency, humor_style, formality_level, ... }
"""
from __future__ import annotations

import re
import statistics
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Emoji detection (covers most common Unicode emoji ranges)
# ---------------------------------------------------------------------------
_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"  # emoticons
    "\U0001F300-\U0001F5FF"  # symbols & pictographs
    "\U0001F680-\U0001F6FF"  # transport & map symbols
    "\U0001F1E0-\U0001F1FF"  # flags
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U0001F900-\U0001F9FF"  # supplemental symbols
    "\U0001FA00-\U0001FA6F"  # chess symbols
    "\U0001FA70-\U0001FAFF"  # symbols extended-A
    "\U00002600-\U000026FF"  # misc symbols
    "\U0000FE00-\U0000FE0F"  # variation selectors
    "\U0000200D"             # zero width joiner
    "]+",
    flags=re.UNICODE,
)

_QUESTION_RE = re.compile(r"\?")
_ABBREV_MARKERS = re.compile(r"\b(u|ur|gonna|wanna|gotta|tbh|lol|omg|idk|rn|ngl|imo|nvm|brb|ty|np)\b", re.I)

# Humor cues — very rough heuristic
_HUMOR_SARCASM = re.compile(r"\b(sure jan|oh totally|wow so|right\.{2,})\b", re.I)
_HUMOR_PLAYFUL = re.compile(r"(haha|lol|lmao|😂|🤣|😭|😆|💀)", re.I)
_HUMOR_DRY = re.compile(r"\b(riveting|thrilling|groundbreaking|fascinating)\b", re.I)
_HUMOR_ABSURD = re.compile(r"(shrek|goblin mode|feral|chaos|unhinged)", re.I)


def _parse_ts(ts: Any) -> datetime | None:
    """Best-effort ISO timestamp parser."""
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    if not isinstance(ts, str):
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _count_emojis(text: str) -> int:
    return len(_EMOJI_RE.findall(text))


def _top_emojis(texts: list[str], limit: int = 5) -> list[str]:
    """Return the top N distinct emojis by frequency."""
    counts: dict[str, int] = {}
    for t in texts:
        for match in _EMOJI_RE.finditer(t):
            e = match.group()
            # Split compound emojis (ZWJ sequences) — keep as-is
            counts[e] = counts.get(e, 0) + 1
    ranked = sorted(counts, key=lambda k: counts[k], reverse=True)
    return ranked[:limit]


def _detect_capitalization(texts: list[str]) -> str:
    """Classify capitalization style from a batch of texts."""
    all_lower = 0
    all_caps = 0
    normal = 0
    for t in texts:
        stripped = re.sub(r"[^a-zA-Z]", "", t)
        if not stripped:
            continue
        if stripped == stripped.lower():
            all_lower += 1
        elif stripped == stripped.upper() and len(stripped) > 3:
            all_caps += 1
        else:
            normal += 1
    total = all_lower + all_caps + normal
    if total == 0:
        return "normal"
    if all_lower / total > 0.7:
        return "all_lower"
    if all_caps / total > 0.5:
        return "all_caps"
    return "normal"


def _detect_punctuation(texts: list[str]) -> str:
    """Classify punctuation style."""
    with_period = sum(1 for t in texts if t.rstrip().endswith((".","!","?")))
    total = len(texts) or 1
    ratio = with_period / total
    excessive = sum(1 for t in texts if re.search(r"[!?]{2,}|\.{3,}", t))
    if excessive / total > 0.3:
        return "excessive"
    if ratio > 0.7:
        return "full"
    if ratio < 0.2:
        return "none"
    return "minimal"


def _detect_humor(texts: list[str]) -> str:
    """Detect dominant humor style."""
    scores = {"sarcastic": 0, "playful": 0, "dry": 0, "absurd": 0}
    for t in texts:
        if _HUMOR_SARCASM.search(t):
            scores["sarcastic"] += 1
        if _HUMOR_PLAYFUL.search(t):
            scores["playful"] += 1
        if _HUMOR_DRY.search(t):
            scores["dry"] += 1
        if _HUMOR_ABSURD.search(t):
            scores["absurd"] += 1
    best = max(scores, key=lambda k: scores[k])
    if scores[best] == 0:
        return "none"
    return best


def _formality_score(texts: list[str]) -> float:
    """0.0 = very casual, 1.0 = very formal.

    Heuristics: abbreviations, all-lowercase, emoji density, punctuation all
    push toward casual. Full sentences, proper capitalization, and complete
    words push toward formal.
    """
    if not texts:
        return 0.5
    signals: list[float] = []
    for t in texts:
        score = 0.5
        # Abbreviations → casual
        if _ABBREV_MARKERS.search(t):
            score -= 0.15
        # Emoji heavy → casual
        emoji_per_char = _count_emojis(t) / max(len(t), 1)
        if emoji_per_char > 0.05:
            score -= 0.1
        # All lowercase → casual
        alpha = re.sub(r"[^a-zA-Z]", "", t)
        if alpha and alpha == alpha.lower():
            score -= 0.1
        # Ends with period → formal
        if t.rstrip().endswith("."):
            score += 0.1
        signals.append(max(0.0, min(1.0, score)))
    return round(statistics.mean(signals), 2)


def _energy_score(texts: list[str]) -> float:
    """0.0 = low energy/chill, 1.0 = high energy/excitable."""
    if not texts:
        return 0.5
    signals: list[float] = []
    for t in texts:
        score = 0.5
        # Exclamation marks → higher energy
        excl = t.count("!")
        score += min(excl * 0.1, 0.3)
        # ALL CAPS → energy
        words = t.split()
        caps_words = sum(1 for w in words if w.isupper() and len(w) > 1)
        if caps_words > 0:
            score += min(caps_words * 0.05, 0.2)
        # Emoji density → energy
        score += min(_count_emojis(t) * 0.03, 0.15)
        # Short punchy messages → higher energy
        if len(t) < 20 and any(c in t for c in "!😂🤣💀🔥"):
            score += 0.1
        signals.append(max(0.0, min(1.0, score)))
    return round(statistics.mean(signals), 2)


def build_style_profile(
    messages: list[dict],
    *,
    contact_sender_label: str = "contact",
) -> dict[str, Any]:
    """Analyze messages and return a style profile dict.

    Parameters
    ----------
    messages : list[dict]
        Each message dict must have at least:
        - sender: str ("user" or "contact")
        - text: str
        - sent_at: str | datetime (ISO 8601)
        Messages should be ordered newest-first (most recent first).

    contact_sender_label : str
        The sender value that identifies the contact's messages (default "contact").

    Returns
    -------
    dict matching the clapcheeks_contact_style_profiles columns.
    """
    contact_msgs = [
        m for m in messages
        if m.get("sender") == contact_sender_label and m.get("text")
    ]
    user_msgs = [
        m for m in messages
        if m.get("sender") != contact_sender_label and m.get("text")
    ]

    if not contact_msgs:
        return {"messages_analyzed": 0, "confidence_score": 0.0}

    texts = [m["text"] for m in contact_msgs]
    lengths = [len(t) for t in texts]

    # --- Response times -------------------------------------------------------
    # Calculate response times: time between a user message and the next contact
    # message (sorted by sent_at ascending).
    all_sorted = sorted(
        [m for m in messages if m.get("sent_at")],
        key=lambda m: _parse_ts(m["sent_at"]) or datetime.min.replace(tzinfo=timezone.utc),
    )
    response_times: list[float] = []
    last_user_ts: datetime | None = None
    for m in all_sorted:
        ts = _parse_ts(m.get("sent_at"))
        if not ts:
            continue
        if m.get("sender") != contact_sender_label:
            last_user_ts = ts
        elif last_user_ts is not None:
            delta = (ts - last_user_ts).total_seconds()
            if 0 < delta < 86400 * 7:  # ignore gaps > 7 days
                response_times.append(delta)
            last_user_ts = None

    # --- Messages per turn (rapid-fire detection) -----------------------------
    # Count consecutive contact messages as a single "turn"
    turns = 0
    in_turn = False
    for m in all_sorted:
        if m.get("sender") == contact_sender_label:
            if not in_turn:
                turns += 1
                in_turn = True
        else:
            in_turn = False
    msgs_per_turn = len(contact_msgs) / max(turns, 1)

    # --- Emoji stats ----------------------------------------------------------
    emoji_counts = [_count_emojis(t) for t in texts]
    emoji_freq = statistics.mean(emoji_counts) if emoji_counts else 0.0

    # --- Question frequency ---------------------------------------------------
    q_counts = [len(_QUESTION_RE.findall(t)) for t in texts]
    q_freq = statistics.mean(q_counts) if q_counts else 0.0

    # --- Abbreviation usage ---------------------------------------------------
    uses_abbrevs = any(_ABBREV_MARKERS.search(t) for t in texts)

    # --- Confidence score (more data = more confident) ------------------------
    n = len(contact_msgs)
    if n >= 50:
        confidence = 0.95
    elif n >= 20:
        confidence = 0.75
    elif n >= 10:
        confidence = 0.55
    elif n >= 5:
        confidence = 0.35
    else:
        confidence = 0.15

    return {
        # Response patterns
        "avg_response_time_seconds": round(statistics.mean(response_times), 1) if response_times else None,
        "median_response_time_seconds": round(statistics.median(response_times), 1) if response_times else None,
        "response_time_variance": round(statistics.variance(response_times), 1) if len(response_times) >= 2 else None,

        # Message style
        "avg_message_length": round(statistics.mean(lengths), 1),
        "median_message_length": round(statistics.median(lengths), 1),
        "messages_per_turn": round(msgs_per_turn, 2),

        # Emoji & tone
        "emoji_frequency": round(emoji_freq, 2),
        "top_emojis": _top_emojis(texts),
        "humor_style": _detect_humor(texts),

        # Formality & energy
        "formality_level": _formality_score(texts),
        "energy_level": _energy_score(texts),

        # Communication quirks
        "uses_abbreviations": uses_abbrevs,
        "capitalization_style": _detect_capitalization(texts),
        "punctuation_style": _detect_punctuation(texts),
        "question_frequency": round(q_freq, 2),

        # Metadata
        "messages_analyzed": n,
        "confidence_score": confidence,
    }


def format_style_for_prompt(profile: dict[str, Any]) -> str:
    """Produce a compact prompt block describing how the contact communicates.

    Injected alongside match_intel output so the AI mirrors her style.
    """
    if not profile or profile.get("messages_analyzed", 0) < 3:
        return ""

    lines = ["=== HOW SHE TEXTS (mirror this) ==="]

    # Energy / formality summary
    energy = profile.get("energy_level", 0.5)
    formality = profile.get("formality_level", 0.5)
    if energy > 0.65:
        lines.append("- High energy — match her enthusiasm, use exclamation marks")
    elif energy < 0.35:
        lines.append("- Chill / laid-back — keep it relaxed, no over-excitement")

    if formality < 0.35:
        lines.append("- Very casual — abbreviations OK, skip periods, keep it breezy")
    elif formality > 0.65:
        lines.append("- More formal — complete sentences, proper punctuation")

    # Message length calibration
    avg_len = profile.get("avg_message_length")
    if avg_len:
        if avg_len < 30:
            lines.append(f"- She writes short ({int(avg_len)} chars avg) — keep replies similarly brief")
        elif avg_len > 120:
            lines.append(f"- She writes longer messages ({int(avg_len)} chars avg) — OK to write more")
        else:
            lines.append(f"- Medium message length ({int(avg_len)} chars) — match it")

    # Emoji mirroring
    emoji_freq = profile.get("emoji_frequency", 0)
    top = profile.get("top_emojis", [])
    if emoji_freq > 1.0 and top:
        lines.append(f"- Heavy emoji user ({emoji_freq:.1f}/msg) — favorites: {' '.join(top[:3])}")
    elif emoji_freq > 0.3 and top:
        lines.append(f"- Uses emojis moderately — her go-tos: {' '.join(top[:3])}")
    elif emoji_freq < 0.1:
        lines.append("- Rarely uses emojis — don't overdo them")

    # Humor
    humor = profile.get("humor_style", "none")
    if humor != "none":
        lines.append(f"- Humor: {humor} — lean into it")

    # Response pace
    avg_rt = profile.get("avg_response_time_seconds")
    if avg_rt:
        if avg_rt < 300:
            lines.append(f"- Fast responder (~{int(avg_rt/60)}min) — she's engaged, keep momentum")
        elif avg_rt > 3600:
            lines.append(f"- Slow responder (~{int(avg_rt/3600)}h) — don't double-text, be patient")

    # Questions
    q_freq = profile.get("question_frequency", 0)
    if q_freq > 0.5:
        lines.append("- She asks questions — always answer AND ask one back")
    elif q_freq < 0.1:
        lines.append("- She rarely asks questions — carry the curiosity, ask about her")

    return "\n".join(lines)
