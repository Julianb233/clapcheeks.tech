"""Phase E - drafter pipeline tests.

Covers:
- Sanitizer: all banned Unicode glyphs to ASCII replacements
- Validator: rejects banned_words, corny closers, semicolons, em-dashes, over-length
- Splitter: multi-thought drafts return as arrays of 2-3 short messages
- Drafter: full run_pipeline flow with fake LLM outputs
- 20 sample drafts across match profiles - zero em-dashes, 0 banned content,
  each references HER specifically (name / prompt / interest / photo tag)

Run: pytest agent/tests/test_drafter_pipeline.py -v

PHASE-E - AI-8319
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from clapcheeks.ai.sanitizer import (  # noqa: E402
    BANNED_CHARS,
    sanitize_draft,
    sanitize_and_validate,
    validate_draft,
)
from clapcheeks.ai.splitter import (  # noqa: E402
    should_split,
    split_draft_into_messages,
)
from clapcheeks.ai import drafter as drafter_mod  # noqa: E402


# ---------------------------------------------------------------------------
# Shared persona fixture - mirrors what Supabase persona field stores
# ---------------------------------------------------------------------------

@pytest.fixture
def persona() -> dict:
    return {
        "voice_style": "smooth, confident, playful, lowercase-first",
        "signature_phrases": ["not bad", "what's your go-to", "down to"],
        "banned_words": [
            "delve", "tapestry", "navigate", "journey", "embark",
            "let me know your thoughts",
            "I hope this message finds you well",
            "furthermore", "moreover", "leverage", "synergy",
        ],
        "attraction_hooks": [
            "runs own agency",
            "half-marathon runner",
            "cooks a mean risotto",
        ],
        "flex_rules": {
            "surface_one_at_a_time": True,
            "warmest_first": True,
            "never_list_more_than_one": True,
        },
        "message_formatting_rules": {
            "length": {"ideal_max_chars": 80, "hard_max_chars": 160},
            "emoji_policy": {"max_emojis": 1, "early_convo_emojis": 0},
            "banned_punctuation": [
                "\u2014", "\u2013", ";", "\u2026",
                "\u201c", "\u201d", "\u2018", "\u2019",
            ],
        },
    }


# ---------------------------------------------------------------------------
# 1. Sanitizer - Unicode to ASCII
# ---------------------------------------------------------------------------

class TestSanitizer:
    def test_em_dash_replaced(self):
        assert sanitize_draft("hey \u2014 what's up") == "hey - what's up"

    def test_en_dash_replaced(self):
        assert sanitize_draft("mon\u2013fri") == "mon-fri"

    def test_ellipsis_replaced(self):
        assert sanitize_draft("hmm\u2026 not sure") == "hmm... not sure"

    def test_curly_double_quotes_replaced(self):
        assert sanitize_draft("\u201chey\u201d") == '"hey"'

    def test_curly_single_quotes_replaced(self):
        assert sanitize_draft("that\u2019s cool") == "that's cool"

    def test_non_breaking_space_replaced(self):
        assert sanitize_draft("hey\u00a0there") == "hey there"

    def test_bullet_replaced(self):
        assert sanitize_draft("one \u2022 two") == "one * two"

    def test_arrow_replaced(self):
        assert sanitize_draft("plan A \u2192 plan B") == "plan A -> plan B"

    def test_all_banned_chars_covered(self):
        for bad in BANNED_CHARS.keys():
            text = f"before{bad}after"
            cleaned = sanitize_draft(text)
            assert bad not in cleaned, f"sanitize_draft left {bad!r} behind"

    def test_multiple_dashes_collapsed(self):
        assert sanitize_draft("hey\u2014\u2014\u2014there") == "hey-there"


# ---------------------------------------------------------------------------
# 2. Validator
# ---------------------------------------------------------------------------

class TestValidator:
    def test_empty_rejected(self, persona):
        ok, errs = validate_draft("", persona)
        assert not ok
        assert "empty draft" in " ".join(errs)

    def test_em_dash_rejected_if_not_sanitized(self, persona):
        ok, errs = validate_draft("hey \u2014 wild", persona)
        assert not ok
        assert any("banned unicode" in e for e in errs)

    def test_semicolon_rejected(self, persona):
        ok, errs = validate_draft("hey; what's up", persona)
        assert not ok
        assert any("banned punctuation" in e for e in errs)

    def test_banned_word_rejected(self, persona):
        ok, errs = validate_draft("let's delve into your profile", persona)
        assert not ok
        assert any("banned_words" in e for e in errs)

    def test_corny_closer_rejected(self, persona):
        ok, errs = validate_draft(
            "really enjoyed chatting. looking forward to hearing from you",
            persona,
        )
        assert not ok
        assert any("corny closer" in e for e in errs)

    def test_corny_emoticon_rejected(self, persona):
        ok, errs = validate_draft("you're cute :)", persona)
        assert not ok
        assert any("corny emoticon" in e for e in errs)

    def test_over_hard_max(self, persona):
        long_text = "a" * 200
        ok, errs = validate_draft(long_text, persona)
        assert not ok
        assert any("over hard_max_chars" in e for e in errs)

    def test_early_convo_emoji_rejected(self, persona):
        ok, errs = validate_draft("hey you're cute \U0001F60A", persona, conversation_stage="early")
        assert not ok
        assert any("too many emojis" in e for e in errs)

    def test_clean_draft_passes(self, persona):
        ok, errs = validate_draft("hey saw your hiking pic, where was that", persona)
        assert ok, f"clean draft rejected: {errs}"


# ---------------------------------------------------------------------------
# 3. Splitter
# ---------------------------------------------------------------------------

class TestSplitter:
    def test_short_text_single_message(self):
        msgs = split_draft_into_messages("hey what's up")
        assert msgs == ["hey what's up"]

    def test_two_sentences_split(self):
        text = "hey saw your hiking pic. where was that taken?"
        msgs = split_draft_into_messages(text, ideal_max_chars=35)
        assert len(msgs) == 2

    def test_three_thoughts_max_three(self):
        text = (
            "hey saw your pic. that book on your shelf is great. "
            "also what's your go-to karaoke song. also i'm down to grab coffee."
        )
        msgs = split_draft_into_messages(text, ideal_max_chars=40)
        assert len(msgs) <= 3

    def test_preserves_lowercase(self):
        text = "hey saw your pic. that book is great"
        msgs = split_draft_into_messages(text, ideal_max_chars=20)
        assert all(not m[0].isupper() or not m[0].isalpha() for m in msgs)

    def test_hard_cap_truncates(self):
        long = "a " * 200
        msgs = split_draft_into_messages(long, hard_max_chars=160)
        for m in msgs:
            assert len(m) <= 160

    def test_should_split_detects_multi_thought(self):
        assert should_split(
            "hey saw your pic. what's that place",
            persona={"message_formatting_rules": {"length": {"ideal_max_chars": 30}}},
        )

    def test_should_not_split_short(self):
        assert not should_split(
            "hey",
            persona={"message_formatting_rules": {"length": {"ideal_max_chars": 80}}},
        )


# ---------------------------------------------------------------------------
# 4. Drafter - full run_pipeline
# ---------------------------------------------------------------------------

class TestDrafterPipeline:
    def test_clean_draft_round_trips(self, persona):
        raw = "hey saw your book shelf. what's your favorite"
        result = drafter_mod.run_pipeline(raw, persona=persona)
        assert result.ok
        assert len(result.messages) >= 1
        for m in result.messages:
            assert "\u2014" not in m
            assert ";" not in m

    def test_em_dash_gets_sanitized_and_passes(self, persona):
        raw = "hey saw your hiking pic \u2014 where was that"
        result = drafter_mod.run_pipeline(raw, persona=persona)
        assert result.ok, f"errors: {result.errors}"
        for m in result.messages:
            assert "\u2014" not in m

    def test_banned_word_discards_draft(self, persona):
        discards: list = []
        raw = "let me delve into your profile, sounds great"
        result = drafter_mod.run_pipeline(
            raw,
            persona=persona,
            on_discard=lambda t, e: discards.append((t, e)),
        )
        assert not result.ok
        assert discards, "on_discard should fire when banned_word present"

    def test_multi_thought_returns_array(self, persona):
        raw = (
            "hey saw your hiking pic. where was that. also what book "
            "you reading right now"
        )
        result = drafter_mod.run_pipeline(raw, persona=persona)
        assert result.ok
        assert len(result.messages) >= 2, (
            f"expected multi-thought to split, got {result.messages}"
        )

    def test_inject_persona_into_system_prompt(self, persona):
        base = "You are a drafting assistant."
        out = drafter_mod.inject_persona_into_system_prompt(base, persona=persona)
        assert "VOICE + DRAFTING RULES" in out
        assert "smooth, confident" in out
        assert "NEVER use these words" in out
        assert base in out

    def test_persona_prompt_includes_formatting_rules_json(self, persona):
        base = "You are a drafter."
        out = drafter_mod.inject_persona_into_system_prompt(base, persona=persona)
        assert "hard_max_chars" in out
        assert "ideal_max_chars" in out


# ---------------------------------------------------------------------------
# 5. 20 sample drafts - end-to-end voice compliance
# ---------------------------------------------------------------------------

SAMPLE_DRAFTS: list[dict] = [
    {"name": "Emma", "her_detail": "hiking", "raw": "hey saw your hiking pic, where was that taken"},
    {"name": "Sophie", "her_detail": "bookshelf", "raw": "ok but seriously what's on your bookshelf, saw some good ones"},
    {"name": "Maya", "her_detail": "karaoke", "raw": "you mentioned karaoke. whats your go-to song"},
    {"name": "Chloe", "her_detail": "dog", "raw": "your dog is cuter than you, which is saying a lot"},
    {"name": "Ava", "her_detail": "pasta prompt", "raw": "pasta for the rest of my life too, honestly"},
    {"name": "Isabella", "her_detail": "yoga", "raw": "ok yoga person, best spot in the city for a class"},
    {"name": "Olivia", "her_detail": "surfing", "raw": "surfing huh. how many boards are we talking"},
    {"name": "Zoe", "her_detail": "travel photo", "raw": "that photo is sending me, where were you traveling"},
    {"name": "Mia", "her_detail": "guitar", "raw": "you play guitar. what song do you always come back to"},
    {"name": "Ella", "her_detail": "coffee prompt", "raw": "what's your coffee order because this feels important"},
    {"name": "Grace", "her_detail": "marathon", "raw": "running a marathon for fun. i'm exhausted just reading that"},
    {"name": "Lily", "her_detail": "ramen", "raw": "ramen enthusiast detected. best spot in town go"},
    {"name": "Amelia", "her_detail": "piano", "raw": "piano player. classical or do you go rogue"},
    {"name": "Harper", "her_detail": "rooftop", "raw": "that rooftop pic though. where was that"},
    {"name": "Charlotte", "her_detail": "puzzles", "raw": "puzzles are underrated. how many pieces are we talking"},
    {"name": "Ruby", "her_detail": "sushi", "raw": "sushi rec please, you look like you know the spots"},
    {"name": "Nora", "her_detail": "pottery", "raw": "pottery is so underrated. what are you making right now"},
    {"name": "Violet", "her_detail": "tennis", "raw": "ok but are we playing tennis or just pretending"},
    {"name": "Hazel", "her_detail": "skiing", "raw": "skiing fan. tahoe or mammoth"},
    {"name": "Stella", "her_detail": "baking prompt", "raw": "baking is dangerous. what's your specialty"},
]


class TestTwentySampleDrafts:
    @pytest.mark.parametrize("sample", SAMPLE_DRAFTS, ids=[s["name"] for s in SAMPLE_DRAFTS])
    def test_sample_passes_pipeline(self, sample, persona):
        result = drafter_mod.run_pipeline(sample["raw"], persona=persona)
        assert result.ok, f"{sample['name']}: errors={result.errors}"

        joined = " ".join(result.messages)
        for bad in ["\u2014", "\u2013", ";", "\u2026", "\u201c", "\u201d", "\u2018", "\u2019"]:
            assert bad not in joined, (
                f"{sample['name']}: banned glyph {bad!r} present in {joined!r}"
            )

        low = joined.lower()
        her_detail_tokens = sample["her_detail"].lower().split()
        name_in = sample["name"].lower() in low
        detail_in = any(tok in low for tok in her_detail_tokens)
        assert name_in or detail_in, (
            f"{sample['name']}: draft doesn't reference name or profile "
            f"detail {sample['her_detail']!r}: {joined!r}"
        )

    def test_all_twenty_have_zero_em_dashes(self, persona):
        em_dash_count = 0
        for sample in SAMPLE_DRAFTS:
            result = drafter_mod.run_pipeline(sample["raw"], persona=persona)
            for m in result.messages:
                em_dash_count += m.count("\u2014")
        assert em_dash_count == 0

    def test_multi_thought_sample_becomes_array(self, persona):
        multi = (
            "hey saw your hiking pic. where was that. also what's on your "
            "bookshelf, saw some good ones"
        )
        result = drafter_mod.run_pipeline(multi, persona=persona)
        assert result.ok
        assert len(result.messages) >= 2


# ---------------------------------------------------------------------------
# 6. Sanitizer + Validator composite
# ---------------------------------------------------------------------------

class TestSanitizeAndValidate:
    def test_sanitize_fixes_and_validates(self, persona):
        raw = "hey \u2014 saw your pic \u2026"
        ok, cleaned, errs = sanitize_and_validate(raw, persona)
        assert ok, f"errors: {errs}"
        assert "\u2014" not in cleaned
        assert "\u2026" not in cleaned

    def test_banned_word_still_fails_after_sanitize(self, persona):
        raw = "let's \u2014 delve \u2014 into your profile"
        ok, cleaned, errs = sanitize_and_validate(raw, persona)
        assert not ok
        assert "\u2014" not in cleaned
        assert any("banned_words" in e for e in errs)
