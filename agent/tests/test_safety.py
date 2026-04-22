"""Comprehensive tests for the anti-detection and safety module (Phase 35).

Tests cover:
- Emergency stop mechanism (trigger, clear, file-based, watchdog)
- Human delay engine (profiles, fatigue, bursts, typing)
- Platform safety limits (caps, sessions, hourly tracking)
- Ban monitor (cross-platform correlation, response checks, emergency threshold)
- Session safety (pre-swipe checks, cooldowns, match rate back-off)
- Ban event log (persistence, filtering, ban-free day counting)
"""
import json
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

import clapcheeks.safety.emergency_stop as estop_mod
import clapcheeks.safety.ban_monitor as bmon_mod
import clapcheeks.session.ban_detector as bdet_mod


# ---------------------------------------------------------------------------
# Emergency Stop
# ---------------------------------------------------------------------------

class TestEmergencyStop:
    """Tests for the emergency stop mechanism."""

    @pytest.fixture(autouse=True)
    def isolate_estop(self, tmp_path):
        """Reset singleton and patch file paths for each test."""
        estop_mod.EmergencyStop._instance = None
        self._orig_stop_file = estop_mod.STOP_FILE
        self._orig_stop_log = estop_mod.STOP_LOG
        estop_mod.STOP_FILE = tmp_path / "EMERGENCY_STOP"
        estop_mod.STOP_LOG = tmp_path / "emergency_stop.log"
        yield
        estop_mod.EmergencyStop._instance = None
        estop_mod.STOP_FILE = self._orig_stop_file
        estop_mod.STOP_LOG = self._orig_stop_log

    def test_initially_not_stopped(self):
        estop = estop_mod.EmergencyStop()
        assert not estop.is_stopped
        assert not estop.should_stop()

    def test_trigger_sets_stop(self):
        estop = estop_mod.EmergencyStop()
        estop.trigger("test reason")
        assert estop.is_stopped
        assert estop.should_stop()
        assert estop.reason == "test reason"
        assert estop.triggered_at is not None

    def test_clear_resets_stop(self):
        estop = estop_mod.EmergencyStop()
        estop.trigger("test")
        estop.clear()
        assert not estop.is_stopped
        assert not estop.should_stop()
        assert estop.reason == ""

    def test_stop_file_detection(self, tmp_path):
        stop_file = tmp_path / "EMERGENCY_STOP"
        stop_file.write_text('{"reason": "external", "triggered_at": "2026-01-01"}')
        estop = estop_mod.EmergencyStop()
        assert estop.should_stop()

    def test_trigger_fires_callbacks(self):
        estop = estop_mod.EmergencyStop()
        called = []
        estop.register_callback(lambda: called.append(True))
        estop.trigger("test")
        assert len(called) == 1

    def test_status_returns_dict(self):
        estop = estop_mod.EmergencyStop()
        status = estop.status()
        assert "stopped" in status
        assert "triggered_at" in status
        assert "reason" in status
        assert "stop_file_exists" in status

    def test_trigger_logs_to_file(self, tmp_path):
        log_file = tmp_path / "emergency_stop.log"
        estop = estop_mod.EmergencyStop()
        estop.trigger("log test")
        assert log_file.exists()
        data = json.loads(log_file.read_text().strip())
        assert data["reason"] == "log test"

    def test_singleton_pattern(self):
        a = estop_mod.EmergencyStop()
        b = estop_mod.EmergencyStop()
        assert a is b


# ---------------------------------------------------------------------------
# Human Delay Engine
# ---------------------------------------------------------------------------

class TestHumanDelayEngine:
    """Tests for the human delay engine."""

    def test_delay_within_bounds(self):
        from clapcheeks.safety.human_delay import HumanDelayEngine
        engine = HumanDelayEngine(personality="normal")
        for _ in range(50):
            delay = engine.get_delay("swipe")
            assert delay >= 0.5  # absolute minimum
            assert delay < 120  # generous ceiling for burst pause

    def test_personality_affects_delays(self):
        from clapcheeks.safety.human_delay import HumanDelayEngine
        cautious = HumanDelayEngine(personality="cautious")
        aggressive = HumanDelayEngine(personality="aggressive")

        cautious_delays = [cautious.get_delay("swipe") for _ in range(100)]
        aggressive_delays = [aggressive.get_delay("swipe") for _ in range(100)]

        # Cautious should be slower on average
        assert sum(cautious_delays) / len(cautious_delays) > sum(aggressive_delays) / len(aggressive_delays)

    def test_session_lifecycle(self):
        from clapcheeks.safety.human_delay import HumanDelayEngine
        engine = HumanDelayEngine()
        ctx = engine.start_session()
        assert ctx is not None
        assert ctx.action_count == 0
        engine.end_session()

    def test_should_end_session_eventually(self):
        from clapcheeks.safety.human_delay import HumanDelayEngine
        engine = HumanDelayEngine()
        ctx = engine.start_session()
        # Monkey-patch the session start time to be 30 min ago
        ctx.started_at = time.time() - 1800
        assert engine.should_end_session()

    def test_typing_delay_scales_with_length(self):
        from clapcheeks.safety.human_delay import HumanDelayEngine
        engine = HumanDelayEngine()
        short_delay = engine.get_typing_delay(10)
        long_delay = engine.get_typing_delay(200)
        assert long_delay > short_delay

    def test_inter_session_delay_reasonable(self):
        from clapcheeks.safety.human_delay import HumanDelayEngine
        engine = HumanDelayEngine()
        delay = engine.get_inter_session_delay()
        # Should be between 1 hour and 12 hours (in seconds)
        assert 3600 <= delay <= 43200

    @pytest.mark.parametrize("action", ["swipe", "message", "navigate", "read_bio", "view_photo", "scroll"])
    def test_all_action_types(self, action):
        from clapcheeks.safety.human_delay import HumanDelayEngine
        engine = HumanDelayEngine()
        delay = engine.get_delay(action)
        assert isinstance(delay, float)
        assert delay > 0


# ---------------------------------------------------------------------------
# Platform Limits
# ---------------------------------------------------------------------------

class TestPlatformLimits:
    """Tests for per-platform safety limits."""

    @pytest.mark.parametrize("platform", [
        "tinder", "hinge", "bumble", "grindr", "badoo",
        "happn", "okcupid", "pof", "feeld", "cmb",
    ])
    def test_all_platforms_have_limits(self, platform):
        from clapcheeks.safety.platform_limits import PLATFORM_SAFETY_LIMITS
        assert platform in PLATFORM_SAFETY_LIMITS
        limit = PLATFORM_SAFETY_LIMITS[platform]
        assert limit.daily_right_swipes_free > 0
        assert limit.daily_right_swipes_paid >= limit.daily_right_swipes_free
        assert limit.hourly_swipe_cap > 0
        assert limit.max_session_minutes > 0
        assert limit.min_session_gap_minutes > 0
        assert limit.swipe_speed_min_seconds > 0

    @pytest.mark.parametrize("platform", [
        "tinder", "hinge", "bumble", "grindr", "badoo",
        "happn", "okcupid", "pof", "feeld", "cmb",
    ])
    def test_limits_have_notes(self, platform):
        from clapcheeks.safety.platform_limits import PLATFORM_SAFETY_LIMITS
        limit = PLATFORM_SAFETY_LIMITS[platform]
        assert len(limit.notes) > 20

    def test_hourly_cap_tracking(self):
        from clapcheeks.safety.platform_limits import PlatformLimits
        limits = PlatformLimits()
        assert limits.check_hourly_cap("tinder")
        # Record actions up to cap
        for i in range(30):
            limits.record_action("tinder", "swipe")
        assert not limits.check_hourly_cap("tinder")

    def test_session_count_tracking(self):
        from clapcheeks.safety.platform_limits import PlatformLimits
        limits = PlatformLimits()
        limits.record_session_start("tinder")
        limits.record_session_start("tinder")
        assert limits._session_counts["tinder"] == 2

    def test_daily_right_cap_by_tier(self):
        from clapcheeks.safety.platform_limits import PLATFORM_SAFETY_LIMITS
        tinder = PLATFORM_SAFETY_LIMITS["tinder"]
        assert tinder.daily_right_swipes_free == 50
        assert tinder.daily_right_swipes_paid == 100

    def test_hinge_strict_free_limit(self):
        from clapcheeks.safety.platform_limits import PLATFORM_SAFETY_LIMITS
        hinge = PLATFORM_SAFETY_LIMITS["hinge"]
        assert hinge.daily_right_swipes_free == 8

    def test_cmb_fixed_daily_limit(self):
        from clapcheeks.safety.platform_limits import PLATFORM_SAFETY_LIMITS
        cmb = PLATFORM_SAFETY_LIMITS["cmb"]
        assert cmb.daily_right_swipes_free == 21
        assert cmb.daily_right_swipes_paid == 21


# ---------------------------------------------------------------------------
# Ban Monitor
# ---------------------------------------------------------------------------

class TestBanMonitor:
    """Tests for the enhanced ban monitor."""

    @pytest.fixture(autouse=True)
    def isolate_ban_monitor(self, tmp_path):
        """Reset singleton for each test."""
        estop_mod.EmergencyStop._instance = None
        self._orig_stop_file = estop_mod.STOP_FILE
        self._orig_stop_log = estop_mod.STOP_LOG
        estop_mod.STOP_FILE = tmp_path / "EMERGENCY_STOP"
        estop_mod.STOP_LOG = tmp_path / "emergency_stop.log"
        yield
        estop_mod.EmergencyStop._instance = None
        estop_mod.STOP_FILE = self._orig_stop_file
        estop_mod.STOP_LOG = self._orig_stop_log

    def test_clean_response(self):
        monitor = bmon_mod.BanMonitor()
        status = monitor.check_response("tinder", 200, {"data": "ok"})
        assert status == bdet_mod.BanStatus.CLEAN

    def test_403_triggers_hard_ban(self):
        monitor = bmon_mod.BanMonitor()
        status = monitor.check_response("tinder", 403)
        assert status == bdet_mod.BanStatus.HARD_BAN

    def test_429_triggers_suspected(self):
        monitor = bmon_mod.BanMonitor()
        status = monitor.check_response("tinder", 429)
        assert status == bdet_mod.BanStatus.SUSPECTED

    def test_family_contamination(self):
        monitor = bmon_mod.BanMonitor()
        monitor.check_response("tinder", 403)
        # Hinge is in the same family — should be paused
        assert monitor.detector.is_paused("hinge")

    def test_safe_to_proceed_when_clean(self):
        monitor = bmon_mod.BanMonitor()
        safe, reason = monitor.is_safe_to_proceed("tinder")
        assert safe

    def test_not_safe_when_paused(self):
        monitor = bmon_mod.BanMonitor()
        monitor.detector.pause_platform("tinder", hours=1)
        safe, reason = monitor.is_safe_to_proceed("tinder")
        assert not safe

    def test_handle_error_with_ban_keyword(self):
        monitor = bmon_mod.BanMonitor()
        status = monitor.handle_error("tinder", Exception("Account has been banned"))
        assert status == bdet_mod.BanStatus.SUSPECTED

    def test_status_report_structure(self):
        monitor = bmon_mod.BanMonitor()
        report = monitor.get_status_report()
        assert "emergency_stop" in report
        assert "platforms" in report
        assert "hard_ban_count" in report
        assert "recent_events" in report

    def test_session_analysis_clean(self):
        monitor = bmon_mod.BanMonitor()
        status = monitor.analyze_session("tinder", {
            "swipes": 30, "matches": 5, "errors": 0,
        })
        assert status == bdet_mod.BanStatus.CLEAN


# ---------------------------------------------------------------------------
# Session Safety (session/safety.py)
# ---------------------------------------------------------------------------

class TestSessionSafety:
    """Tests for session-level safety checks."""

    def setup_method(self):
        """Reset in-memory state between tests."""
        from clapcheeks.session import safety
        safety._hourly_counts.clear()
        safety._hour_timestamps.clear()
        safety._session_end_times.clear()
        safety._session_match_rates.clear()
        safety._backoff_until.clear()

    def test_record_session_end(self):
        from clapcheeks.session.safety import record_session_end, check_cooldown
        record_session_end("tinder")
        can_proceed, remaining = check_cooldown("tinder")
        assert not can_proceed
        assert remaining > 0

    def test_match_rate_recording(self):
        from clapcheeks.session.safety import (
            record_session_match_rate, _session_match_rates,
        )
        record_session_match_rate("tinder", 0.10)
        assert len(_session_match_rates["tinder"]) == 1

    def test_backoff_activates_on_low_match_rate(self):
        from clapcheeks.session.safety import (
            record_session_match_rate, is_backoff_active,
        )
        for _ in range(5):
            record_session_match_rate("tinder", 0.01)  # 1% — below threshold
        assert is_backoff_active("tinder")

    def test_backoff_not_active_with_good_rates(self):
        from clapcheeks.session.safety import (
            record_session_match_rate, is_backoff_active,
        )
        for _ in range(5):
            record_session_match_rate("tinder", 0.15)  # 15% — healthy
        assert not is_backoff_active("tinder")


# ---------------------------------------------------------------------------
# Ban Log (session/ban_log.py)
# ---------------------------------------------------------------------------

class TestBanLog:
    """Tests for the ban event log."""

    @pytest.fixture(autouse=True)
    def isolate_log(self, tmp_path, monkeypatch):
        import clapcheeks.session.ban_log as blog
        monkeypatch.setattr(blog, "BAN_LOG_FILE", tmp_path / "test_ban.jsonl")

    def test_log_and_retrieve(self):
        from clapcheeks.session.ban_log import log_ban_event, get_event_log
        log_ban_event("tinder", "signal", "test signal")
        events = get_event_log()
        assert len(events) == 1
        assert events[0]["platform"] == "tinder"

    def test_log_session_result(self):
        from clapcheeks.session.ban_log import log_session_result, get_event_log
        log_session_result("hinge", swipes=20, matches=3, errors=0, duration_seconds=300)
        events = get_event_log(event_type="session_result")
        assert len(events) == 1

    def test_platform_filter(self):
        from clapcheeks.session.ban_log import log_ban_event, get_event_log
        log_ban_event("tinder", "signal", "t1")
        log_ban_event("hinge", "signal", "h1")
        tinder_events = get_event_log(platform="tinder")
        assert len(tinder_events) == 1
        assert tinder_events[0]["platform"] == "tinder"

    def test_ban_free_days_with_no_events(self):
        from clapcheeks.session.ban_log import get_ban_free_days
        days = get_ban_free_days()
        assert days >= 7

    def test_ban_test_report_structure(self):
        from clapcheeks.session.ban_log import get_ban_test_report
        report = get_ban_test_report()
        assert "generated_at" in report
        assert "target_days" in report
        assert "platforms" in report
        assert "overall_pass" in report
        assert "tinder" in report["platforms"]


# ---------------------------------------------------------------------------
# Safety Hourly Limits
# ---------------------------------------------------------------------------

class TestSafetyHourlyLimits:
    """Tests for hourly limit checks in session/safety.py."""

    def setup_method(self):
        from clapcheeks.session import safety
        safety._hourly_counts.clear()
        safety._hour_timestamps.clear()

    def test_hourly_limit_check(self):
        from clapcheeks.session.safety import check_hourly_limit, record_swipe
        assert check_hourly_limit("tinder", "right")
        for _ in range(15):
            record_swipe("tinder", "right")
        assert not check_hourly_limit("tinder", "right")

    def test_hourly_limit_exceeded(self):
        from clapcheeks.session.safety import pre_swipe_check, record_swipe
        for _ in range(15):
            record_swipe("tinder", "right")
        can_swipe, reason = pre_swipe_check("tinder")
        assert not can_swipe
        assert "limit" in reason.lower()

    def test_safety_summary_structure(self):
        from clapcheeks.session.safety import get_safety_summary
        summary = get_safety_summary()
        assert "tinder" in summary
        assert "can_swipe" in summary["tinder"]
        assert "hourly_right" in summary["tinder"]


# ---------------------------------------------------------------------------
# Rate Limiter Integration
# ---------------------------------------------------------------------------

class TestRateLimiterIntegration:
    """Integration tests verifying rate_limiter and session.safety alignment."""

    @pytest.mark.parametrize("platform", [
        "tinder", "bumble", "hinge", "grindr", "badoo",
        "happn", "okcupid", "pof", "feeld", "cmb",
    ])
    def test_platform_has_hourly_limits(self, platform):
        from clapcheeks.session.safety import HOURLY_LIMITS
        assert platform in HOURLY_LIMITS
        limits = HOURLY_LIMITS[platform]
        assert "right" in limits
        assert "left" in limits
        assert limits["right"] > 0

    @pytest.mark.parametrize("platform", [
        "tinder", "bumble", "hinge", "grindr", "badoo",
        "happn", "okcupid", "pof", "feeld", "cmb",
    ])
    def test_platform_has_cooldown(self, platform):
        from clapcheeks.session.safety import SESSION_COOLDOWN_MINUTES
        assert platform in SESSION_COOLDOWN_MINUTES
        assert SESSION_COOLDOWN_MINUTES[platform] > 0
