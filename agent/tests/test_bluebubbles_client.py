"""Tests for clapcheeks.imessage.bluebubbles (AI-8808).

Covers:
  * TapbackKind enum values and is_remove property
  * EFFECT_IDS constants present and non-empty
  * BlueBubblesClient.send_text — happy path + HTTP error
  * BlueBubblesClient.send_tapback — happy path + HTTP error
  * BlueBubblesClient.send_text with effect_id forwarded correctly
  * BlueBubblesClient.ping — success + failure
  * connect_ws / iter_events scaffold no-op behaviour
  * Request shape assertions (URL, payload keys, query param)
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

# Make the agent package importable when pytest is invoked from repo root.
AGENT_DIR = Path(__file__).resolve().parents[2] / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from clapcheeks.imessage.bluebubbles import (
    EFFECT_IDS,
    BlueBubblesClient,
    BlueBubblesError,
    SendResult,
    TapbackKind,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_URL = "http://192.168.1.5:1234"
_PASSWORD = "s3cr3t"


def _client() -> BlueBubblesClient:
    return BlueBubblesClient(_BASE_URL, _PASSWORD)


def _mock_ok_response(data: dict | None = None) -> mock.MagicMock:
    resp = mock.MagicMock()
    resp.ok = True
    resp.status_code = 200
    resp.json.return_value = data or {"status": 200}
    return resp


def _mock_err_response(status: int = 400, text: str = "error") -> mock.MagicMock:
    resp = mock.MagicMock()
    resp.ok = False
    resp.status_code = status
    resp.text = text
    return resp


# ---------------------------------------------------------------------------
# TapbackKind
# ---------------------------------------------------------------------------

class TestTapbackKind:
    def test_positive_values_are_add(self):
        for kind in [
            TapbackKind.LOVE, TapbackKind.LIKE, TapbackKind.DISLIKE,
            TapbackKind.LAUGH, TapbackKind.EMPHASIZE, TapbackKind.QUESTION,
        ]:
            assert not kind.is_remove, f"{kind.name} should not be remove"
            assert kind.value > 0

    def test_remove_variants_are_negative(self):
        for kind in [
            TapbackKind.REMOVE_LOVE, TapbackKind.REMOVE_LIKE,
            TapbackKind.REMOVE_DISLIKE, TapbackKind.REMOVE_LAUGH,
            TapbackKind.REMOVE_EMPHASIZE, TapbackKind.REMOVE_QUESTION,
        ]:
            assert kind.is_remove, f"{kind.name} should be remove"
            assert kind.value < 0

    def test_six_add_variants(self):
        add_kinds = [k for k in TapbackKind if not k.is_remove]
        assert len(add_kinds) == 6

    def test_six_remove_variants(self):
        remove_kinds = [k for k in TapbackKind if k.is_remove]
        assert len(remove_kinds) == 6

    def test_love_value(self):
        assert TapbackKind.LOVE.value == 2000

    def test_label_contains_name(self):
        assert "love" in TapbackKind.LOVE.label
        assert "like" in TapbackKind.LIKE.label

    def test_remove_label_no_prefix(self):
        # REMOVE_* labels should NOT include "remove_" prefix
        assert "remove" not in TapbackKind.REMOVE_LOVE.label


# ---------------------------------------------------------------------------
# EFFECT_IDS
# ---------------------------------------------------------------------------

class TestEffectIds:
    _EXPECTED = {"slam", "loud", "gentle", "invisible", "lasers", "balloons",
                 "confetti", "fireworks", "celebration", "spotlight", "echo"}

    def test_all_expected_keys_present(self):
        missing = self._EXPECTED - set(EFFECT_IDS.keys())
        assert not missing, f"Missing effect IDs: {missing}"

    def test_all_values_non_empty(self):
        for key, val in EFFECT_IDS.items():
            assert isinstance(val, str) and val, f"Effect ID for {key!r} is empty"

    def test_slam_uri(self):
        assert "impact" in EFFECT_IDS["slam"]

    def test_balloons_uri(self):
        assert "Birthday" in EFFECT_IDS["balloons"] or "birthday" in EFFECT_IDS["balloons"].lower()


# ---------------------------------------------------------------------------
# BlueBubblesClient.send_text
# ---------------------------------------------------------------------------

class TestSendText:
    def test_happy_path_returns_ok(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response({"guid": "abc"})) as m:
            result = client.send_text("+14155550100", "hello")
        assert result.ok is True
        assert result.channel == "bluebubbles"
        assert result.error is None

    def test_request_url_correct(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_text("+14155550100", "hi")
        assert m.call_args[0][0].endswith("/api/v1/message/text")

    def test_password_sent_as_query_param(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_text("+14155550100", "hi")
        params = m.call_args[1]["params"]
        assert params["password"] == _PASSWORD

    def test_chat_guid_in_payload(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_text("+14155550100", "hey there")
        payload = m.call_args[1]["json"]
        assert payload["chatGuid"] == "iMessage;-;+14155550100"
        assert payload["message"] == "hey there"

    def test_effect_id_forwarded(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_text("+14155550100", "boom", effect_id=EFFECT_IDS["slam"])
        payload = m.call_args[1]["json"]
        assert payload["effectId"] == EFFECT_IDS["slam"]

    def test_no_effect_id_when_not_set(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_text("+14155550100", "no effect")
        payload = m.call_args[1]["json"]
        assert "effectId" not in payload

    def test_subject_forwarded(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_text("+14155550100", "body", subject="Re: lunch")
        payload = m.call_args[1]["json"]
        assert payload["subject"] == "Re: lunch"

    def test_http_error_returns_not_ok(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_err_response(400, "bad req")) as m:
            result = client.send_text("+14155550100", "test")
        assert result.ok is False
        assert "400" in result.error

    def test_network_error_returns_not_ok(self):
        import requests
        client = _client()
        with mock.patch.object(client._session, "post", side_effect=requests.ConnectionError("conn refused")):
            result = client.send_text("+14155550100", "test")
        assert result.ok is False
        assert result.error is not None

    def test_empty_body_short_circuits(self):
        client = _client()
        with mock.patch.object(client._session, "post") as m:
            result = client.send_text("+14155550100", "   ")
        m.assert_not_called()
        assert result.ok is False


# ---------------------------------------------------------------------------
# BlueBubblesClient.send_tapback
# ---------------------------------------------------------------------------

class TestSendTapback:
    _GUID = "p:0/ABCD1234-EF56-7890-AB12-CD34EF567890"

    def test_happy_path_love(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            result = client.send_tapback(self._GUID, TapbackKind.LOVE)
        assert result.ok is True

    def test_request_url_correct(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_tapback(self._GUID, TapbackKind.LIKE)
        assert m.call_args[0][0].endswith("/api/v1/message/react")

    def test_payload_shape(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_tapback(self._GUID, TapbackKind.LAUGH)
        payload = m.call_args[1]["json"]
        assert payload["selectedMessageGuid"] == self._GUID
        assert payload["reaction"] == TapbackKind.LAUGH.value

    def test_remove_tapback_negative_value(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
            client.send_tapback(self._GUID, TapbackKind.REMOVE_LOVE)
        payload = m.call_args[1]["json"]
        assert payload["reaction"] == TapbackKind.REMOVE_LOVE.value
        assert payload["reaction"] < 0

    def test_http_error_returns_not_ok(self):
        client = _client()
        with mock.patch.object(client._session, "post", return_value=_mock_err_response(400, "Private API disabled")):
            result = client.send_tapback(self._GUID, TapbackKind.LOVE)
        assert result.ok is False
        assert "400" in result.error

    def test_all_tapback_kinds_send_correct_value(self):
        client = _client()
        for kind in TapbackKind:
            with mock.patch.object(client._session, "post", return_value=_mock_ok_response()) as m:
                client.send_tapback(self._GUID, kind)
            payload = m.call_args[1]["json"]
            assert payload["reaction"] == kind.value, f"Wrong value for {kind.name}"


# ---------------------------------------------------------------------------
# BlueBubblesClient.ping
# ---------------------------------------------------------------------------

class TestPing:
    def test_ping_ok(self):
        client = _client()
        with mock.patch.object(client._session, "get", return_value=_mock_ok_response()):
            assert client.ping() is True

    def test_ping_server_error(self):
        client = _client()
        with mock.patch.object(client._session, "get", return_value=_mock_err_response(500)):
            assert client.ping() is False

    def test_ping_network_error(self):
        import requests
        client = _client()
        with mock.patch.object(client._session, "get", side_effect=requests.ConnectionError):
            assert client.ping() is False

    def test_ping_url(self):
        client = _client()
        with mock.patch.object(client._session, "get", return_value=_mock_ok_response()) as m:
            client.ping()
        assert m.call_args[0][0].endswith("/api/v1/server/info")


# ---------------------------------------------------------------------------
# WebSocket scaffold — connect_ws + iter_events are no-ops
# ---------------------------------------------------------------------------

class TestWsScaffold:
    def test_connect_ws_is_no_op(self):
        """connect_ws must not raise; it logs and returns."""
        client = _client()
        client.connect_ws()  # should not raise

    def test_iter_events_yields_nothing(self):
        client = _client()
        events = list(client.iter_events())
        assert events == []
