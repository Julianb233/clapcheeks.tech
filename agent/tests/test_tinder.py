"""Tests for TinderClient swipe logic and AI opener fallback."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# TinderClient._should_like
# ---------------------------------------------------------------------------

class TestShouldLike:
    """Verify swipe-decision logic in isolation (no browser needed)."""

    def _should_like(self, profile_data, like_ratio):
        from clapcheeks.platforms.tinder import TinderClient
        return TinderClient._should_like(profile_data, like_ratio)

    def test_ratio_one_always_likes(self):
        for _ in range(20):
            assert self._should_like({}, 1.0) is True

    def test_ratio_zero_never_likes(self):
        for _ in range(20):
            assert self._should_like({}, 0.0) is False

    def test_age_below_pref_min_returns_false(self, monkeypatch):
        """When user has non-default age prefs and profile age is below min."""
        from clapcheeks import profile as profile_mod
        fake_profile = profile_mod.Profile(pref_age_min=25, pref_age_max=35)
        monkeypatch.setattr(
            "clapcheeks.profile.load_profile", lambda: fake_profile,
        )
        assert self._should_like({"age": 22}, 1.0) is False

    def test_age_above_pref_max_returns_false(self, monkeypatch):
        from clapcheeks import profile as profile_mod
        fake_profile = profile_mod.Profile(pref_age_min=25, pref_age_max=35)
        monkeypatch.setattr(
            "clapcheeks.profile.load_profile", lambda: fake_profile,
        )
        assert self._should_like({"age": 40}, 1.0) is False

    def test_age_within_range_respects_ratio(self, monkeypatch):
        from clapcheeks import profile as profile_mod
        fake_profile = profile_mod.Profile(pref_age_min=25, pref_age_max=35)
        monkeypatch.setattr(
            "clapcheeks.profile.load_profile", lambda: fake_profile,
        )
        # ratio=1.0 and age in range -> True
        assert self._should_like({"age": 30}, 1.0) is True

    def test_default_prefs_skip_age_filter(self, monkeypatch):
        """Default pref_age_min=18, pref_age_max=99 should NOT filter."""
        from clapcheeks import profile as profile_mod
        fake_profile = profile_mod.Profile()  # defaults: 18-99
        monkeypatch.setattr(
            "clapcheeks.profile.load_profile", lambda: fake_profile,
        )
        # Age 17 would be filtered by non-default prefs, but defaults pass through
        assert self._should_like({"age": 17}, 1.0) is True


# ---------------------------------------------------------------------------
# TinderClient.run_swipe_session — return format
# ---------------------------------------------------------------------------

class TestRunSwipeSession:

    def test_login_failure_returns_error_result(self):
        from clapcheeks.platforms.tinder import TinderClient

        driver = MagicMock()
        client = TinderClient(driver=driver)

        with patch.object(client, "login", return_value=False):
            result = client.run_swipe_session()

        assert result["liked"] == 0
        assert result["passed"] == 0
        assert result["errors"] == 1
        assert result["new_matches"] == []

    def test_return_dict_has_required_keys(self):
        from clapcheeks.platforms.tinder import TinderClient

        driver = MagicMock()
        client = TinderClient(driver=driver)

        # Mock login success but limit to 0 swipes (via rate limiter at capacity)
        with patch.object(client, "login", return_value=True), \
             patch(
                 "clapcheeks.session.rate_limiter.get_daily_summary",
                 return_value={"tinder_right": 100},
             ):
            result = client.run_swipe_session()

        assert "liked" in result
        assert "passed" in result
        assert "errors" in result
        assert "new_matches" in result
        # All zeroes because rate limit exhausted
        assert result["liked"] == 0
        assert result["passed"] == 0


# ---------------------------------------------------------------------------
# generate_opener — fallback behavior
# ---------------------------------------------------------------------------

class TestGenerateOpener:

    def test_fallback_when_no_ai_available(self, monkeypatch):
        """When both ollama and anthropic are unavailable, return safe default."""
        import clapcheeks.ai.opener as opener_mod

        # Remove ANTHROPIC_API_KEY if set
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        # Block ollama import
        import builtins
        real_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "ollama":
                raise ImportError("no ollama")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", mock_import)

        result = opener_mod.generate_opener("Taylor")
        assert "Taylor" in result
        assert "How's your week going?" in result

    def test_returns_string(self, monkeypatch):
        """generate_opener always returns a non-empty string."""
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        import builtins
        real_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "ollama":
                raise ImportError("no ollama")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", mock_import)

        from clapcheeks.ai.opener import generate_opener
        result = generate_opener("Alex", {"name": "Alex", "age": 28})
        assert isinstance(result, str)
        assert len(result) > 0
