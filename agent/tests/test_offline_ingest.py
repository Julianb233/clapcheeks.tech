"""Phase F (AI-8320): offline contact ingestion tests."""
from __future__ import annotations

import pytest

from clapcheeks.imessage.offline_ingest import (
    OfflineIngestError,
    build_conversation_events,
    build_match_row,
    validate_offline_payload,
)


class TestValidatePayload:
    def test_minimal_valid(self):
        out = validate_offline_payload({"name": "Sarah", "phone": "619-480-1234"})
        assert out["name"] == "Sarah"
        assert out["phone_e164"] == "+16194801234"
        assert out["instagram_handle"] is None
        assert out["met_at"] is None
        assert out["first_impression"] is None

    def test_full_payload(self):
        out = validate_offline_payload({
            "name": "Sarah",
            "phone": "(619) 480-1234",
            "instagram_handle": "@sarah.m",
            "met_at": "at the gym",
            "first_impression": "funny, climbs",
        })
        assert out["phone_e164"] == "+16194801234"
        assert out["instagram_handle"] == "sarah.m"
        assert out["met_at"] == "at the gym"
        assert out["first_impression"] == "funny, climbs"

    def test_notes_alias(self):
        out = validate_offline_payload({
            "name": "Sarah",
            "phone": "6194801234",
            "notes": "legacy field name",
        })
        assert out["first_impression"] == "legacy field name"

    def test_strips_at_on_handle(self):
        out = validate_offline_payload({
            "name": "Sarah", "phone": "6194801234",
            "instagram_handle": "@sarah",
        })
        assert out["instagram_handle"] == "sarah"

    def test_missing_name(self):
        with pytest.raises(OfflineIngestError, match="name"):
            validate_offline_payload({"phone": "6194801234"})

    def test_missing_phone(self):
        with pytest.raises(OfflineIngestError, match="phone"):
            validate_offline_payload({"name": "Sarah"})

    def test_bad_phone(self):
        with pytest.raises(OfflineIngestError, match="NANP"):
            validate_offline_payload({"name": "Sarah", "phone": "12345"})


class TestBuildMatchRow:
    def test_basic_row(self):
        norm = validate_offline_payload({
            "name": "Sarah", "phone": "619-480-1234",
            "instagram_handle": "@sarah.m",
            "met_at": "at the gym",
        })
        row = build_match_row("user-abc", norm)
        assert row["user_id"] == "user-abc"
        assert row["platform"] == "offline"
        assert row["source"] == "imessage"
        assert row["external_id"] == "offline:16194801234"
        assert row["her_phone"] == "+16194801234"
        assert row["handoff_complete"] is True
        assert row["julian_shared_phone"] is True
        assert row["primary_channel"] == "imessage"
        assert row["status"] == "conversing"
        assert row["instagram_handle"] == "sarah.m"
        assert row["met_at"] == "at the gym"
        assert row["name"] == "Sarah"


class TestBuildConversationEvents:
    def test_empty_list(self):
        assert build_conversation_events("u1", "offline:1", []) == []

    def test_preserves_direction(self):
        from datetime import datetime, timezone
        raw = [
            {"text": "hey", "is_from_me": True,
             "date": datetime(2026, 4, 1, tzinfo=timezone.utc), "handle_id": "+1619"},
            {"text": "hi!", "is_from_me": False,
             "date": datetime(2026, 4, 1, 0, 1, tzinfo=timezone.utc), "handle_id": "+1619"},
        ]
        events = build_conversation_events("u1", "offline:16194801234", raw)
        assert len(events) == 2
        assert events[0]["direction"] == "outgoing"
        assert events[0]["channel"] == "imessage"
        assert events[0]["body"] == "hey"
        assert events[1]["direction"] == "incoming"
        assert events[1]["body"] == "hi!"
        assert events[0]["match_id"] == "offline:16194801234"
        assert events[0]["platform"] == "offline"

    def test_handles_string_date(self):
        raw = [{"text": "hey", "is_from_me": True, "date": None, "handle_id": "+1619"}]
        events = build_conversation_events("u1", "x", raw)
        assert events[0]["sent_at"]  # non-empty iso fallback
