"""Tests for AI-8808 tapback + effect extensions to imessage/sender.py.

Covers:
  * send_tapback: routes through BlueBubbles when BLUEBUBBLES_URL is set
  * send_tapback: returns noop SendResult when BlueBubbles not configured
  * send_tapback: warning logged when BB not configured
  * send_with_effect: routes through BlueBubbles when configured
  * send_with_effect: falls back to plain send_imessage when BB not configured
  * send_with_effect: dry_run short-circuits before any transport call
  * send_with_effect: empty body returns error, no transport call
  * send_with_effect: bad phone returns error
  * Existing send_imessage behaviour unchanged (backward compat smoke test)
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

AGENT_DIR = Path(__file__).resolve().parents[2] / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from clapcheeks.imessage import sender
from clapcheeks.imessage.sender import SendResult, send_tapback, send_with_effect


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_HANDLE = "+14155550100"
_MSG_GUID = "p:0/ABCD1234-0000-0000-0000-AABBCCDDEEFF"
_BB_URL = "http://192.168.1.5:1234"
_BB_PW = "hunter2"

_SLAM_EFFECT = "com.apple.MobileSMS.expressivesend.impact"


def _bb_ok() -> mock.MagicMock:
    """Stub BlueBubblesClient that always returns ok=True."""
    bb = mock.MagicMock()
    bb.send_tapback.return_value = mock.MagicMock(ok=True, error=None)
    bb.send_text.return_value = mock.MagicMock(ok=True, error=None)
    return bb


def _bb_fail() -> mock.MagicMock:
    """Stub BlueBubblesClient that always returns ok=False."""
    bb = mock.MagicMock()
    bb.send_tapback.return_value = mock.MagicMock(ok=False, error="HTTP 400: Private API disabled")
    bb.send_text.return_value = mock.MagicMock(ok=False, error="HTTP 500: server error")
    return bb


# ---------------------------------------------------------------------------
# send_tapback
# ---------------------------------------------------------------------------

class TestSendTapback:
    def test_routes_through_bluebubbles_when_configured(self):
        from clapcheeks.imessage.bluebubbles import TapbackKind
        bb = _bb_ok()
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=bb):
            result = send_tapback(_HANDLE, _MSG_GUID, TapbackKind.LOVE)
        bb.send_tapback.assert_called_once_with(_MSG_GUID, TapbackKind.LOVE)
        assert result.ok is True
        assert result.channel == "bluebubbles"

    def test_noop_when_bluebubbles_not_configured(self):
        from clapcheeks.imessage.bluebubbles import TapbackKind
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=None):
            result = send_tapback(_HANDLE, _MSG_GUID, TapbackKind.LIKE)
        assert result.ok is False
        assert result.channel == "noop"
        assert result.error is not None

    def test_warning_logged_when_no_bb(self, caplog):
        import logging
        from clapcheeks.imessage.bluebubbles import TapbackKind
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=None):
            with caplog.at_level(logging.WARNING, logger="clapcheeks.imessage.sender"):
                send_tapback(_HANDLE, _MSG_GUID, TapbackKind.DISLIKE)
        assert any("BlueBubbles" in r.message for r in caplog.records)

    def test_passes_kind_correctly(self):
        from clapcheeks.imessage.bluebubbles import TapbackKind
        bb = _bb_ok()
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=bb):
            send_tapback(_HANDLE, _MSG_GUID, TapbackKind.QUESTION)
        bb.send_tapback.assert_called_once_with(_MSG_GUID, TapbackKind.QUESTION)

    def test_bb_failure_propagated(self):
        from clapcheeks.imessage.bluebubbles import TapbackKind
        bb = _bb_fail()
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=bb):
            result = send_tapback(_HANDLE, _MSG_GUID, TapbackKind.LOVE)
        assert result.ok is False
        assert result.channel == "bluebubbles"

    def test_explicit_bb_credentials_passed_to_client_factory(self):
        """Explicit url/password are forwarded to _bluebubbles_client."""
        from clapcheeks.imessage.bluebubbles import TapbackKind
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=None) as m:
            send_tapback(
                _HANDLE, _MSG_GUID, TapbackKind.LOVE,
                bluebubbles_url=_BB_URL,
                bluebubbles_password=_BB_PW,
            )
        m.assert_called_once_with(_BB_URL, _BB_PW)


# ---------------------------------------------------------------------------
# send_with_effect
# ---------------------------------------------------------------------------

class TestSendWithEffect:
    def test_routes_through_bb_when_configured(self):
        bb = _bb_ok()
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=bb):
            result = send_with_effect(_HANDLE, "BOOM", _SLAM_EFFECT)
        bb.send_text.assert_called_once()
        call_kwargs = bb.send_text.call_args
        assert call_kwargs[1].get("effect_id") == _SLAM_EFFECT
        assert result.ok is True
        assert result.channel == "bluebubbles"

    def test_falls_back_to_plain_send_when_no_bb(self):
        """When BlueBubbles not configured, body is sent via existing send_imessage path."""
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=None):
            with mock.patch("clapcheeks.imessage.sender.send_imessage") as plain_send:
                plain_send.return_value = SendResult(ok=True, channel="god-mac")
                result = send_with_effect(_HANDLE, "hi", _SLAM_EFFECT)
        plain_send.assert_called_once()
        # channel reflects the fallback transport
        assert result.channel == "god-mac"

    def test_dry_run_short_circuits(self):
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client") as bb_factory:
            result = send_with_effect(_HANDLE, "hello", _SLAM_EFFECT, dry_run=True)
        bb_factory.assert_not_called()
        assert result.ok is True
        assert result.channel == "noop"

    def test_empty_body_returns_error(self):
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client") as bb_factory:
            result = send_with_effect(_HANDLE, "   ", _SLAM_EFFECT)
        bb_factory.assert_not_called()
        assert result.ok is False

    def test_bad_phone_returns_error(self):
        result = send_with_effect("not-a-phone", "hi", _SLAM_EFFECT)
        assert result.ok is False
        assert result.channel == "noop"

    def test_effect_id_in_bb_call(self):
        from clapcheeks.imessage.bluebubbles import EFFECT_IDS
        bb = _bb_ok()
        effect = EFFECT_IDS["balloons"]
        with mock.patch("clapcheeks.imessage.sender._bluebubbles_client", return_value=bb):
            send_with_effect(_HANDLE, "happy birthday", effect)
        _, call_kwargs = bb.send_text.call_args
        assert call_kwargs["effect_id"] == effect


# ---------------------------------------------------------------------------
# Backward compat — send_imessage unchanged
# ---------------------------------------------------------------------------

class TestSendImessageBackwardCompat:
    """Verify the existing send_imessage function still works (smoke test)."""

    def test_noop_when_no_transport(self, monkeypatch):
        monkeypatch.setattr(sender, "_which_god", lambda: None)
        monkeypatch.setattr(sender, "_which_osascript", lambda: None)
        result = sender.send_imessage("+14155550100", "hello")
        assert result.ok is False
        assert result.channel == "noop"

    def test_dry_run(self):
        result = sender.send_imessage("+14155550100", "hello", dry_run=True)
        assert result.ok is True
        assert result.channel == "noop"

    def test_bad_phone(self):
        result = sender.send_imessage("not-a-phone", "hello")
        assert result.ok is False

    def test_empty_body(self):
        result = sender.send_imessage("+14155550100", "  ")
        assert result.ok is False
