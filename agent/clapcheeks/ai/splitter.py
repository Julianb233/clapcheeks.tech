"""Multi-thought splitter — breaks long drafts into Julian-style message arrays.

Per persona.message_formatting_rules.splitting_rule:
- If a draft contains 2+ distinct thoughts, return them as separate messages
- Each message is short (under 80 chars ideal, 160 hard cap)
- Max 3 messages per draft
- Preserve voice: lowercase-first, minimal punctuation, no AI-sounding joins

The client (platform send loop) sends these with 3-8 second pauses between.

PHASE-E - AI-8319
"""
from __future__ import annotations

import re
from typing import Any

# Sentence-terminal punctuation we split on (after sanitize).
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Za-z0-9])")

# Explicit conjunction "second thoughts" — Julian often splits on these.
_THOUGHT_MARKERS = [
    r"\balso\b",
    r"\band\b(?!\s+(?:I'm|i'm))",  # don't split "and I'm"
    r"\bbut\b",
    r"\bso\b(?!\s+(?:I|i)\b)",
    r"\banyway\b",
    r"\bbtw\b",
    r"\boh and\b",
    r"\boh yeah\b",
]


def _split_on_sentences(text: str) -> list[str]:
    """Split on .!? boundaries — but don't split mid-URL or ellipsis."""
    parts = _SENTENCE_END.split(text.strip())
    return [p.strip() for p in parts if p.strip()]


def _count_thoughts(parts: list[str]) -> int:
    """How many distinct thoughts are in this array? Heuristic."""
    n = 0
    for p in parts:
        words = p.split()
        if len(words) >= 2:
            n += 1
    return n


def split_draft_into_messages(
    text: str,
    ideal_max_chars: int = 80,
    hard_max_chars: int = 160,
    max_messages: int = 3,
) -> list[str]:
    """Split a draft into 1-3 short messages.

    Rules:
    - If text is a single thought <= ideal_max_chars, return [text]
    - If text has 2+ sentences, ALWAYS split per sentence (voice-preserving),
      even if it would fit in one message. Julian's rule: one thought per message.
    - If text has an internal thought-marker ("also", "and", "but") and is
      longer than ideal_max_chars, split on the marker.
    - Never exceed max_messages messages
    - Each message <= hard_max_chars (hard-truncate if needed)
    - Preserve voice: don't add punctuation, don't capitalize
    """
    if not text:
        return []

    stripped = text.strip()

    # Split on sentence boundaries first (always, regardless of length).
    parts = _split_on_sentences(stripped)

    # Single sentence + under ideal -> one message, no further work.
    if len(parts) == 1 and len(stripped) <= ideal_max_chars:
        return [stripped]

    # If that didn't produce multiple parts, try thought markers.
    if len(parts) == 1:
        # Find a thought-marker to split on (first match only)
        for pattern in _THOUGHT_MARKERS:
            m = re.search(pattern, parts[0], flags=re.IGNORECASE)
            if m and m.start() > 10:  # not right at the beginning
                left = parts[0][: m.start()].rstrip(" ,")
                right = parts[0][m.start():].strip()
                parts = [p for p in [left, right] if p]
                break

    # If still one part and it's over hard_max, truncate to hard_max.
    if len(parts) == 1:
        only = parts[0]
        if len(only) > hard_max_chars:
            # Try to cut on a word boundary near hard_max
            cut = only[:hard_max_chars].rsplit(" ", 1)[0] or only[:hard_max_chars]
            return [cut.rstrip(" ,.")]
        return [only]

    # If we have 2+ distinct sentences, preserve them as separate messages.
    # (Julian's rule: one thought per message.) Only merge a sentence into
    # the previous if the previous is extremely short (< 20 chars) AND the
    # combined length fits in ideal_max_chars / 2 — i.e. both fragments are
    # too short to be standalone messages.
    merged: list[str] = []
    for p in parts:
        if merged and len(merged[-1]) < 20 and (len(merged[-1]) + 1 + len(p)) <= ideal_max_chars // 2:
            merged[-1] = f"{merged[-1]} {p}"
        else:
            merged.append(p)

    # Cap to max_messages. If we have more, merge the tail into the last.
    if len(merged) > max_messages:
        head = merged[: max_messages - 1]
        tail = " ".join(merged[max_messages - 1:])
        if len(tail) > hard_max_chars:
            tail = tail[:hard_max_chars].rsplit(" ", 1)[0]
        merged = head + [tail]

    # Hard-truncate any overlong messages.
    out: list[str] = []
    for m in merged:
        if len(m) > hard_max_chars:
            cut = m[:hard_max_chars].rsplit(" ", 1)[0] or m[:hard_max_chars]
            out.append(cut.rstrip(" ,."))
        else:
            out.append(m)

    return out


def should_split(text: str, persona: dict[str, Any] | None = None) -> bool:
    """Heuristic: does this draft look like it wants to be split?"""
    if not text:
        return False
    rules = (persona or {}).get("message_formatting_rules", {}) or {}
    length = rules.get("length", {}) or {}
    ideal = length.get("ideal_max_chars", 80)
    if len(text) <= ideal:
        return False

    # Count sentences
    parts = _split_on_sentences(text)
    if len(parts) >= 2:
        return True

    # Look for thought markers
    for pattern in _THOUGHT_MARKERS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return True

    return False
