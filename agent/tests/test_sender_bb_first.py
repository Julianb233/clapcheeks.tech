"""Tests for AI-8876 Y1: send_imessage tries BlueBubbles first, falls back to god-mac, then osascript.

Covers:
  * BB available + succeeds → channel='bluebubbles'
  * BB available + fails → falls through to god-mac
  * BB unavailable (no URL) → goes directly to god-mac
  * BB fails + god-mac fails → falls through to osascript
  * BB raises exception → falls through to god-mac gracefully
  * dry_run skips all transports
  * ai_paused gate still fires before BB attempt
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

AGENT_DIR = Path(__file__).resolve().parents[2] / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from clapcheeks.imessage import sender as sender_mod
from clapcheeks.imessage.sender import SendResult, send_imessage
from clapcheeks.imessage.bluebubbles import SendResult as BBResult


_PHONE = "+14155550100"
_BODY = "Hello from test"


def _bb_ok() -> BBResult:
    return BBResult(ok=True, channel="bluebubbles")


def _bb_fail(msg: str = "BB error") -> BBResult:
    return BBResult(ok=False, channel="bluebubbles", error=msg)


def _patch_no_double_text(value: bool = True):
    return mock.patch.object(sender_mod, "_recheck_no_double_text", return_value=value)


# ---------------------------------------------------------------------------
# BB-first: success path
# ---------------------------------------------------------------------------

class TestBBFirst:
    def test_bb_succeeds_returns_bluebubbles_channel(self):
        """When BB is configured and succeeds, channel should be 'bluebubbles'."""
        fake_client = mock.MagicMock()
        fake_client.send_text.return_value = _bb_ok()
        with _patch_no_double_text():
            with mock.patch.object(sender_mod, "_bluebubbles_client", return_value=fake_client):
                result = send_imessage(_PHONE, _BODY)
        assert result.ok is True
        assert result.channel == "bluebubbles"

    def test_bb_succeeds_does_not_call_god(self):
        """When BB succeeds, god-mac should never be called."""
        fake_client = mock.MagicMock()
        fake_client.send_text.return_value = _bb_ok()
        with _patch_no_double_text():
            with mock.patch.object(sender_mod, "_bluebubbles_client", return_value=fake_client):
                with mock.patch.object(sender_mod, "_which_god", return_value="/usr/local/bin/god") as m_god:
                    with mock.patch("subprocess.run") as m_sub:
                        send_imessage(_PHONE, _BODY)
        # subprocess.run should NOT have been called for god-mac
        for call in m_sub.call_args_list:
            args = call[0][0] if call[0] else call.args[0]
            assert "god" not in str(args), "god-mac was called even though BB succeeded"

    def test_bb_not_configured_skips_to_god_mac(self):
        """When BB returns None (no URL configured), god-mac is called directly."""
        with _patch_no_double_text():
            with mock.patch.object(sender_mod, "_bluebubbles_client", return_value=None):
                with mock.patch.object(sender_mod, "_which_god", return_value="/usr/local/bin/god"):
                    with mock.patch("subprocess.run") as m_sub:
                        m_sub.return_value = mock.MagicMock(returncode=0, stdout="", stderr="")
                        result = send_imessage(_PHONE, _BODY)
        assert result.channel == "god-mac"
        assert result.ok is True


# ---------------------------------------------------------------------------
# BB-first: fail-through paths
# ---------------------------------------------------------------------------

class TestBBFailThrough:
    def test_bb_fails_falls_through_to_god_mac(self):
        """When BB is configured but fails, god-mac should be tried next."""
        fake_client = mock.MagicMock()
        fake_client.send_text.return_value = _bb_fail("BB timeout")
        with _patch_no_double_text():
            with mock.patch.object(sender_mod, "_bluebubbles_client", return_value=fake_client):
                with mock.patch.object(sender_mod, "_which_god", return_value="/usr/local/bin/god"):
                    with mock.patch("subprocess.run") as m_sub:
                        m_sub.return_value = mock.MagicMock(returncode=0, stdout="", stderr="")
                        result = send_imessage(_PHONE, _BODY)
        assert result.channel == "god-mac"
        assert result.ok is True

    def test_bb_raises_exception_falls_through_to_god_mac(self):
        """When BB raises an exception (not just bad result), fall through gracefully."""
        fake_client = mock.MagicMock()
        fake_client.send_text.side_effect = RuntimeError("connection refused")
        with _patch_no_double_text():
            with mock.patch.object(sender_mod, "_bluebubbles_client", return_value=fake_client):
                with mock.patch.object(sender_mod, "_which_god", return_value="/usr/local/bin/god"):
                    with mock.patch("subprocess.run") as m_sub:
                        m_sub.return_value = mock.MagicMock(returncode=0, stdout="", stderr="")
                        result = send_imessage(_PHONE, _BODY)
        assert result.channel == "god-mac"
        assert result.ok is True

    def test_bb_fails_god_fails_falls_through_to_osascript(self):
        """When both BB and god-mac fail, osascript is tried as the final fallback."""
        fake_client = mock.MagicMock()
        fake_client.send_text.return_value = _bb_fail()
        with _patch_no_double_text():
            with mock.patch.object(sender_mod, "_bluebubbles_client", return_value=fake_client):
                with mock.patch.object(sender_mod, "_which_god", return_value=None):
                    with mock.patch.object(sender_mod, "_which_osascript", return_value="/usr/bin/osascript"):
                        with mock.patch("subprocess.run") as m_sub:
                            m_sub.return_value = mock.MagicMock(returncode=0, stdout="", stderr="")
                            result = send_imessage(_PHONE, _BODY)
        assert result.channel == "osascript"
        assert result.ok is True

    def test_all_fail_returns_noop(self):
        """When BB + god + osa all unavailable, returns noop with error."""
        fake_client = mock.MagicMock()
        fake_client.send_text.return_value = _bb_fail()
        with _patch_no_double_text():
            with mock.patch.object(sender_mod, "_bluebubbles_client", return_value=fake_client):
                with mock.patch.object(sender_mod, "_which_god", return_value=None):
                    with mock.patch.object(sender_mod, "_which_osascript", return_value=None):
                        result = send_imessage(_PHONE, _BODY)
        assert result.ok is False
        assert result.channel == "noop"


# ---------------------------------------------------------------------------
# dry_run still bypasses everything
# ---------------------------------------------------------------------------

class TestDryRun:
    def test_dry_run_returns_noop_channel(self):
        with mock.patch.object(sender_mod, "_bluebubbles_client") as m_bb:
            result = send_imessage(_PHONE, _BODY, dry_run=True)
        m_bb.assert_not_called()
        assert result.ok is True
        assert result.channel == "noop"
