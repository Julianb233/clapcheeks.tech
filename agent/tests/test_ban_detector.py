"""Tests for session ban detector."""
import json
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch
from pathlib import Path

from clapcheeks.session.ban_detector import (
    BanDetector,
    BanSignal,
    BanSignalException,
    BanStatus,
    PlatformBanState,
    check_response_for_ban,
    BAN_KEYWORDS,
    SOFT_BAN_PAUSE_HOURS,
    CONSECUTIVE_EMPTY_THRESHOLD,
    ERROR_RATIO_THRESHOLD,
)


# ---------------------------------------------------------------------------
# BanSignal dataclass
# ---------------------------------------------------------------------------

class TestBanSignal:
    def test_to_dict_roundtrip(self):
        now = datetime.now()
        sig = BanSignal(
            platform="tinder",
            signal_type="http_403",
            detected_at=now,
            details="test detail",
        )
        d = sig.to_dict()
        assert d["platform"] == "tinder"
        assert d["signal_type"] == "http_403"
        assert d["details"] == "test detail"

        restored = BanSignal.from_dict(d)
        assert restored.platform == sig.platform
        assert restored.signal_type == sig.signal_type
        assert restored.details == sig.details

    def test_from_dict_missing_details(self):
        d = {
            "platform": "bumble",
            "signal_type": "captcha",
            "detected_at": datetime.now().isoformat(),
        }
        sig = BanSignal.from_dict(d)
        assert sig.details == ""


# ---------------------------------------------------------------------------
# PlatformBanState dataclass
# ---------------------------------------------------------------------------

class TestPlatformBanState:
    def test_to_dict_roundtrip_clean(self):
        state = PlatformBanState(platform="hinge")
        d = state.to_dict()
        assert d["status"] == "clean"
        assert d["paused_until"] is None

        restored = PlatformBanState.from_dict(d)
        assert restored.status == BanStatus.CLEAN
        assert restored.paused_until is None

    def test_to_dict_roundtrip_with_pause(self):
        pause = datetime.now() + timedelta(hours=48)
        state = PlatformBanState(
            platform="tinder",
            status=BanStatus.SOFT_BAN,
            paused_until=pause,
            consecutive_empty_sessions=2,
        )
        d = state.to_dict()
        restored = PlatformBanState.from_dict(d)
        assert restored.status == BanStatus.SOFT_BAN
        assert restored.paused_until is not None
        assert restored.consecutive_empty_sessions == 2


# ---------------------------------------------------------------------------
# BanSignalException
# ---------------------------------------------------------------------------

class TestBanSignalException:
    def test_message_format(self):
        exc = BanSignalException("tinder", "http_403", "got 403")
        assert "tinder" in str(exc)
        assert "http_403" in str(exc)
        assert "got 403" in str(exc)

    def test_attributes(self):
        exc = BanSignalException("bumble", "account_disabled", "suspended")
        assert exc.platform == "bumble"
        assert exc.signal_type == "account_disabled"
        assert exc.details == "suspended"


# ---------------------------------------------------------------------------
# BanDetector — signal recording
# ---------------------------------------------------------------------------

class TestBanDetectorRecordSignal:
    def test_hard_ban_on_http_403(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            status = det.record_signal("tinder", "http_403", "got 403")
            assert status == BanStatus.HARD_BAN

    def test_hard_ban_on_account_disabled(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            status = det.record_signal("bumble", "account_disabled", "suspended")
            assert status == BanStatus.HARD_BAN

    def test_soft_ban_on_no_profiles(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            status = det.record_signal("hinge", "no_profiles", "3 empty sessions")
            assert status == BanStatus.SOFT_BAN

    def test_soft_ban_sets_pause_time(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("hinge", "no_profiles")
            state = det._states["hinge"]
            assert state.paused_until is not None
            assert state.paused_until > datetime.now()
            diff = state.paused_until - datetime.now()
            assert 47 < diff.total_seconds() / 3600 < 49

    def test_soft_ban_on_captcha(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            status = det.record_signal("tinder", "captcha", "captcha detected")
            assert status == BanStatus.SOFT_BAN

    def test_suspected_on_unknown_signal(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            status = det.record_signal("tinder", "weird_behavior", "something odd")
            assert status == BanStatus.SUSPECTED

    def test_soft_ban_doesnt_override_hard_ban(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "http_403")
            status = det.record_signal("tinder", "no_profiles")
            assert status == BanStatus.HARD_BAN

    def test_signal_appended_to_history(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "captcha", "first")
            det.record_signal("tinder", "no_profiles", "second")
            assert len(det._states["tinder"].signals) == 2


# ---------------------------------------------------------------------------
# BanDetector — pause checks
# ---------------------------------------------------------------------------

class TestBanDetectorPauseChecks:
    def test_is_paused_false_for_unknown_platform(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            assert det.is_paused("nonexistent") is False

    def test_is_paused_true_for_hard_ban(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "http_403")
            assert det.is_paused("tinder") is True

    def test_is_paused_true_for_active_soft_ban(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("bumble", "no_profiles")
            assert det.is_paused("bumble") is True

    def test_is_paused_false_for_expired_soft_ban(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("hinge", "no_profiles")
            det._states["hinge"].paused_until = datetime.now() - timedelta(hours=1)
            assert det.is_paused("hinge") is False

    def test_get_pause_reason_hard_ban(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "http_403", "banned")
            reason = det.get_pause_reason("tinder")
            assert "Hard ban" in reason
            assert "fresh account" in reason

    def test_get_pause_reason_soft_ban(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("bumble", "captcha")
            reason = det.get_pause_reason("bumble")
            assert "Soft ban" in reason
            assert "auto-resume" in reason

    def test_get_pause_reason_none_for_clean(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            assert det.get_pause_reason("tinder") is None


# ---------------------------------------------------------------------------
# BanDetector — session result analysis
# ---------------------------------------------------------------------------

class TestCheckSessionResult:
    def test_matches_reset_consecutive_empty(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.check_session_result("tinder", {"liked": 10, "passed": 5, "errors": 0, "new_matches": []})
            det.check_session_result("tinder", {"liked": 10, "passed": 5, "errors": 0, "new_matches": []})
            assert det._states["tinder"].consecutive_empty_sessions == 2

            det.check_session_result("tinder", {"liked": 10, "passed": 5, "errors": 0, "new_matches": [{"name": "Test"}]})
            assert det._states["tinder"].consecutive_empty_sessions == 0

    def test_high_error_ratio_triggers_suspected(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            status = det.check_session_result("tinder", {"liked": 1, "passed": 1, "errors": 5, "new_matches": []})
            assert status in (BanStatus.SUSPECTED, BanStatus.SOFT_BAN)

    def test_consecutive_empties_trigger_soft_ban(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            for _ in range(CONSECUTIVE_EMPTY_THRESHOLD):
                status = det.check_session_result("bumble", {"liked": 10, "passed": 10, "errors": 0, "new_matches": []})
            assert status == BanStatus.SOFT_BAN

    def test_two_empty_sessions_trigger_suspected(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.check_session_result("hinge", {"liked": 10, "passed": 5, "errors": 0, "new_matches": []})
            det.check_session_result("hinge", {"liked": 10, "passed": 5, "errors": 0, "new_matches": []})
            assert det._states["hinge"].status == BanStatus.SUSPECTED

    def test_hard_ban_not_overridden_by_session(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "http_403")
            status = det.check_session_result("tinder", {"liked": 0, "passed": 0, "errors": 0, "new_matches": []})
            assert status == BanStatus.HARD_BAN

    def test_small_session_doesnt_trigger(self, tmp_path):
        """Sessions with <=5 total swipes shouldn't count as empty."""
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.check_session_result("tinder", {"liked": 2, "passed": 2, "errors": 0, "new_matches": []})
            assert det._states["tinder"].consecutive_empty_sessions == 0


# ---------------------------------------------------------------------------
# BanDetector — auto-resume
# ---------------------------------------------------------------------------

class TestAutoResume:
    def test_auto_resume_after_expiry(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "captcha")
            assert det.is_paused("tinder") is True

            det._states["tinder"].paused_until = datetime.now() - timedelta(hours=1)
            resumed = det.auto_resume_check("tinder")
            assert resumed is True
            assert det._states["tinder"].status == BanStatus.CLEAN

    def test_auto_resume_false_when_still_paused(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "captcha")
            resumed = det.auto_resume_check("tinder")
            assert resumed is False

    def test_auto_resume_false_for_unknown(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            assert det.auto_resume_check("nonexistent") is False


# ---------------------------------------------------------------------------
# BanDetector — manual controls
# ---------------------------------------------------------------------------

class TestManualControls:
    def test_manual_pause(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.pause_platform("tinder", hours=24)
            assert det.is_paused("tinder") is True
            assert det._states["tinder"].status == BanStatus.SOFT_BAN

    def test_manual_resume(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("bumble", "captcha")
            det.resume_platform("bumble")
            assert det.is_paused("bumble") is False
            assert det._states["bumble"].status == BanStatus.CLEAN

    def test_resume_hard_ban_noop(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "http_403")
            det.resume_platform("tinder")
            assert det._states["tinder"].status == BanStatus.HARD_BAN


# ---------------------------------------------------------------------------
# BanDetector — persistence
# ---------------------------------------------------------------------------

class TestPersistence:
    def test_save_and_reload(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "captcha", "test")
            det.record_signal("bumble", "http_403", "banned")

        with patch.object(BanDetector, "STATE_FILE", state_file):
            det2 = BanDetector()
            assert det2._states["tinder"].status == BanStatus.SOFT_BAN
            assert det2._states["bumble"].status == BanStatus.HARD_BAN

    def test_corrupt_state_file_handled(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        state_file.write_text("not json {{{")
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            assert det._states == {}


# ---------------------------------------------------------------------------
# BanDetector — status summary
# ---------------------------------------------------------------------------

class TestStatusSummary:
    def test_get_status_summary(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "captcha")
            det.record_signal("bumble", "http_403")

            summary = det.get_status_summary()
            assert "tinder" in summary
            assert "bumble" in summary
            assert summary["tinder"]["status"] == "soft_ban"
            assert summary["bumble"]["status"] == "hard_ban"
            assert summary["tinder"]["signal_count"] == 1

    def test_get_signal_history(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            det.record_signal("tinder", "captcha", "first")
            det.record_signal("tinder", "no_profiles", "second")
            history = det.get_signal_history("tinder")
            assert len(history) == 2
            assert history[0]["signal_type"] == "captcha"
            assert history[1]["signal_type"] == "no_profiles"

    def test_get_signal_history_empty(self, tmp_path):
        state_file = tmp_path / "ban_state.json"
        with patch.object(BanDetector, "STATE_FILE", state_file):
            det = BanDetector()
            assert det.get_signal_history("nonexistent") == []


# ---------------------------------------------------------------------------
# check_response_for_ban (standalone helper)
# ---------------------------------------------------------------------------

class TestCheckResponseForBan:
    def test_raises_on_403(self):
        with pytest.raises(BanSignalException) as exc_info:
            check_response_for_ban("tinder", 403, "Forbidden")
        assert exc_info.value.signal_type == "http_403"

    def test_raises_on_ban_keyword_in_body_str(self):
        with pytest.raises(BanSignalException) as exc_info:
            check_response_for_ban("bumble", 200, "Your account has been suspended")
        assert exc_info.value.signal_type == "account_disabled"

    def test_raises_on_ban_keyword_in_body_dict(self):
        with pytest.raises(BanSignalException) as exc_info:
            check_response_for_ban("hinge", 200, {"error": "Account permanently disabled"})
        assert exc_info.value.signal_type == "account_disabled"

    def test_no_raise_on_clean_response(self):
        check_response_for_ban("tinder", 200, {"data": {"matches": []}})

    def test_no_raise_on_normal_200(self):
        check_response_for_ban("tinder", 200, "OK")

    @pytest.mark.parametrize("keyword", list(BAN_KEYWORDS))
    def test_all_ban_keywords_detected(self, keyword):
        with pytest.raises(BanSignalException):
            check_response_for_ban("tinder", 200, f"Error: {keyword} for this user")

    def test_case_insensitive_detection(self):
        with pytest.raises(BanSignalException):
            check_response_for_ban("tinder", 200, "Your Account Has Been SUSPENDED")

    def test_429_does_not_raise_ban(self):
        """429 is rate limit, not a ban — handled by callers separately."""
        check_response_for_ban("tinder", 429, "Too many requests")
