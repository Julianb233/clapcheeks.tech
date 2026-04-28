"""Tests for P2 anti-LLM-voice guards, P6 memo injection, and P7 staleness recovery.

All Ollama calls are mocked - no network or local model required.
"""
from __future__ import annotations

import sys
import time
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Stub the optional `ollama` dependency so the import in suggest_reply()
# succeeds without requiring the real package to be installed.
# ---------------------------------------------------------------------------
if "ollama" not in sys.modules:
    sys.modules["ollama"] = types.SimpleNamespace(chat=lambda **_: {})

from clapcheeks.imessage import ai_reply  # noqa: E402
from clapcheeks.imessage.ai_reply import (  # noqa: E402
    ReplyGenerator,
    _clean_output,
    _load_memo,
)


# ---------------------------------------------------------------------------
# _clean_output guards (P2)
# ---------------------------------------------------------------------------

class TestCleanOutputGuards:
    def test_keeps_clean_text(self):
        assert _clean_output("haha that's fun, what kind of dog?", []) != ""

    def test_meta_leak_blocked(self):
        text = "Based on her profile she likes dogs. Reply: that's fun"
        assert _clean_output(text, []) == ""

    def test_meta_leak_let_me_draft(self):
        assert _clean_output("Let me draft something flirty", []) == ""

    def test_safety_block_absolutely(self):
        assert _clean_output("absolutely, that sounds amazing", []) == ""

    def test_safety_block_certainly(self):
        assert _clean_output("certainly! lets explore that idea", []) == ""

    def test_money_jk_blocked_venmo(self):
        assert _clean_output("send me your venmo lol", []) == ""

    def test_money_jk_blocked_fly_out(self):
        assert _clean_output("i could fly out to see you", []) == ""

    def test_money_jk_blocked_just_kidding(self):
        assert _clean_output("send $50 just kidding", []) == ""

    def test_slang_blocked_no_cap(self):
        assert _clean_output("no cap that was fire", []) == ""

    def test_slang_blocked_aight(self):
        assert _clean_output("aight bet, tomorrow then", []) == ""

    def test_em_dash_stripped(self):
        out = _clean_output("hey - what's up", [])
        # Use the actual em-dash via codepoint
        em = "—"
        out2 = _clean_output(f"hey {em} what's up", [])
        assert em not in out2
        assert "," in out2

    def test_en_dash_stripped(self):
        en = "–"
        out = _clean_output(f"yeah {en} sounds good", [])
        assert en not in out

    def test_length_cap_too_long(self):
        long_text = "ok " * 100  # 300 chars
        assert _clean_output(long_text, []) == ""

    def test_length_cap_too_short(self):
        assert _clean_output("a", []) == ""

    def test_length_cap_empty(self):
        assert _clean_output("", []) == ""

    def test_fake_phone_blocked(self):
        assert _clean_output("call me at 555-123-4567", []) == ""

    def test_my_phone_allowed(self, monkeypatch):
        monkeypatch.setenv("MY_PHONE_DIGITS", "5551234567")
        out = _clean_output("here is my cell 555-123-4567", [])
        assert out != ""

    def test_word_overlap_blocked(self):
        prior = ["pizza tonight at 8 sounds perfect honestly"]
        # response shares basically every content word with prior
        response = "pizza tonight at 8 sounds perfect honestly to me"
        assert _clean_output(response, prior) == ""

    def test_low_overlap_allowed(self):
        prior = ["pizza tonight"]
        response = "haha sure i'm in for that"
        assert _clean_output(response, prior) != ""

    def test_question_repetition_blocked(self):
        prior = ["what kind of dog do you have"]
        response = "what kind of dog?"
        assert _clean_output(response, prior) == ""

    def test_last_paragraph_kept(self):
        text = "I should respond casually.\n\nhaha yeah for sure"
        out = _clean_output(text, [])
        assert out == "haha yeah for sure"

    def test_none_input_returns_empty(self):
        assert _clean_output(None, []) == ""


# ---------------------------------------------------------------------------
# _load_memo (P6 read side)
# ---------------------------------------------------------------------------

class TestLoadMemo:
    def test_returns_memo_contents(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        memo_dir = tmp_path / ".clapcheeks" / "memos"
        memo_dir.mkdir(parents=True)
        (memo_dir / "+15551234567.md").write_text(
            "Likes: yoga, pho.\nAvoid: politics."
        )
        out = _load_memo("+15551234567")
        assert "yoga" in out
        assert "politics" in out

    def test_returns_empty_when_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        assert _load_memo("+19998887777") == ""

    def test_returns_empty_for_blank_handle(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        assert _load_memo("") == ""

    def test_strips_whitespace(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        memo_dir = tmp_path / ".clapcheeks" / "memos"
        memo_dir.mkdir(parents=True)
        (memo_dir / "alice@example.com.md").write_text("\n\n  hello  \n\n")
        assert _load_memo("alice@example.com") == "hello"

    def test_handles_slash_in_id(self, tmp_path, monkeypatch):
        """Slashes in handle_id are sanitized to '_' so we never escape memos/."""
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        memo_dir = tmp_path / ".clapcheeks" / "memos"
        memo_dir.mkdir(parents=True)
        (memo_dir / "evil_path.md").write_text("safe")
        assert _load_memo("evil/path") == "safe"


# ---------------------------------------------------------------------------
# suggest_reply with mocked ollama - wires guards + memo + staleness together
# ---------------------------------------------------------------------------

def _mk_ollama_response(text: str):
    return {"message": {"content": text}}


class TestSuggestReplyIntegration:
    def test_guards_remove_bad_llm_output(self):
        gen = ReplyGenerator(model="dummy", style_prompt="be casual")
        with patch.object(
            ai_reply,
            "ollama",
            MagicMock(chat=MagicMock(return_value=_mk_ollama_response(
                "Based on her profile, she seems fun"
            ))),
            create=True,
        ):
            out = gen.suggest_reply(
                conversation=[{"text": "hey", "is_from_me": False}],
                contact_name="Alex",
            )
        assert out == ""

    def test_clean_output_passes_through(self):
        gen = ReplyGenerator(model="dummy", style_prompt="be casual")
        with patch.object(
            ai_reply,
            "ollama",
            MagicMock(chat=MagicMock(return_value=_mk_ollama_response(
                "haha yeah, what're you up to later?"
            ))),
            create=True,
        ):
            out = gen.suggest_reply(
                conversation=[{"text": "hey", "is_from_me": False}],
                contact_name="Alex",
            )
        assert out.startswith("haha")

    def test_memo_injected_into_system_prompt(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
        memo_dir = tmp_path / ".clapcheeks" / "memos"
        memo_dir.mkdir(parents=True)
        (memo_dir / "+15551234567.md").write_text("She has a corgi named Pickle.")

        captured = {}

        def fake_chat(**kwargs):
            captured["messages"] = kwargs["messages"]
            return _mk_ollama_response("nice")

        gen = ReplyGenerator(model="dummy", style_prompt="be casual")
        with patch.object(
            ai_reply,
            "ollama",
            MagicMock(chat=fake_chat),
            create=True,
        ):
            gen.suggest_reply(
                conversation=[{"text": "yo", "is_from_me": False}],
                contact_name="Alex",
                handle_id="+15551234567",
            )

        sys_msg = captured["messages"][0]
        assert sys_msg["role"] == "system"
        assert "PERSISTENT MEMO" in sys_msg["content"]
        assert "Pickle" in sys_msg["content"]

    def test_p7_staleness_prompt_appended(self):
        captured = {}

        def fake_chat(**kwargs):
            captured["messages"] = kwargs["messages"]
            return _mk_ollama_response("hey sorry, this week instead?")

        gen = ReplyGenerator(model="dummy", style_prompt="be casual")
        # Her message was 6h ago and mentioned 'tonight'
        old_ts = time.time() - (6 * 3600)
        with patch.object(
            ai_reply,
            "ollama",
            MagicMock(chat=fake_chat),
            create=True,
        ):
            gen.suggest_reply(
                conversation=[{"text": "wanna grab drinks tonight?", "is_from_me": False}],
                contact_name="Alex",
                last_msg_timestamp=old_ts,
                last_msg_text="wanna grab drinks tonight?",
            )

        assert "NOTE" in captured["messages"][0]["content"]
        assert "late reply" in captured["messages"][0]["content"]

    def test_p7_no_staleness_if_recent(self):
        captured = {}

        def fake_chat(**kwargs):
            captured["messages"] = kwargs["messages"]
            return _mk_ollama_response("yeah sounds great")

        gen = ReplyGenerator(model="dummy", style_prompt="be casual")
        with patch.object(
            ai_reply,
            "ollama",
            MagicMock(chat=fake_chat),
            create=True,
        ):
            gen.suggest_reply(
                conversation=[{"text": "tonight?", "is_from_me": False}],
                contact_name="Alex",
                last_msg_timestamp=time.time() - 60,  # 1 minute ago
                last_msg_text="tonight?",
            )
        assert "NOTE" not in captured["messages"][0]["content"]

    def test_p7_no_staleness_if_no_time_words(self):
        captured = {}

        def fake_chat(**kwargs):
            captured["messages"] = kwargs["messages"]
            return _mk_ollama_response("yeah totally")

        gen = ReplyGenerator(model="dummy", style_prompt="be casual")
        with patch.object(
            ai_reply,
            "ollama",
            MagicMock(chat=fake_chat),
            create=True,
        ):
            gen.suggest_reply(
                conversation=[{"text": "how was your weekend", "is_from_me": False}],
                contact_name="Alex",
                last_msg_timestamp=time.time() - (6 * 3600),
                last_msg_text="how was your weekend",
            )
        assert "NOTE" not in captured["messages"][0]["content"]

    def test_suggest_multiple_returns_count(self):
        gen = ReplyGenerator(model="dummy", style_prompt="be casual")
        with patch.object(
            ai_reply,
            "ollama",
            MagicMock(chat=MagicMock(return_value=_mk_ollama_response("haha yeah"))),
            create=True,
        ):
            out = gen.suggest_multiple(
                conversation=[{"text": "hi", "is_from_me": False}],
                contact_name="Alex",
                count=3,
            )
        assert len(out) == 3
        assert all(o.startswith("haha") for o in out)
