"""Tests for BlueBubblesClient typing indicators and mark_read (AI-8876 Y7).

Covers:
  * start_typing — happy path, URL, payload, HTTP error
  * stop_typing — happy path, URL, payload, HTTP error
  * mark_read — happy path, URL, HTTP error
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

AGENT_DIR = Path(__file__).resolve().parents[2] / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from clapcheeks.imessage.bluebubbles import (
    BlueBubblesClient,
    BlueBubblesError,
    SendResult,
)

_BASE_URL = "http://192.168.1.5:1234"
_PASSWORD = "s3cr3t"
_CHAT_GUID = "iMessage;-;+14155550100"


def _client() -> BlueBubblesClient:
    return BlueBubblesClient(_BASE_URL, _PASSWORD)


def _mock_ok(data: dict | None = None) -> mock.MagicMock:
    resp = mock.MagicMock()
    resp.ok = True
    resp.status_code = 200
    resp.json.return_value = data or {"status": 200}
    return resp


def _mock_err(status: int = 400, text: str = "error") -> mock.MagicMock:
    resp = mock.MagicMock()
    resp.ok = False
    resp.status_code = status
    resp.text = text
    return resp


# ---------------------------------------------------------------------------
# start_typing
# ---------------------------------------------------------------------------

class TestStartTyping:
    def test_happy_path(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()):
            result = client.start_typing(_CHAT_GUID)
        assert result.ok is True
        assert result.channel == "bluebubbles"

    def test_url_contains_chat_guid_and_typing(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()) as m:
            client.start_typing(_CHAT_GUID)
        url = m.call_args[0][0]
        assert _CHAT_GUID in url
        assert url.endswith("/typing")

    def test_payload_typing_true(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()) as m:
            client.start_typing(_CHAT_GUID)
        payload = m.call_args[1]["json"]
        assert payload.get("typing") is True

    def test_http_error_returns_not_ok(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_err(400, "Private API disabled")):
            result = client.start_typing(_CHAT_GUID)
        assert result.ok is False
        assert "400" in (result.error or "")

    def test_network_error_returns_not_ok(self):
        import requests
        client = _client()
        with mock.patch.object(client._session, "post", side_effect=requests.ConnectionError("timeout")):
            result = client.start_typing(_CHAT_GUID)
        assert result.ok is False


# ---------------------------------------------------------------------------
# stop_typing
# ---------------------------------------------------------------------------

class TestStopTyping:
    def test_happy_path(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()):
            result = client.stop_typing(_CHAT_GUID)
        assert result.ok is True

    def test_url_contains_chat_guid_and_typing(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()) as m:
            client.stop_typing(_CHAT_GUID)
        url = m.call_args[0][0]
        assert _CHAT_GUID in url
        assert url.endswith("/typing")

    def test_payload_typing_false(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()) as m:
            client.stop_typing(_CHAT_GUID)
        payload = m.call_args[1]["json"]
        assert payload.get("typing") is False

    def test_start_and_stop_use_same_endpoint_different_payload(self):
        """start_typing and stop_typing must hit the same URL path, differing only in typing bool."""
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()) as m_start:
            client.start_typing(_CHAT_GUID)
        with mock.patch.object(client._session, "post", return_value=_mock_ok()) as m_stop:
            client.stop_typing(_CHAT_GUID)
        assert m_start.call_args[0][0] == m_stop.call_args[0][0]
        assert m_start.call_args[1]["json"]["typing"] is not m_stop.call_args[1]["json"]["typing"]

    def test_http_error_returns_not_ok(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_err()):
            result = client.stop_typing(_CHAT_GUID)
        assert result.ok is False


# ---------------------------------------------------------------------------
# mark_read
# ---------------------------------------------------------------------------

class TestMarkRead:
    def test_happy_path(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()):
            result = client.mark_read(_CHAT_GUID)
        assert result.ok is True
        assert result.channel == "bluebubbles"

    def test_url_contains_chat_guid_and_read(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok()) as m:
            client.mark_read(_CHAT_GUID)
        url = m.call_args[0][0]
        assert _CHAT_GUID in url
        assert url.endswith("/read")

    def test_http_error_returns_not_ok(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_err(400, "Private API disabled")):
            result = client.mark_read(_CHAT_GUID)
        assert result.ok is False

    def test_network_error_returns_not_ok(self):
        import requests
        client = _client()
        with mock.patch.object(client._session, "post", side_effect=requests.ConnectionError("conn")):
            result = client.mark_read(_CHAT_GUID)
        assert result.ok is False
