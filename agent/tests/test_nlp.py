"""Tests for NLP style analyzer and persuasion modules."""
import pytest

from clapcheeks.nlp.style_analyzer import StyleProfile, analyze_messages
from clapcheeks.nlp.persuasion import (
    ConversationStage,
    PersuasionContext,
    detect_stage,
    get_persuasion_instructions,
)


# ---------------------------------------------------------------------------
# StyleProfile defaults
# ---------------------------------------------------------------------------

class TestStyleProfileDefaults:
    def test_avg_words_default(self):
        p = StyleProfile()
        assert p.avg_words == 12.0

    def test_uses_lowercase_only_default(self):
        p = StyleProfile()
        assert p.uses_lowercase_only is False

    def test_emoji_frequency_default(self):
        p = StyleProfile()
        assert p.emoji_frequency == 0.0

    def test_common_emojis_default_is_empty_list(self):
        p = StyleProfile()
        assert p.common_emojis == []

    def test_energy_level_default(self):
        p = StyleProfile()
        assert p.energy_level == "medium"


# ---------------------------------------------------------------------------
# analyze_messages
# ---------------------------------------------------------------------------

class TestAnalyzeMessages:
    def test_all_lowercase_messages(self):
        msgs = [
            {"role": "user", "content": "hey how are you"},
            {"role": "user", "content": "im doing great thanks"},
            {"role": "user", "content": "yeah lets hang out sometime"},
        ]
        profile = analyze_messages(msgs)
        assert profile.uses_lowercase_only is True

    def test_emoji_heavy_messages(self):
        msgs = [
            {"role": "user", "content": "omg hiii \U0001F60D\U0001F60D\U0001F60D"},
            {"role": "user", "content": "thats so cute \U0001F970\U0001F525"},
            {"role": "user", "content": "yesss \U0001F389\U0001F389"},
        ]
        profile = analyze_messages(msgs)
        assert profile.emoji_frequency > 0

    def test_short_messages(self):
        msgs = [
            {"role": "user", "content": "hey"},
            {"role": "user", "content": "yea"},
            {"role": "user", "content": "cool"},
            {"role": "user", "content": "ok lol"},
            {"role": "user", "content": "sure"},
        ]
        profile = analyze_messages(msgs)
        assert profile.uses_short_replies is True

    def test_empty_messages_returns_default_profile(self):
        profile = analyze_messages([])
        assert profile.avg_words == 12.0  # default

    def test_filters_by_role(self):
        msgs = [
            {"role": "assistant", "content": "Hello there! How are you doing today?"},
            {"role": "user", "content": "hi"},
        ]
        profile = analyze_messages(msgs, role="user")
        assert profile.uses_short_replies is True


# ---------------------------------------------------------------------------
# to_prompt_description
# ---------------------------------------------------------------------------

class TestToPromptDescription:
    def test_returns_nonempty_string(self):
        p = StyleProfile()
        desc = p.to_prompt_description()
        assert isinstance(desc, str)
        assert len(desc) > 0

    def test_short_replies_mentioned(self):
        p = StyleProfile(uses_short_replies=True)
        desc = p.to_prompt_description()
        assert "short" in desc.lower()

    def test_lowercase_mentioned(self):
        p = StyleProfile(uses_lowercase_only=True)
        desc = p.to_prompt_description()
        assert "lowercase" in desc.lower()


# ---------------------------------------------------------------------------
# detect_stage
# ---------------------------------------------------------------------------

class TestDetectStage:
    def test_no_messages_returns_opener(self):
        assert detect_stage([]) == ConversationStage.OPENER

    def test_one_message_returns_opener(self):
        msgs = [{"role": "user", "content": "hey"}]
        assert detect_stage(msgs) == ConversationStage.OPENER

    def test_two_messages_returns_building(self):
        msgs = [
            {"role": "user", "content": "hey"},
            {"role": "assistant", "content": "hi there"},
        ]
        assert detect_stage(msgs) == ConversationStage.BUILDING

    def test_eight_messages_with_meet_keyword(self):
        msgs = [
            {"role": "user", "content": "hey"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "whats up"},
            {"role": "assistant", "content": "not much"},
            {"role": "user", "content": "cool"},
            {"role": "assistant", "content": "yeah"},
            {"role": "user", "content": "we should meet for coffee"},
            {"role": "assistant", "content": "that sounds great"},
        ]
        stage = detect_stage(msgs)
        # 8 messages -> DATE_PUSH (count >= 8)
        assert stage in (ConversationStage.DATE_PUSH, ConversationStage.BOOKED)

    def test_confirmed_date_returns_booked(self):
        msgs = [
            {"role": "user", "content": "see you tomorrow at 7!"},
        ]
        assert detect_stage(msgs) == ConversationStage.BOOKED


# ---------------------------------------------------------------------------
# get_persuasion_instructions
# ---------------------------------------------------------------------------

class TestGetPersuasionInstructions:
    @pytest.mark.parametrize("stage", list(ConversationStage))
    def test_returns_string_for_each_stage(self, stage):
        ctx = PersuasionContext(
            stage=stage,
            match_energy="medium",
            match_formality=0.3,
        )
        result = get_persuasion_instructions(ctx)
        assert isinstance(result, str)
        assert len(result) > 0
