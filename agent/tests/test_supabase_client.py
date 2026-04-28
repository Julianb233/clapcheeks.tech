"""Unit tests for clapcheeks.supabase_client (AI-8767).

Tests cover:
- get_user_client() initialises with user JWT
- Token refresh triggered on 401-like exceptions
- refresh_user_client() replaces the cached singleton
- Missing env vars raise a clear RuntimeError
- get_service_client() is blocked without CLAPCHEEKS_ALLOW_SERVICE_ROLE
- get_service_client() works when CLAPCHEEKS_ALLOW_SERVICE_ROLE is set
- Token persistence writes updated tokens to the .env file
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_env_dict(**extra):
    base = {
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_ANON_KEY": "anon-key",
        "SUPABASE_USER_ACCESS_TOKEN": "access-token-123",
        "SUPABASE_USER_REFRESH_TOKEN": "refresh-token-456",
    }
    base.update(extra)
    return base


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_module_singleton():
    """Reset the cached _user_client singleton between tests."""
    import clapcheeks.supabase_client as sc
    sc._user_client = None
    yield
    sc._user_client = None


@pytest.fixture()
def clean_env(monkeypatch, tmp_path):
    """Wipe all SUPABASE_* vars from os.environ and redirect ~/.clapcheeks to tmp_path."""
    for key in list(os.environ):
        if key.startswith("SUPABASE") or key == "CLAPCHEEKS_ALLOW_SERVICE_ROLE":
            monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return tmp_path


# ---------------------------------------------------------------------------
# _load_env_file
# ---------------------------------------------------------------------------

class TestLoadEnvFile:
    def test_returns_empty_when_no_file(self, clean_env):
        from clapcheeks.supabase_client import _load_env_file
        assert _load_env_file() == {}

    def test_parses_key_value_pairs(self, clean_env):
        from clapcheeks.supabase_client import _load_env_file
        env_file = clean_env / ".clapcheeks" / ".env"
        env_file.parent.mkdir(parents=True, exist_ok=True)
        env_file.write_text("SUPABASE_URL=https://x.supabase.co\nSUPABASE_ANON_KEY=ak\n")
        result = _load_env_file()
        assert result["SUPABASE_URL"] == "https://x.supabase.co"
        assert result["SUPABASE_ANON_KEY"] == "ak"

    def test_ignores_comments_and_blanks(self, clean_env):
        from clapcheeks.supabase_client import _load_env_file
        env_file = clean_env / ".clapcheeks" / ".env"
        env_file.parent.mkdir(parents=True, exist_ok=True)
        env_file.write_text("# comment\n\nSUPABASE_URL=https://x.supabase.co\n")
        result = _load_env_file()
        assert "# comment" not in result

    def test_strips_quotes(self, clean_env):
        from clapcheeks.supabase_client import _load_env_file
        env_file = clean_env / ".clapcheeks" / ".env"
        env_file.parent.mkdir(parents=True, exist_ok=True)
        env_file.write_text("SUPABASE_ANON_KEY='quoted-key'\n")
        assert _load_env_file()["SUPABASE_ANON_KEY"] == "quoted-key"


# ---------------------------------------------------------------------------
# get_user_client
# ---------------------------------------------------------------------------

class TestGetUserClient:
    def test_raises_on_missing_env(self, clean_env):
        from clapcheeks.supabase_client import get_user_client
        with pytest.raises(RuntimeError, match="Missing environment variables"):
            get_user_client()

    def test_raises_with_partial_env(self, clean_env, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
        from clapcheeks.supabase_client import get_user_client
        with pytest.raises(RuntimeError, match="SUPABASE_USER_ACCESS_TOKEN"):
            get_user_client()

    def test_returns_client_with_valid_env(self, clean_env, monkeypatch):
        for k, v in _make_env_dict().items():
            monkeypatch.setenv(k, v)

        mock_client = MagicMock()
        mock_client.auth.set_session.return_value = None

        with patch("clapcheeks.supabase_client.create_client", return_value=mock_client):
            from clapcheeks.supabase_client import get_user_client
            client = get_user_client()

        assert client is mock_client
        mock_client.auth.set_session.assert_called_once_with(
            "access-token-123", "refresh-token-456"
        )

    def test_returns_cached_client_on_second_call(self, clean_env, monkeypatch):
        for k, v in _make_env_dict().items():
            monkeypatch.setenv(k, v)

        mock_client = MagicMock()
        mock_client.auth.set_session.return_value = None

        with patch("clapcheeks.supabase_client.create_client", return_value=mock_client):
            from clapcheeks.supabase_client import get_user_client
            c1 = get_user_client()
            c2 = get_user_client()

        assert c1 is c2

    def test_falls_back_to_refresh_when_set_session_fails(self, clean_env, monkeypatch):
        for k, v in _make_env_dict().items():
            monkeypatch.setenv(k, v)

        mock_client = MagicMock()
        mock_client.auth.set_session.side_effect = Exception("JWT expired")
        mock_session = MagicMock()
        mock_session.session.access_token = "new-access"
        mock_session.session.refresh_token = "new-refresh"
        mock_client.auth.refresh_session.return_value = mock_session

        with patch("clapcheeks.supabase_client.create_client", return_value=mock_client):
            with patch("clapcheeks.supabase_client._persist_tokens") as mock_persist:
                from clapcheeks.supabase_client import get_user_client
                client = get_user_client()

        assert client is mock_client
        mock_client.auth.refresh_session.assert_called_once_with("refresh-token-456")
        mock_persist.assert_called_once_with("new-access", "new-refresh")

    def test_raises_when_both_set_session_and_refresh_fail(self, clean_env, monkeypatch):
        for k, v in _make_env_dict().items():
            monkeypatch.setenv(k, v)

        mock_client = MagicMock()
        mock_client.auth.set_session.side_effect = Exception("bad JWT")
        mock_client.auth.refresh_session.side_effect = Exception("network error")

        with patch("clapcheeks.supabase_client.create_client", return_value=mock_client):
            from clapcheeks.supabase_client import get_user_client
            with pytest.raises(RuntimeError, match="Could not refresh Supabase session"):
                get_user_client()

    def test_force_refresh_replaces_singleton(self, clean_env, monkeypatch):
        for k, v in _make_env_dict().items():
            monkeypatch.setenv(k, v)

        clients = []

        def fake_create(url, key, options=None):
            c = MagicMock()
            c.auth.set_session.return_value = None
            clients.append(c)
            return c

        with patch("clapcheeks.supabase_client.create_client", side_effect=fake_create):
            from clapcheeks.supabase_client import get_user_client
            c1 = get_user_client()
            c2 = get_user_client(force_refresh=True)

        assert len(clients) == 2
        assert c1 is not c2


# ---------------------------------------------------------------------------
# get_service_client
# ---------------------------------------------------------------------------

class TestGetServiceClient:
    def test_raises_without_allow_flag(self, clean_env, monkeypatch):
        monkeypatch.delenv("CLAPCHEEKS_ALLOW_SERVICE_ROLE", raising=False)
        from clapcheeks.supabase_client import get_service_client
        with pytest.raises(RuntimeError, match="CLAPCHEEKS_ALLOW_SERVICE_ROLE"):
            get_service_client()

    def test_raises_when_service_key_missing(self, clean_env, monkeypatch):
        monkeypatch.setenv("CLAPCHEEKS_ALLOW_SERVICE_ROLE", "1")
        monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
        from clapcheeks.supabase_client import get_service_client
        with pytest.raises(RuntimeError, match="SUPABASE_SERVICE_KEY"):
            get_service_client()

    def test_returns_service_client_when_flag_set(self, clean_env, monkeypatch):
        monkeypatch.setenv("CLAPCHEEKS_ALLOW_SERVICE_ROLE", "1")
        monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service-role-key-xxx")

        mock_client = MagicMock()
        with patch("clapcheeks.supabase_client.create_client", return_value=mock_client) as mc:
            from clapcheeks.supabase_client import get_service_client
            client = get_service_client()

        assert client is mock_client
        mc.assert_called_once_with("https://x.supabase.co", "service-role-key-xxx")


# ---------------------------------------------------------------------------
# _persist_tokens
# ---------------------------------------------------------------------------

class TestPersistTokens:
    def test_updates_existing_tokens(self, clean_env):
        env_file = clean_env / ".clapcheeks" / ".env"
        env_file.parent.mkdir(parents=True, exist_ok=True)
        env_file.write_text(
            "SUPABASE_URL=https://x.supabase.co\n"
            "SUPABASE_USER_ACCESS_TOKEN=old-access\n"
            "SUPABASE_USER_REFRESH_TOKEN=old-refresh\n"
        )

        from clapcheeks.supabase_client import _persist_tokens
        _persist_tokens("new-access-999", "new-refresh-999")

        content = env_file.read_text()
        assert "new-access-999" in content
        assert "new-refresh-999" in content
        assert "old-access" not in content
        assert "SUPABASE_URL=https://x.supabase.co" in content

    def test_appends_tokens_when_not_present(self, clean_env):
        env_file = clean_env / ".clapcheeks" / ".env"
        env_file.parent.mkdir(parents=True, exist_ok=True)
        env_file.write_text("SUPABASE_URL=https://x.supabase.co\n")

        from clapcheeks.supabase_client import _persist_tokens
        _persist_tokens("appended-access", "appended-refresh")

        content = env_file.read_text()
        assert "appended-access" in content
        assert "appended-refresh" in content

    def test_handles_missing_env_file_gracefully(self, clean_env):
        # No .env file in ~/.clapcheeks/ — should not raise
        from clapcheeks.supabase_client import _persist_tokens
        _persist_tokens("x", "y")  # Silently creates or warns


# ---------------------------------------------------------------------------
# Thread safety
# ---------------------------------------------------------------------------

class TestThreadSafety:
    def test_concurrent_calls_initialize_once(self, clean_env, monkeypatch):
        for k, v in _make_env_dict().items():
            monkeypatch.setenv(k, v)

        create_call_count = 0

        def fake_create(url, key, options=None):
            nonlocal create_call_count
            create_call_count += 1
            c = MagicMock()
            c.auth.set_session.return_value = None
            return c

        with patch("clapcheeks.supabase_client.create_client", side_effect=fake_create):
            from clapcheeks.supabase_client import get_user_client

            results = []
            errors = []

            def worker():
                try:
                    results.append(get_user_client())
                except Exception as exc:
                    errors.append(exc)

            threads = [threading.Thread(target=worker) for _ in range(10)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

        assert not errors, f"Threads raised: {errors}"
        # All threads should get the same client instance
        assert len({id(c) for c in results}) == 1
