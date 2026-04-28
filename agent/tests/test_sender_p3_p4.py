"""Tests for sender.py P3 (chat.db pre-send recheck) + P4 (account-index routing).

AI-8737 / AI-8738.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest import mock

import pytest

from clapcheeks.imessage import sender
from clapcheeks.imessage.sender import (
    SendResult,
    _is_sms_handle,
    _recheck_no_double_text,
    send_imessage,
)


# ---------------------------------------------------------------------------
# Fixtures — synthetic chat.db
# ---------------------------------------------------------------------------

def _make_chat_db(path: Path, rows: list) -> None:
    """Build a minimal chat.db schema and seed it with (handle_id, is_from_me, date) rows."""
    conn = sqlite3.connect(str(path))
    conn.executescript(
        """
        CREATE TABLE handle (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT
        );
        CREATE TABLE message (
            ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
            handle_id INTEGER,
            is_from_me INTEGER,
            date INTEGER
        );
        """
    )
    handle_ids = {}
    for handle, _, _ in rows:
        if handle not in handle_ids:
            cur = conn.execute("INSERT INTO handle (id) VALUES (?)", (handle,))
            handle_ids[handle] = cur.lastrowid
    for handle, is_from_me, date in rows:
        conn.execute(
            "INSERT INTO message (handle_id, is_from_me, date) VALUES (?, ?, ?)",
            (handle_ids[handle], is_from_me, date),
        )
    conn.commit()
    conn.close()


@pytest.fixture
def temp_chat_db(tmp_path, monkeypatch):
    db_path = tmp_path / "chat.db"
    monkeypatch.setattr(sender, "IMESSAGE_DB_PATH", db_path)
    return db_path


# ---------------------------------------------------------------------------
# P3 — _recheck_no_double_text
# ---------------------------------------------------------------------------

class TestRecheckNoDoubleText:
    def test_last_from_me_returns_false(self, temp_chat_db):
        """Operator typed last (is_from_me=1) -> abort send."""
        _make_chat_db(temp_chat_db, [
            ("+15551234567", 0, 100),
            ("+15551234567", 1, 200),
        ])
        assert _recheck_no_double_text("+15551234567") is False

    def test_last_from_her_returns_true(self, temp_chat_db):
        """Her message is last (is_from_me=0) -> safe to send."""
        _make_chat_db(temp_chat_db, [
            ("+15551234567", 1, 100),
            ("+15551234567", 0, 200),
        ])
        assert _recheck_no_double_text("+15551234567") is True

    def test_empty_db_returns_true(self, temp_chat_db):
        """No rows -> safe to send."""
        _make_chat_db(temp_chat_db, [])
        assert _recheck_no_double_text("+15551234567") is True

    def test_missing_db_file_returns_true(self, tmp_path, monkeypatch):
        """Missing chat.db -> fail-open."""
        missing = tmp_path / "does-not-exist.db"
        monkeypatch.setattr(sender, "IMESSAGE_DB_PATH", missing)
        assert _recheck_no_double_text("+15551234567") is True

    def test_other_handle_unaffected(self, temp_chat_db):
        """is_from_me=1 on a DIFFERENT handle should not block ours."""
        _make_chat_db(temp_chat_db, [
            ("+15550000000", 1, 200),
            ("+15551234567", 0, 150),
        ])
        assert _recheck_no_double_text("+15551234567") is True

    def test_corrupt_db_fails_open(self, tmp_path, monkeypatch):
        """Unreadable chat.db -> log + return True (fail-open)."""
        bad = tmp_path / "chat.db"
        bad.write_bytes(b"this is not a sqlite database")
        monkeypatch.setattr(sender, "IMESSAGE_DB_PATH", bad)
        assert _recheck_no_double_text("+15551234567") is True


# ---------------------------------------------------------------------------
# P3 — integration: send_imessage abort path
# ---------------------------------------------------------------------------

class TestSendImessageDoubleTextAbort:
    def test_double_text_aborted_never_calls_subprocess(self, temp_chat_db, monkeypatch):
        """Operator just typed -> abort, never shell out."""
        _make_chat_db(temp_chat_db, [
            ("+15551234567", 0, 100),
            ("+15551234567", 1, 200),
        ])
        monkeypatch.setattr(sender, "_which_god", lambda: "/usr/local/bin/god")
        monkeypatch.setattr(sender, "_which_osascript", lambda: "/usr/bin/osascript")

        with mock.patch("clapcheeks.imessage.sender.subprocess.run") as run_spy:
            result = send_imessage("+15551234567", "hey what's up")

        assert result.ok is False
        assert result.channel == "noop"
        assert result.error == "double_text_aborted"
        run_spy.assert_not_called()

    def test_safe_to_send_does_call_subprocess(self, temp_chat_db, monkeypatch):
        """Her message is last -> send proceeds normally."""
        _make_chat_db(temp_chat_db, [
            ("+15551234567", 1, 100),
            ("+15551234567", 0, 200),
        ])
        monkeypatch.setattr(sender, "_which_god", lambda: "/usr/local/bin/god")

        completed = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch(
            "clapcheeks.imessage.sender.subprocess.run", return_value=completed,
        ) as run_spy:
            result = send_imessage("+15551234567", "hey what's up")

        assert result.ok is True
        assert result.channel == "god-mac"
        run_spy.assert_called_once()


# ---------------------------------------------------------------------------
# P4 — _is_sms_handle
# ---------------------------------------------------------------------------

class TestIsSmsHandle:
    def test_mexico_prefix_is_sms(self):
        assert _is_sms_handle("+5212345678901") is True

    def test_india_prefix_is_sms(self):
        assert _is_sms_handle("+919876543210") is True

    def test_us_prefix_is_not_sms(self):
        assert _is_sms_handle("+15551234567") is False

    def test_no_handles_file_us_not_sms(self, tmp_path, monkeypatch):
        monkeypatch.setattr(sender, "SMS_HANDLES_FILE", tmp_path / "does-not-exist.txt")
        assert _is_sms_handle("+15551234567") is False

    def test_handles_file_overrides(self, tmp_path, monkeypatch):
        handles_file = tmp_path / "sms-handles.txt"
        handles_file.write_text("+15551234567\n+15559999999\n\n")
        monkeypatch.setattr(sender, "SMS_HANDLES_FILE", handles_file)
        assert _is_sms_handle("+15551234567") is True
        assert _is_sms_handle("+15559999999") is True
        assert _is_sms_handle("+15550000000") is False

    def test_handles_file_strips_whitespace(self, tmp_path, monkeypatch):
        handles_file = tmp_path / "sms-handles.txt"
        handles_file.write_text("  +15551234567  \n   \n+15559999999\n")
        monkeypatch.setattr(sender, "SMS_HANDLES_FILE", handles_file)
        assert _is_sms_handle("+15551234567") is True
        assert _is_sms_handle("+15559999999") is True


# ---------------------------------------------------------------------------
# P4 — osascript account-index routing
# ---------------------------------------------------------------------------

class TestOsascriptAccountIndex:
    def _force_osascript_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(sender, "_which_god", lambda: None)
        monkeypatch.setattr(sender, "_which_osascript", lambda: "/usr/bin/osascript")
        monkeypatch.setattr(sender, "IMESSAGE_DB_PATH", tmp_path / "no-db.db")
        monkeypatch.setattr(sender, "IMESSAGE_ACCOUNT_INDEX", 5)
        monkeypatch.setattr(sender, "SMS_ACCOUNT_INDEX", 2)
        monkeypatch.setattr(sender, "SMS_HANDLES_FILE", tmp_path / "empty-handles.txt")

    def test_imessage_handle_uses_index_5(self, monkeypatch, tmp_path):
        self._force_osascript_path(monkeypatch, tmp_path)
        completed = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch(
            "clapcheeks.imessage.sender.subprocess.run", return_value=completed,
        ) as run_spy:
            result = send_imessage("+15551234567", "hi there")

        assert result.ok is True
        assert result.channel == "osascript"
        run_spy.assert_called_once()
        cmd = run_spy.call_args.args[0]
        assert cmd[0] == "/usr/bin/osascript"
        assert cmd[1] == "-e"
        script = cmd[2]
        assert "of account 5" in script
        assert 'participant "+15551234567"' in script
        assert '"hi there"' in script

    def test_sms_prefix_handle_uses_index_2(self, monkeypatch, tmp_path):
        self._force_osascript_path(monkeypatch, tmp_path)
        # to_e164_us only handles US — patch within sender to no-op for non-US.
        monkeypatch.setattr(sender, "to_e164_us", lambda p: p)
        completed = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch(
            "clapcheeks.imessage.sender.subprocess.run", return_value=completed,
        ) as run_spy:
            result = send_imessage("+5212345678901", "hola")

        assert result.ok is True
        run_spy.assert_called_once()
        script = run_spy.call_args.args[0][2]
        assert "of account 2" in script
        assert 'participant "+5212345678901"' in script

    def test_handles_file_overrides_to_sms(self, monkeypatch, tmp_path):
        """US number in sms-handles.txt routes via SMS account."""
        self._force_osascript_path(monkeypatch, tmp_path)
        handles_file = tmp_path / "sms-handles.txt"
        handles_file.write_text("+15551234567\n")
        monkeypatch.setattr(sender, "SMS_HANDLES_FILE", handles_file)

        completed = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch(
            "clapcheeks.imessage.sender.subprocess.run", return_value=completed,
        ) as run_spy:
            result = send_imessage("+15551234567", "hi")

        assert result.ok is True
        script = run_spy.call_args.args[0][2]
        assert "of account 2" in script
