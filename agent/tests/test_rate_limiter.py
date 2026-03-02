"""Tests for session rate limiter."""
import json
import pytest
from unittest.mock import patch
from pathlib import Path

from clapcheeks.session.rate_limiter import (
    DAILY_LIMITS,
    can_swipe,
    record_swipe,
    jitter_delay,
    get_daily_summary,
)


# ---------------------------------------------------------------------------
# can_swipe
# ---------------------------------------------------------------------------

class TestCanSwipe:
    def test_returns_true_when_count_is_zero(self, tmp_path):
        state_file = tmp_path / "daily_counts.json"
        with patch("clapcheeks.session.rate_limiter.STATE_FILE", state_file):
            assert can_swipe("tinder", "right") is True

    def test_returns_false_at_limit(self, tmp_path):
        state_file = tmp_path / "daily_counts.json"
        from datetime import date
        state = {
            "date": str(date.today()),
            "counts": {"tinder_right": 50},
            "spend": {},
        }
        state_file.write_text(json.dumps(state))
        with patch("clapcheeks.session.rate_limiter.STATE_FILE", state_file):
            assert can_swipe("tinder", "right") is False


# ---------------------------------------------------------------------------
# record_swipe
# ---------------------------------------------------------------------------

class TestRecordSwipe:
    def test_increments_count(self, tmp_path):
        state_file = tmp_path / "daily_counts.json"
        with patch("clapcheeks.session.rate_limiter.STATE_FILE", state_file):
            record_swipe("bumble", "right")
            record_swipe("bumble", "right")
            # Read back
            data = json.loads(state_file.read_text())
            assert data["counts"]["bumble_right"] == 2

    def test_creates_state_file(self, tmp_path):
        state_file = tmp_path / "sub" / "daily_counts.json"
        with patch("clapcheeks.session.rate_limiter.STATE_FILE", state_file):
            record_swipe("hinge", "left")
            assert state_file.exists()


# ---------------------------------------------------------------------------
# jitter_delay
# ---------------------------------------------------------------------------

class TestJitterDelay:
    @pytest.mark.parametrize("action", ["swipe", "message", "navigate"])
    def test_within_min_max(self, action):
        from clapcheeks.session.rate_limiter import DELAY_CONFIG
        cfg = DELAY_CONFIG[action]
        for _ in range(50):
            val = jitter_delay(action)
            assert cfg["min"] <= val <= cfg["max"]

    def test_unknown_action_uses_swipe_defaults(self):
        from clapcheeks.session.rate_limiter import DELAY_CONFIG
        cfg = DELAY_CONFIG["swipe"]
        val = jitter_delay("unknown_action")
        assert cfg["min"] <= val <= cfg["max"]


# ---------------------------------------------------------------------------
# DAILY_LIMITS coverage
# ---------------------------------------------------------------------------

class TestDailyLimits:
    EXPECTED_PLATFORMS = [
        "tinder", "bumble", "hinge", "grindr", "badoo",
        "happn", "okcupid", "pof", "feeld", "cmb",
    ]

    @pytest.mark.parametrize("platform", EXPECTED_PLATFORMS)
    def test_platform_exists(self, platform):
        assert platform in DAILY_LIMITS

    @pytest.mark.parametrize("platform", EXPECTED_PLATFORMS)
    def test_platform_has_right_left_messages(self, platform):
        limits = DAILY_LIMITS[platform]
        assert "right" in limits
        assert "left" in limits
        assert "messages" in limits


# ---------------------------------------------------------------------------
# get_daily_summary
# ---------------------------------------------------------------------------

class TestGetDailySummary:
    def test_returns_none_when_empty(self, tmp_path):
        state_file = tmp_path / "daily_counts.json"
        with patch("clapcheeks.session.rate_limiter.STATE_FILE", state_file):
            result = get_daily_summary()
            assert result is None

    def test_returns_dict_with_data(self, tmp_path):
        state_file = tmp_path / "daily_counts.json"
        with patch("clapcheeks.session.rate_limiter.STATE_FILE", state_file):
            record_swipe("tinder", "right")
            result = get_daily_summary()
            assert isinstance(result, dict)
            assert "tinder_right" in result
