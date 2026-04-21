"""Phase F (AI-8320): handoff detection + state machine tests."""
from __future__ import annotations

import pytest

from clapcheeks.imessage.handoff import (
    compute_handoff_state,
    extract_phone,
    load_handoff_template,
    scan_message,
    should_draft_handoff_ask,
)
from clapcheeks.imessage.reader import normalize_phone_digits, to_e164_us


# ---------------------------------------------------------------------------
# Phone extraction
# ---------------------------------------------------------------------------

class TestExtractPhone:
    def test_finds_dashed(self):
        assert extract_phone("hit me at 619-480-1234 whenever") == "+16194801234"

    def test_finds_parens(self):
        assert extract_phone("My number is (619) 480-1234") == "+16194801234"

    def test_finds_dotted(self):
        assert extract_phone("619.480.1234 text me") == "+16194801234"

    def test_finds_country_code(self):
        assert extract_phone("+1 619 480 1234") == "+16194801234"

    def test_finds_bare_ten_digits(self):
        assert extract_phone("call 6194801234 tonight") == "+16194801234"

    def test_finds_eleven_digits_with_one(self):
        assert extract_phone("dial 16194801234") == "+16194801234"

    def test_rejects_nine_digits(self):
        assert extract_phone("619 480 123") is None

    def test_rejects_invalid_area_code_starting_with_1(self):
        assert extract_phone("1194801234") is None

    def test_rejects_year_like_number(self):
        assert extract_phone("born in 1989, moved here in 2019") is None

    def test_rejects_no_number(self):
        assert extract_phone("hey what's up") is None
        assert extract_phone("") is None
        assert extract_phone(None) is None

    def test_rejects_trailing_concatenation(self):
        assert extract_phone("order 61948012345 widgets") is None


class TestNormalize:
    @pytest.mark.parametrize("raw,expected", [
        ("619-480-1234", "+16194801234"),
        ("(619) 480-1234", "+16194801234"),
        ("6194801234", "+16194801234"),
        ("16194801234", "+16194801234"),
        ("+1 619 480 1234", "+16194801234"),
    ])
    def test_to_e164_us(self, raw, expected):
        assert to_e164_us(raw) == expected

    def test_to_e164_us_rejects_short(self):
        assert to_e164_us("12345") is None
        assert to_e164_us("") is None
        assert to_e164_us(None) is None

    def test_normalize_phone_digits(self):
        assert normalize_phone_digits("+1 (619) 480-1234") == "16194801234"
        assert normalize_phone_digits(None) == ""


class TestScanMessage:
    def test_incoming_with_number(self):
        sig = scan_message("ok text me 619-480-1234", direction="incoming")
        assert sig.phone_e164 == "+16194801234"
        assert sig.direction == "incoming"
        assert sig.raw_match is not None

    def test_outgoing_with_number(self):
        sig = scan_message("here's mine: 6194801234", direction="outgoing")
        assert sig.phone_e164 == "+16194801234"
        assert sig.direction == "outgoing"

    def test_no_phone(self):
        sig = scan_message("no number in here", direction="incoming")
        assert sig.phone_e164 is None
        assert sig.raw_match is None

    def test_invalid_direction(self):
        with pytest.raises(ValueError):
            scan_message("whatever", direction="sideways")


class TestComputeHandoffState:
    def test_first_incoming_phone_sets_her_phone(self):
        existing = {
            "her_phone": None,
            "julian_shared_phone": False,
            "handoff_complete": False,
            "status": "conversing",
        }
        sig = scan_message("text me 619-480-1234", direction="incoming")
        updates = compute_handoff_state(existing, sig)
        assert updates["her_phone"] == "+16194801234"
        assert updates.get("handoff_complete") is not True

    def test_first_outgoing_phone_sets_julian_shared(self):
        existing = {
            "her_phone": None,
            "julian_shared_phone": False,
            "handoff_complete": False,
            "status": "conversing",
        }
        sig = scan_message("my cell is 6194801234", direction="outgoing")
        updates = compute_handoff_state(existing, sig)
        assert updates["julian_shared_phone"] is True
        assert updates.get("handoff_complete") is not True

    def test_both_sides_completes_handoff(self):
        existing = {
            "her_phone": None,
            "julian_shared_phone": True,
            "handoff_complete": False,
            "status": "conversing",
        }
        sig = scan_message("k here you go: 619.480.1234", direction="incoming")
        updates = compute_handoff_state(existing, sig)
        assert updates["her_phone"] == "+16194801234"
        assert updates["handoff_complete"] is True
        assert updates["primary_channel"] == "imessage"
        assert updates["status"] == "chatting_phone"
        assert "handoff_detected_at" in updates

    def test_protects_date_booked_status(self):
        existing = {
            "her_phone": None,
            "julian_shared_phone": True,
            "handoff_complete": False,
            "status": "date_booked",
        }
        sig = scan_message("619-480-1234", direction="incoming")
        updates = compute_handoff_state(existing, sig)
        assert updates["handoff_complete"] is True
        assert "status" not in updates

    def test_noop_when_no_phone(self):
        existing = {"her_phone": None, "julian_shared_phone": False,
                    "handoff_complete": False, "status": "conversing"}
        sig = scan_message("what's up", direction="incoming")
        updates = compute_handoff_state(existing, sig)
        assert updates == {}

    def test_noop_when_already_has_phone(self):
        existing = {
            "her_phone": "+16194801234",
            "julian_shared_phone": True,
            "handoff_complete": True,
            "primary_channel": "imessage",
            "status": "chatting_phone",
        }
        sig = scan_message("619-480-1234", direction="incoming")
        updates = compute_handoff_state(existing, sig)
        assert updates == {}


class TestShouldDraftHandoffAsk:
    def test_too_few_messages_rejected(self):
        assert should_draft_handoff_ask(
            message_count=3, engagement_score=0.9,
            julian_already_shared=False, green_signals=["laughing"],
        ) is False

    def test_already_shared_rejected(self):
        assert should_draft_handoff_ask(
            message_count=20, engagement_score=0.9,
            julian_already_shared=True, green_signals=["laughing"],
        ) is False

    def test_green_signal_accepted(self):
        assert should_draft_handoff_ask(
            message_count=5, engagement_score=None,
            julian_already_shared=False, green_signals=["asks_questions"],
        ) is True

    def test_high_score_accepted(self):
        assert should_draft_handoff_ask(
            message_count=7, engagement_score=0.7,
            julian_already_shared=False, green_signals=None,
        ) is True

    def test_cold_rejected(self):
        assert should_draft_handoff_ask(
            message_count=10, engagement_score=0.3,
            julian_already_shared=False, green_signals=None,
        ) is False


class TestLoadHandoffTemplate:
    def test_loads_from_persona(self):
        persona = {
            "platform_handoff": {
                "julian_golden_template": {
                    "full_text": "hey, never on this app, text me 619-480-1234",
                }
            }
        }
        assert "619-480-1234" in load_handoff_template(persona)

    def test_fallback_when_missing(self):
        template = load_handoff_template({})
        assert "text me" in template.lower()

    def test_fallback_when_none(self):
        template = load_handoff_template(None)
        assert template
