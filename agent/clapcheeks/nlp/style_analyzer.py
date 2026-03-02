"""NLP conversation style analyzer.

Extracts communication fingerprints from conversation history:
- Message length patterns
- Punctuation and emoji habits
- Formality score (0=casual, 1=formal)
- Response energy (low/medium/high)
- Vocabulary diversity
- Sentence structure
- Question frequency

Used to mirror match's style and adapt opener/reply tone.
"""
from __future__ import annotations

import re
import string
from collections import Counter
from dataclasses import dataclass, field


@dataclass
class StyleProfile:
    """Communication style fingerprint extracted from messages."""

    # Length
    avg_words: float = 12.0
    median_words: float = 10.0
    uses_short_replies: bool = False  # avg < 6 words

    # Punctuation
    uses_ellipsis: bool = False       # "..." trailing
    uses_exclamation: bool = False
    uses_question_marks: float = 0.0  # questions per message
    ends_with_question: float = 0.0   # fraction ending with ?

    # Emoji
    emoji_frequency: float = 0.0      # emojis per message
    common_emojis: list[str] = field(default_factory=list)

    # Casing
    uses_lowercase_only: bool = False  # never capitalizes
    uses_all_caps_words: bool = False   # occasional ALL CAPS

    # Formality (0=very casual, 1=very formal)
    formality_score: float = 0.3

    # Energy
    energy_level: str = "medium"       # low | medium | high

    # Vocabulary
    vocab_diversity: float = 0.5       # unique words / total words
    filler_words: list[str] = field(default_factory=list)

    # Timing patterns
    response_speed: str = "normal"     # fast | normal | slow

    def to_prompt_description(self) -> str:
        """Convert style profile to a natural language description for the LLM."""
        parts = []

        # Length
        if self.uses_short_replies:
            parts.append("very short replies (1-5 words typically)")
        elif self.avg_words < 15:
            parts.append("concise messages (around 10-15 words)")
        else:
            parts.append("longer, detailed messages")

        # Casing
        if self.uses_lowercase_only:
            parts.append("no capitalization (all lowercase)")

        # Punctuation
        if self.uses_ellipsis:
            parts.append("uses '...' trailing off")
        if self.uses_exclamation:
            parts.append("enthusiastic with exclamation marks")
        if self.ends_with_question > 0.4:
            parts.append("often ends messages with questions to keep conversation going")

        # Emoji
        if self.emoji_frequency > 1.5:
            parts.append(f"heavy emoji user ({', '.join(self.common_emojis[:3])})")
        elif self.emoji_frequency > 0.3:
            parts.append(f"occasional emojis ({', '.join(self.common_emojis[:2])})")
        else:
            parts.append("rarely uses emojis")

        # Energy
        if self.energy_level == "high":
            parts.append("high energy and enthusiastic tone")
        elif self.energy_level == "low":
            parts.append("chill, low-key tone")

        # Formality
        if self.formality_score < 0.2:
            parts.append("very casual/street language")
        elif self.formality_score > 0.7:
            parts.append("relatively formal and articulate")

        return "; ".join(parts) if parts else "casual and conversational"


def analyze_messages(messages: list[dict], role: str = "user") -> StyleProfile:
    """Extract style profile from a list of conversation messages.

    Args:
        messages: List of {role, content} dicts.
        role: Which role to analyze ("user" = their messages, "assistant" = yours).

    Returns:
        StyleProfile with extracted communication fingerprint.
    """
    # Filter to target role
    texts = [m["content"] for m in messages if m.get("role") == role and m.get("content")]
    if not texts:
        return StyleProfile()

    profile = StyleProfile()

    # Word counts
    word_counts = [len(t.split()) for t in texts]
    profile.avg_words = sum(word_counts) / len(word_counts)
    sorted_wc = sorted(word_counts)
    mid = len(sorted_wc) // 2
    profile.median_words = sorted_wc[mid]
    profile.uses_short_replies = profile.avg_words < 6

    # Casing
    lowercase_count = sum(1 for t in texts if t == t.lower() and any(c.isalpha() for c in t))
    profile.uses_lowercase_only = lowercase_count / len(texts) > 0.7

    caps_count = sum(1 for t in texts if any(w.isupper() and len(w) > 2 for w in t.split()))
    profile.uses_all_caps_words = caps_count / len(texts) > 0.2

    # Punctuation
    ellipsis_count = sum(1 for t in texts if "..." in t)
    profile.uses_ellipsis = ellipsis_count / len(texts) > 0.2

    exclaim_count = sum(1 for t in texts if "!" in t)
    profile.uses_exclamation = exclaim_count / len(texts) > 0.25

    question_marks = sum(t.count("?") for t in texts)
    profile.uses_question_marks = question_marks / len(texts)

    end_q = sum(1 for t in texts if t.strip().endswith("?"))
    profile.ends_with_question = end_q / len(texts)

    # Emoji detection (simple Unicode range check)
    emoji_pattern = re.compile(
        "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF"
        "\U00002702-\U000027B0\U000024C2-\U0001F251]+",
        flags=re.UNICODE,
    )
    all_emojis = []
    for t in texts:
        found = emoji_pattern.findall(t)
        all_emojis.extend(found)

    profile.emoji_frequency = len(all_emojis) / len(texts)
    emoji_counts = Counter(all_emojis)
    profile.common_emojis = [e for e, _ in emoji_counts.most_common(5)]

    # Vocabulary diversity
    all_words = " ".join(texts).lower().split()
    if all_words:
        profile.vocab_diversity = len(set(all_words)) / len(all_words)

    # Formality score (heuristic)
    formal_markers = ["however", "therefore", "furthermore", "regarding", "appreciate", "certainly"]
    casual_markers = ["lol", "haha", "omg", "tbh", "ngl", "idk", "rn", "gonna", "wanna", "kinda"]
    joined = " ".join(texts).lower()
    formal_hits = sum(1 for w in formal_markers if w in joined)
    casual_hits = sum(1 for w in casual_markers if w in joined)
    total = formal_hits + casual_hits + 1
    profile.formality_score = formal_hits / total

    # Energy level
    exclaim_rate = exclaim_count / len(texts)
    high_energy_words = sum(1 for w in ["amazing", "love", "awesome", "excited", "can't wait", "literally"] if w in joined)
    if exclaim_rate > 0.5 or high_energy_words > 2:
        profile.energy_level = "high"
    elif exclaim_rate < 0.1 and profile.avg_words < 8:
        profile.energy_level = "low"
    else:
        profile.energy_level = "medium"

    # Filler words
    fillers = ["like", "literally", "basically", "honestly", "actually", "right", "so"]
    profile.filler_words = [w for w in fillers if f" {w} " in joined][:3]

    return profile
