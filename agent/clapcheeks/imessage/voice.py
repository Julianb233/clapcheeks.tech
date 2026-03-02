"""User texting style analyzer — learns how you text from iMessage history."""
from __future__ import annotations

import json
import os
import re
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from clapcheeks.imessage.reader import IMMessageReader

CONFIG_DIR = Path.home() / ".clapcheeks"
STYLE_CACHE = CONFIG_DIR / "imessage_style.json"
CACHE_MAX_AGE_HOURS = 24

# Emoji detection pattern covering common Unicode emoji ranges
_EMOJI_RE = re.compile(
    "[\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF]"
)


class VoiceAnalyzer:
    """Analyzes the user's outgoing iMessage style to guide AI reply generation."""

    def __init__(self, reader: IMMessageReader) -> None:
        self._reader = reader

    def analyze_style(
        self,
        chat_ids: list[int] | None = None,
        sample_size: int = 200,
    ) -> dict:
        """Analyze outgoing message style across conversations.

        Returns a cached result if the cache is less than 24 hours old.
        """
        cached = self._load_cache()
        if cached is not None:
            return cached

        # Collect outgoing messages
        if chat_ids is None:
            convos = self._reader.get_conversations(limit=20)
            chat_ids = [c["chat_id"] for c in convos]

        my_messages: list[dict] = []
        all_messages: list[dict] = []
        for cid in chat_ids:
            msgs = self._reader.get_messages(cid, limit=500)
            all_messages.extend(msgs)
            my_messages.extend(m for m in msgs if m["is_from_me"])
            if len(my_messages) >= sample_size:
                break

        my_messages = my_messages[:sample_size]

        if not my_messages:
            return self._empty_style()

        texts = [m["text"] for m in my_messages if m["text"]]
        if not texts:
            return self._empty_style()

        # Compute metrics
        avg_length = sum(len(t) for t in texts) / len(texts)
        emoji_count = sum(1 for t in texts if _EMOJI_RE.search(t))
        emoji_frequency = emoji_count / len(texts)
        lowercase_count = sum(1 for t in texts if t == t.lower())
        lowercase_ratio = lowercase_count / len(texts)
        question_count = sum(1 for t in texts if t.rstrip().endswith("?"))
        question_ratio = question_count / len(texts)

        # Common 2-3 word phrases
        phrase_counter: Counter[str] = Counter()
        for t in texts:
            words = t.lower().split()
            for n in (2, 3):
                for i in range(len(words) - n + 1):
                    phrase = " ".join(words[i : i + n])
                    phrase_counter[phrase] += 1
        common_phrases = [p for p, _ in phrase_counter.most_common(10) if phrase_counter[p] > 1]

        # Average response time
        avg_response_time = self._calc_avg_response_time(all_messages)

        # Build tone description
        tone_parts: list[str] = []
        tone_parts.append(f"{'Short' if avg_length < 50 else 'Medium' if avg_length < 120 else 'Long'}, "
                          f"{'casual' if lowercase_ratio > 0.6 else 'mixed-case'} messages "
                          f"(avg {int(avg_length)} chars)")
        if emoji_frequency > 0.3:
            tone_parts.append(f"heavy emoji use ({int(emoji_frequency * 100)}%)")
        elif emoji_frequency > 0.1:
            tone_parts.append(f"moderate emoji use ({int(emoji_frequency * 100)}%)")
        else:
            tone_parts.append("rarely uses emoji")
        if lowercase_ratio > 0.8:
            tone_parts.append("mostly lowercase")
        if question_ratio > 0.3:
            tone_parts.append("asks lots of questions")
        elif question_ratio < 0.1:
            tone_parts.append("rarely asks questions")
        tone_description = ", ".join(tone_parts)

        style = {
            "avg_length": round(avg_length, 1),
            "emoji_frequency": round(emoji_frequency, 3),
            "lowercase_ratio": round(lowercase_ratio, 3),
            "question_ratio": round(question_ratio, 3),
            "common_phrases": common_phrases,
            "avg_response_time_minutes": round(avg_response_time, 1),
            "tone_description": tone_description,
        }

        self._save_cache(style)
        return style

    def get_style_prompt(self, style: dict | None = None) -> str:
        """Convert a style profile into an LLM prompt instruction string."""
        if style is None:
            style = self.analyze_style()

        parts: list[str] = [
            f"Write in the user's style: messages averaging {int(style['avg_length'])} characters",
        ]
        if style["emoji_frequency"] > 0.3:
            parts.append("use emoji frequently")
        elif style["emoji_frequency"] < 0.1:
            parts.append("avoid emoji")
        if style["lowercase_ratio"] > 0.7:
            parts.append("keep everything lowercase")
        if style.get("common_phrases"):
            phrases_str = ", ".join(f"'{p}'" for p in style["common_phrases"][:5])
            parts.append(f"match their phrases like {phrases_str}")

        return ", ".join(parts)

    def _calc_avg_response_time(self, messages: list[dict]) -> float:
        """Calculate average minutes between incoming and user's reply."""
        response_times: list[float] = []
        for i in range(1, len(messages)):
            prev = messages[i - 1]
            curr = messages[i]
            if not prev["is_from_me"] and curr["is_from_me"]:
                if prev["date"] and curr["date"]:
                    delta = (curr["date"] - prev["date"]).total_seconds() / 60.0
                    if 0 < delta < 1440:  # Ignore gaps > 24 hours
                        response_times.append(delta)
        if not response_times:
            return 0.0
        return sum(response_times) / len(response_times)

    def _empty_style(self) -> dict:
        return {
            "avg_length": 0,
            "emoji_frequency": 0,
            "lowercase_ratio": 0,
            "question_ratio": 0,
            "common_phrases": [],
            "avg_response_time_minutes": 0,
            "tone_description": "No outgoing messages found to analyze",
        }

    def _load_cache(self) -> dict | None:
        """Load cached style if less than 24 hours old."""
        if not STYLE_CACHE.exists():
            return None
        age_hours = (time.time() - os.path.getmtime(STYLE_CACHE)) / 3600
        if age_hours >= CACHE_MAX_AGE_HOURS:
            return None
        try:
            with open(STYLE_CACHE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None

    def _save_cache(self, style: dict) -> None:
        """Save style profile to cache file."""
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(STYLE_CACHE, "w") as f:
            json.dump(style, f, indent=2)
