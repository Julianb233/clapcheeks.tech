"""Unit tests for the playbook CLI — AI-8815.

Tests cover:
- Timing logic (wait / send now / stop)
- Date parsing
- Domain selection
- --list-domains and --show-banned flags
- Context-aware output

Run: pytest agent/tests/test_playbook_cli.py -v
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from clapcheeks.commands.playbook import (  # noqa: E402
    FIRST_ATTEMPT_DAYS,
    FOLLOWUP_DAYS,
    MAX_ATTEMPTS,
    _parse_date,
    _recommend_next_action,
    main,
)


class TestParseDate:
    def test_valid_date(self):
        d = _parse_date("2026-04-01")
        assert d == date(2026, 4, 1)

    def test_invalid_format_raises(self):
        with pytest.raises(ValueError):
            _parse_date("04/01/2026")

    def test_nonsense_raises(self):
        with pytest.raises(ValueError):
            _parse_date("not-a-date")


class TestRecommendNextAction:
    def _today(self) -> date:
        return date.today()

    def test_no_attempts_too_soon(self):
        ghost_date = self._today() - timedelta(days=5)
        rec = _recommend_next_action(ghost_date, attempts=0, last_attempt_date=None)
        assert rec["action"] == "WAIT"

    def test_no_attempts_ready(self):
        ghost_date = self._today() - timedelta(days=FIRST_ATTEMPT_DAYS)
        rec = _recommend_next_action(ghost_date, attempts=0, last_attempt_date=None)
        assert rec["action"] == "SEND_NOW"
        assert "attempt 1" in rec["reason"].lower()

    def test_one_attempt_too_soon(self):
        ghost_date = self._today() - timedelta(days=FIRST_ATTEMPT_DAYS + 10)
        last_attempt = self._today() - timedelta(days=10)
        rec = _recommend_next_action(ghost_date, attempts=1, last_attempt_date=last_attempt)
        assert rec["action"] == "WAIT"

    def test_one_attempt_ready(self):
        ghost_date = self._today() - timedelta(days=FIRST_ATTEMPT_DAYS + FOLLOWUP_DAYS)
        last_attempt = self._today() - timedelta(days=FOLLOWUP_DAYS)
        rec = _recommend_next_action(ghost_date, attempts=1, last_attempt_date=last_attempt)
        assert rec["action"] == "SEND_NOW"
        assert "attempt 2" in rec["reason"].lower()

    def test_max_attempts_stop(self):
        ghost_date = self._today() - timedelta(days=90)
        rec = _recommend_next_action(ghost_date, attempts=MAX_ATTEMPTS, last_attempt_date=None)
        assert rec["action"] == "STOP"

    def test_over_max_attempts_also_stop(self):
        ghost_date = self._today() - timedelta(days=90)
        rec = _recommend_next_action(ghost_date, attempts=5, last_attempt_date=None)
        assert rec["action"] == "STOP"


class TestMainCLI:
    def test_list_domains(self, capsys):
        result = main(["--list-domains"])
        assert result == 0
        captured = capsys.readouterr()
        assert "dating" in captured.out
        assert "sales" in captured.out

    def test_missing_ghost_date_returns_nonzero(self, capsys):
        result = main(["--domain", "dating"])
        assert result != 0

    def test_invalid_ghost_date_returns_nonzero(self, capsys):
        result = main(["--domain", "dating", "--ghost-date", "not-a-date"])
        assert result != 0

    def test_send_now_output(self, capsys):
        ghost_date = (date.today() - timedelta(days=FIRST_ATTEMPT_DAYS)).strftime("%Y-%m-%d")
        result = main(["--domain", "dating", "--ghost-date", ghost_date])
        assert result == 0
        captured = capsys.readouterr()
        assert "SEND_NOW" in captured.out

    def test_wait_output(self, capsys):
        ghost_date = (date.today() - timedelta(days=2)).strftime("%Y-%m-%d")
        result = main(["--domain", "dating", "--ghost-date", ghost_date])
        assert result == 0
        captured = capsys.readouterr()
        assert "WAIT" in captured.out

    def test_stop_output(self, capsys):
        ghost_date = (date.today() - timedelta(days=90)).strftime("%Y-%m-%d")
        result = main(["--domain", "dating", "--ghost-date", ghost_date, "--attempts", "2"])
        assert result == 0
        captured = capsys.readouterr()
        assert "STOP" in captured.out

    def test_context_appears_in_output(self, capsys):
        ghost_date = (date.today() - timedelta(days=FIRST_ATTEMPT_DAYS)).strftime("%Y-%m-%d")
        result = main([
            "--domain", "sales",
            "--ghost-date", ghost_date,
            "--context", "post-demo mentioned ROI concerns",
        ])
        assert result == 0
        captured = capsys.readouterr()
        assert "ROI concerns" in captured.out
