"""Local Ollama reply generator — all inference stays on-device.

Includes the P2 anti-LLM-voice guard stack, P6 per-contact memo injection
(read side), P7 time-aware staleness recovery prompting, and AI-8763
voice-digest few-shot prompting from chat.db.

AI-8763 belt-and-suspenders design: the voice digest (computed by
clapcheeks.voice.clone from the operator's chat.db) is injected as
{role: "assistant"} few-shot examples BEFORE the live conversation, plus
a numeric system-prompt constraint (avg length, emoji ratio, openers).
The P2 _clean_output guard stack still runs AFTER the LLM responds — both
layers are intentionally complementary.
"""
from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path

from clapcheeks.config import load as load_config

try:  # optional dependency
    import ollama  # type: ignore
except ImportError:  # pragma: no cover - exercised when ollama is absent
    ollama = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# P2 — anti-LLM-voice guard tables
# ---------------------------------------------------------------------------

META_LEAK = [
    "based on her",
    "match her energy",
    "draft:",
    "option 1",
    "as julian",
    "let me draft",
    "i should respond",
    "based on the conversation",
    "the system prompt",
    "as the assistant",
    "her profile",
    "from her profile",
    "match her tone",
    "let me respond",
    "i'll respond",
]

SAFETY_BLOCK = [
    "absolutely",
    "certainly",
    "explore",
    "could you",
    "i need to",
    "share what",
    "local guide",
    "here's a draft",
    "i'd love to",
    "what a lovely",
    "what a great",
    "that's wonderful",
    "that's so",
    "i appreciate",
]

MONEY_JK_BLOCK = [
    "cashapp",
    "venmo",
    "zelle",
    "send it",
    "i'll send",
    "ill send",
    "sending now",
    "sent it",
    "lol jk",
    "lol j/k",
    "just kidding",
    "jk jk",
    "fly out",
    "book a flight",
    "book my flight",
    "planning a trip",
    "i'll be in vegas",
    "i'll be in la",
    "i'll be in miami",
    "i'll be in phoenix",
    "ill be in vegas",
    "ill be in la",
    "ill be in miami",
    "ill be in phoenix",
    "come out there",
    "come visit you",
    "come see you",
    "i'll be there",
    "ill be there",
    "coming to la",
    "coming to miami",
    "coming to phoenix",
    "coming to vegas",
    "heading to la",
    "heading to miami",
    "heading to vegas",
    "heading to phoenix",
    "pick you up in vegas",
    "pick you up in la",
    "pick you up in miami",
    "pick you up in phoenix",
    "pick you up at the airport",
]

SLANG_BLOCK = [
    "aight",
    "fr fr ",
    " yo ",
    "no cap",
    "deadass",
    "sup brodie",
]

PHONE_RE = re.compile(r"\d{3}[-.\s]?\d{3}[-.\s]?\d{4}")
QUESTION_RE = re.compile(r"(?:what|where|how|when|who)\s+\w+", re.IGNORECASE)

TIME_WORDS = [
    "tonight",
    "this evening",
    "right now",
    "today",
    "this afternoon",
    "this morning",
    " rn",
    " tn",
]


def _preview(text: str, n: int = 80) -> str:
    """Trim text for log preview."""
    flat = text.replace("\n", " ").strip()
    return flat[:n]


def _clean_output(text: str, prior_messages: list[str]) -> str:
    """Run LLM output through the P2 anti-LLM-voice guard stack.

    Returns "" if the output is rejected by any guard, otherwise the cleaned text.

    Guards (in order):
    1. Last-paragraph keep (kills reasoning leaks).
    2. META_LEAK blocklist.
    3. SAFETY_BLOCK (LLM tells).
    4. Money/JK/travel guard.
    5. Slang block.
    6. Em-dash strip.
    7. Length cap (>250 reject, <2 reject).
    8. Fake phone number guard.
    9. >60% word-overlap with prior messages.
    10. Question repetition.
    """
    if text is None:
        return ""

    # 1. Keep last paragraph only
    text = text.split("\n\n")[-1].strip()
    lower = text.lower()

    # 2. META_LEAK
    for needle in META_LEAK:
        if needle in lower:
            logger.info("BLOCKED (meta_leak '%s'): %s", needle, _preview(text))
            return ""

    # 3. SAFETY_BLOCK
    for needle in SAFETY_BLOCK:
        if needle in lower:
            logger.info("BLOCKED (safety_block '%s'): %s", needle, _preview(text))
            return ""

    # 4. Money / JK / travel
    for needle in MONEY_JK_BLOCK:
        if needle in lower:
            logger.info("BLOCKED (money_jk '%s'): %s", needle, _preview(text))
            return ""

    # 5. Slang
    for needle in SLANG_BLOCK:
        if needle in lower:
            logger.info("BLOCKED (slang '%s'): %s", needle, _preview(text))
            return ""

    # 6. Em-dash strip
    text = (
        text.replace(" — ", ", ")
        .replace(" – ", ", ")
        .replace("—", ",")
        .replace("–", ",")
    )

    # 7. Length cap
    if len(text) > 250:
        logger.info("BLOCKED (length>250): %s", _preview(text))
        return ""
    if len(text) < 2:
        logger.info("BLOCKED (length<2): %s", _preview(text))
        return ""

    # 8. Fake phone regex
    phone_match = PHONE_RE.search(text)
    if phone_match:
        digits = re.sub(r"\D", "", phone_match.group(0))
        my_digits = os.environ.get("MY_PHONE_DIGITS", "")
        if digits != my_digits:
            logger.info("BLOCKED (fake_phone '%s'): %s", digits, _preview(text))
            return ""

    # 9. Word-overlap >60% vs last 5 prior messages
    resp_words = {w.lower() for w in re.findall(r"\w+", text)}
    if len(resp_words) >= 4:
        for prior in prior_messages[-5:]:
            if not prior:
                continue
            prior_words = {w.lower() for w in re.findall(r"\w+", prior)}
            if not prior_words:
                continue
            overlap = len(resp_words & prior_words) / len(resp_words)
            if overlap > 0.6:
                logger.info(
                    "BLOCKED (overlap=%.2f vs prior): %s",
                    overlap,
                    _preview(text),
                )
                return ""

    # 10. Question repetition
    response_questions = QUESTION_RE.findall(text)
    if response_questions:
        for prior in prior_messages:
            if not prior:
                continue
            prior_questions = QUESTION_RE.findall(prior)
            for rq in response_questions:
                rq_l = rq.lower().strip()
                for pq in prior_questions:
                    if pq.lower().strip() == rq_l:
                        logger.info(
                            "BLOCKED (question_repeat '%s'): %s",
                            rq_l,
                            _preview(text),
                        )
                        return ""

    return text


# ---------------------------------------------------------------------------
# P6 (read side) — load per-contact memo
# ---------------------------------------------------------------------------

def _load_memo(handle_id: str) -> str:
    """Load per-contact memo from ~/.clapcheeks/memos/<handle_id>.md if it exists.

    handle_id is typically a phone like '+15551234567' or an email address.
    Returns empty string when no memo file exists.
    """
    if not handle_id:
        return ""
    memo_dir = Path.home() / ".clapcheeks" / "memos"
    safe_name = handle_id.replace("/", "_")
    memo_path = memo_dir / f"{safe_name}.md"
    try:
        return memo_path.read_text().strip()
    except (FileNotFoundError, OSError):
        return ""


# ---------------------------------------------------------------------------
# AI-8763 — voice-digest few-shot prompting
# ---------------------------------------------------------------------------


def _load_voice_digest() -> dict | None:
    """Load the operator's chat.db-derived style digest, if available.

    Returns None when no digest has been computed yet. Callers should
    treat None as "no few-shot data" and continue with the existing
    style_prompt path only — the older voice.py heuristic still runs
    upstream.
    """
    try:
        from clapcheeks.voice.clone import load_digest
    except ImportError:  # pragma: no cover - voice module always present
        return None
    try:
        return load_digest()
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("voice digest unavailable: %s", exc)
        return None


def _digest_style_constraint(digest: dict) -> str:
    """Render the digest stats as a single-sentence system-prompt constraint."""
    avg = digest.get("avg_length_chars") or 0
    emoji_ratio = digest.get("emoji_per_message") or 0
    openers = digest.get("most_common_openers") or []
    parts: list[str] = []
    if avg:
        parts.append(f"avg length ~{int(round(avg))} chars")
    parts.append(f"emojis ~{emoji_ratio:.0%} of messages")
    if openers:
        parts.append("common openers: " + ", ".join(openers[:5]))
    if not parts:
        return ""
    return "Match this style: " + "; ".join(parts) + "."


def _digest_few_shot_examples(digest: dict, max_examples: int = 12) -> list[dict]:
    """Convert digest sample_messages into Ollama-format few-shot turns.

    Renders alternating user/assistant turns so the LLM treats them as
    past conversational style rather than plain context. Operator-curated
    'boosted_samples' (set by /studio/voice tone calibration) are always
    placed first.
    """
    samples = digest.get("sample_messages") or []
    if not samples:
        return []
    boosted = digest.get("boosted_samples") or []
    ordered = list(boosted) + [s for s in samples if s not in boosted]
    ordered = ordered[:max_examples]

    examples: list[dict] = []
    for s in ordered:
        examples.append({"role": "user", "content": "(continue conversation)"})
        examples.append({"role": "assistant", "content": s})
    return examples


class ReplyGenerator:
    """Generate reply suggestions using local Ollama models only."""

    def __init__(self, model: str | None = None, style_prompt: str = "") -> None:
        config = load_config()
        self.model = model or config.get("ai_model", "llama3.2")
        self.style_prompt = style_prompt
        # AI-8763: cached at construct-time so we don't re-read the file
        # on every generation call. `clapcheeks watch --style-refresh`
        # re-constructs ReplyGenerator and so picks up a fresh digest.
        self._voice_digest = _load_voice_digest()

    def suggest_reply(
        self,
        conversation: list[dict],
        contact_name: str = "",
        temperature: float = 0.7,
        handle_id: str = "",
        last_msg_timestamp: float = 0.0,
        last_msg_text: str = "",
    ) -> str:
        """Generate a single reply suggestion via local Ollama.

        All inference runs on localhost:11434 — no data leaves the device.

        Parameters
        ----------
        conversation:
            Last N messages (each dict has ``text`` and ``is_from_me``).
        contact_name:
            Display name of the recipient (optional).
        temperature:
            Ollama sampling temperature.
        handle_id:
            Phone number / email used to look up persistent memo (P6).
        last_msg_timestamp:
            UNIX timestamp of her last inbound message; used for P7
            time-staleness recovery prompt.
        last_msg_text:
            Text of her last inbound message (used by P7).
        """
        if ollama is None:
            return "Error: ollama package not installed. Run: pip install ollama"

        system_prompt = (
            "You are a dating conversation assistant. Generate a reply "
            "that the user would send. "
            f"{self.style_prompt}. "
            "Reply with ONLY the message text, no quotes, no explanation. "
            "Keep it natural and conversational."
        )
        if contact_name:
            system_prompt += f" The user is texting {contact_name}."

        # P7 — time-aware staleness recovery
        hours_since = (
            (time.time() - last_msg_timestamp) / 3600 if last_msg_timestamp else 0
        )
        is_stale_time_sensitive = (
            hours_since > 4
            and last_msg_text
            and any(w in last_msg_text.lower() for w in TIME_WORDS)
        )
        if is_stale_time_sensitive:
            system_prompt += (
                f"\n\nNOTE: Her last message was {hours_since:.0f}h ago and "
                "referenced time-sensitive plans. Apologize briefly for the "
                "late reply and propose a NEW plan for later this week. "
                "Do NOT proceed as if the original time-sensitive plan is "
                "still on."
            )

        # P6 — per-contact memo injection
        memo = _load_memo(handle_id)
        if memo:
            system_prompt = (
                "[PERSISTENT MEMO about this contact - treat as facts you "
                f"already know about her]:\n{memo}\n\n" + system_prompt
            )

        # AI-8763 — append numeric style constraint from chat.db digest.
        if self._voice_digest:
            extra = _digest_style_constraint(self._voice_digest)
            if extra:
                system_prompt += " " + extra

        # Build message history from last 10 messages
        messages: list[dict[str, str]] = [
            {"role": "system", "content": system_prompt}
        ]

        # AI-8763 — inject few-shot examples from the operator's past sends
        # BEFORE the live conversation history so the LLM has stylistic
        # anchors before it sees the current thread. Belt-and-suspenders
        # with the P2 anti-voice guards downstream.
        if self._voice_digest:
            messages.extend(_digest_few_shot_examples(self._voice_digest))

        for msg in conversation[-10:]:
            role = "assistant" if msg.get("is_from_me") else "user"
            text = msg.get("text", "")
            if text:
                messages.append({"role": role, "content": text})

        try:
            response = ollama.chat(
                model=self.model,
                messages=messages,
                options={"temperature": temperature},
            )
            raw_text = response["message"]["content"].strip()
        except ConnectionError:
            return "Ollama not running. Start it with: ollama serve"
        except Exception as exc:
            logger.error("Ollama chat failed: %s", exc)
            return f"Error generating reply: {exc}"

        # P2 — guard stack
        prior_messages = [
            m.get("text", "")
            for m in conversation
            if m.get("is_from_me") and m.get("text")
        ]
        cleaned = _clean_output(raw_text, prior_messages)
        return cleaned

    def suggest_multiple(
        self,
        conversation: list[dict],
        contact_name: str = "",
        count: int = 3,
        handle_id: str = "",
        last_msg_timestamp: float = 0.0,
        last_msg_text: str = "",
    ) -> list[str]:
        """Generate multiple reply options with varying temperature."""
        temperatures = [0.7, 0.9, 1.1]
        results: list[str] = []
        for i in range(count):
            temp = temperatures[i] if i < len(temperatures) else 0.9
            reply = self.suggest_reply(
                conversation,
                contact_name,
                temperature=temp,
                handle_id=handle_id,
                last_msg_timestamp=last_msg_timestamp,
                last_msg_text=last_msg_text,
            )
            results.append(reply)
        return results
