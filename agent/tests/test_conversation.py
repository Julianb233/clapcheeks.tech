"""Tests for conversation manager."""
import pytest
from unittest.mock import MagicMock, patch, PropertyMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_manager(dry_run=False):
    """Create a ConversationManager with mocked dependencies."""
    mock_client = MagicMock()
    mock_client.check_new_matches.return_value = []
    mock_client.send_message.return_value = True

    config = {
        "ai_service_url": "http://localhost:8000",
        "dry_run": dry_run,
    }

    with patch("clapcheeks.conversation.manager.ConversationManager._load_style", return_value="casual"):
        from clapcheeks.conversation.manager import ConversationManager
        mgr = ConversationManager(mock_client, "tinder", config)
    return mgr, mock_client


# ---------------------------------------------------------------------------
# _conversation_stage
# ---------------------------------------------------------------------------

class TestConversationStage:
    def test_empty_messages_returns_new(self):
        mgr, _ = _make_manager()
        assert mgr._conversation_stage([]) == "new"

    def test_two_messages_returns_replied(self):
        mgr, _ = _make_manager()
        msgs = [
            {"role": "user", "content": "hey"},
            {"role": "assistant", "content": "hi there"},
        ]
        assert mgr._conversation_stage(msgs) == "replied"

    def test_one_message_returns_opened(self):
        mgr, _ = _make_manager()
        msgs = [{"role": "assistant", "content": "hey there"}]
        assert mgr._conversation_stage(msgs) == "opened"

    def test_messages_with_meet_keyword_returns_date_ready(self):
        mgr, _ = _make_manager()
        msgs = [
            {"role": "user", "content": "hey"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "we should meet up"},
            {"role": "assistant", "content": "yeah for sure"},
            {"role": "user", "content": "how about coffee"},
        ]
        assert mgr._conversation_stage(msgs) == "date_ready"

    def test_six_messages_returns_date_ready(self):
        mgr, _ = _make_manager()
        msgs = [{"role": "user", "content": f"msg {i}"} for i in range(6)]
        assert mgr._conversation_stage(msgs) == "date_ready"


# ---------------------------------------------------------------------------
# suggest_reply
# ---------------------------------------------------------------------------

class TestSuggestReply:
    def test_builds_correct_payload(self):
        mgr, _ = _make_manager()
        conversation = [
            {"role": "user", "content": "hey whats up"},
            {"role": "assistant", "content": "not much, you?"},
        ]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"suggestion": "sounds good!"}

        with patch("requests.post", return_value=mock_response) as mock_post:
            result = mgr.suggest_reply(conversation, contact_name="Alex")
            assert result == "sounds good!"
            # Verify the POST was called with expected keys
            call_kwargs = mock_post.call_args
            payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
            assert payload["platform"] == "tinder"
            assert payload["contact_name"] == "Alex"
            assert "conversation" in payload
            assert "style_description" in payload

    def test_returns_none_on_api_error(self):
        mgr, _ = _make_manager()
        with patch("requests.post", side_effect=Exception("connection refused")):
            result = mgr.suggest_reply([], contact_name="Test")
            assert result is None


# ---------------------------------------------------------------------------
# run_loop
# ---------------------------------------------------------------------------

class TestRunLoop:
    @patch("clapcheeks.conversation.manager.sleep_jitter")
    @patch("clapcheeks.conversation.manager.get_stale_conversations", return_value=[])
    @patch("clapcheeks.conversation.manager.update_conversation")
    @patch("clapcheeks.conversation.manager.get_conversation", return_value={})
    @patch("clapcheeks.conversation.manager.should_ask_for_date", return_value=False)
    def test_run_loop_with_new_matches(self, mock_date, mock_get_conv, mock_update, mock_stale, mock_sleep):
        mgr, mock_client = _make_manager()
        mock_client.check_new_matches.return_value = [
            {"match_id": "m1", "name": "Alice"},
            {"match_id": "m2", "name": "Bob"},
        ]
        # Mock process_replies to avoid deep dependency chains
        mock_client.get_matches = MagicMock(return_value=[])

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"suggestion": "hey there!"}

        with patch("requests.post", return_value=mock_response):
            summary = mgr.run_loop()

        assert summary["openers_sent"] == 2
        assert mock_client.send_message.call_count == 2

    @patch("clapcheeks.conversation.manager.sleep_jitter")
    @patch("clapcheeks.conversation.manager.get_stale_conversations", return_value=[])
    @patch("clapcheeks.conversation.manager.update_conversation")
    @patch("clapcheeks.conversation.manager.get_conversation", return_value={})
    @patch("clapcheeks.conversation.manager.should_ask_for_date", return_value=False)
    def test_dry_run_does_not_call_send_message(self, mock_date, mock_get_conv, mock_update, mock_stale, mock_sleep):
        mgr, mock_client = _make_manager(dry_run=True)
        mock_client.check_new_matches.return_value = [
            {"match_id": "m1", "name": "Alice"},
        ]
        mock_client.get_matches = MagicMock(return_value=[])

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"suggestion": "hey!"}

        with patch("requests.post", return_value=mock_response):
            summary = mgr.run_loop()

        assert summary["openers_sent"] == 1
        mock_client.send_message.assert_not_called()
