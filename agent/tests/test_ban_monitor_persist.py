"""Tests for BanMonitor → Supabase persistence (AI-8764).

The BanMonitor must:
- Insert a row into `clapcheeks_ban_events` for every signal-detection
  path (HTTP 403/451/429/401, JSON pattern matches, error keywords,
  shadowban heuristics, recaptcha, send failures).
- Update `clapcheeks_user_settings.<platform>_token_expires_at` when an
  HTTP 401 is observed (token revoked) and when a JWT-style token is
  decoded with an `exp` claim.
- Tolerate Supabase being offline / misconfigured without raising.
"""
from __future__ import annotations

import base64
import json
import time
from typing import Any
from unittest.mock import MagicMock

import pytest

from clapcheeks.safety.ban_monitor import (
    BanMonitor,
    _extract_jwt_exp,
    _severity_for,
)
from clapcheeks.session.ban_detector import BanStatus


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
class FakeSupabase:
    """Tiny stand-in for the supabase-py client surface BanMonitor uses."""

    def __init__(self) -> None:
        self.inserts: list[dict] = []
        self.updates: list[dict] = []
        self._pending: dict | None = None
        self._table_name: str | None = None

    def table(self, name: str) -> "FakeSupabase":
        self._table_name = name
        return self

    def insert(self, row: dict) -> "FakeSupabase":
        self._pending = {"op": "insert", "table": self._table_name, "row": row}
        return self

    def update(self, patch: dict) -> "FakeSupabase":
        self._pending = {"op": "update", "table": self._table_name, "patch": patch}
        return self

    def eq(self, column: str, value: Any) -> "FakeSupabase":
        if self._pending is not None:
            self._pending.setdefault("filters", {})[column] = value
        return self

    def execute(self) -> Any:
        op = self._pending or {}
        if op.get("op") == "insert":
            self.inserts.append(op["row"])
        elif op.get("op") == "update":
            self.updates.append(op)
        self._pending = None
        result = MagicMock()
        result.data = [op.get("row") or op.get("patch") or {}]
        return result


@pytest.fixture
def fake_supabase() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture
def monitor(fake_supabase, monkeypatch, tmp_path) -> BanMonitor:
    state_file = tmp_path / "ban_state.json"
    monkeypatch.setenv("CLAPCHEEKS_BAN_STATE_FILE", str(state_file))

    m = BanMonitor(user_id="11111111-1111-1111-1111-111111111111")
    m._supabase_client = fake_supabase
    return m


# ---------------------------------------------------------------------------
# JWT exp helper
# ---------------------------------------------------------------------------
def _make_jwt(exp_epoch: int) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"exp": exp_epoch, "sub": "test"}).encode()
    ).rstrip(b"=")
    sig = base64.urlsafe_b64encode(b"sig").rstrip(b"=")
    return b".".join([header, payload, sig]).decode()


class TestJwtExp:
    def test_extracts_exp_claim(self):
        future = int(time.time()) + 3600
        token = _make_jwt(future)
        iso = _extract_jwt_exp(token)
        assert iso is not None
        from datetime import datetime
        parsed = datetime.fromisoformat(iso)
        assert int(parsed.timestamp()) == future

    def test_returns_none_for_non_jwt(self):
        assert _extract_jwt_exp("not-a-jwt") is None
        assert _extract_jwt_exp("") is None
        assert _extract_jwt_exp("a.b") is None

    def test_returns_none_when_no_exp(self):
        header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=")
        payload = base64.urlsafe_b64encode(b'{"sub":"x"}').rstrip(b"=")
        sig = b"x"
        token = b".".join([header, payload, sig]).decode()
        assert _extract_jwt_exp(token) is None


# ---------------------------------------------------------------------------
# Severity mapping
# ---------------------------------------------------------------------------
class TestSeverityMapping:
    @pytest.mark.parametrize("signal,expected", [
        ("http_403", "critical"),
        ("http_451", "critical"),
        ("json_pattern_hard", "critical"),
        ("shadowban_suspected", "critical"),
        ("error_keyword", "critical"),
        ("http_429", "warn"),
        ("json_pattern_soft", "warn"),
        ("persistent_rate_limit", "warn"),
        ("match_rate_drop", "warn"),
        ("likes_you_freeze", "warn"),
        ("send_failure", "warn"),
        ("recaptcha", "warn"),
        ("http_401", "warn"),
        ("token_expired", "warn"),
        ("anything_else", "info"),
    ])
    def test_severity_for(self, signal, expected):
        assert _severity_for(signal) == expected


# ---------------------------------------------------------------------------
# HTTP signal persistence
# ---------------------------------------------------------------------------
class TestHttpSignalPersist:
    def test_403_inserts_critical_event(self, monitor, fake_supabase):
        status = monitor.check_response("tinder", 403, body=None)
        assert status == BanStatus.HARD_BAN
        events = [
            e for e in fake_supabase.inserts
            if e.get("signal_type") == "http_403"
        ]
        assert len(events) == 1, f"Expected 1 http_403 event, got: {fake_supabase.inserts}"
        evt = events[0]
        assert evt["platform"] == "tinder"
        assert evt["severity"] == "critical"
        assert evt["user_id"] == "11111111-1111-1111-1111-111111111111"
        assert "detected_at" in evt
        assert isinstance(evt["payload"], dict)

    def test_429_persistent_inserts_warn(self, monitor, fake_supabase):
        for _ in range(6):
            monitor.check_response("tinder", 429, body=None)
        persistent = [e for e in fake_supabase.inserts if e["signal_type"] == "persistent_rate_limit"]
        assert len(persistent) >= 1
        assert persistent[0]["severity"] == "warn"

    def test_401_inserts_token_expired_and_marks_column(self, monitor, fake_supabase):
        status = monitor.check_response("tinder", 401, body=None)
        assert status == BanStatus.SUSPECTED
        token_events = [
            e for e in fake_supabase.inserts if e["signal_type"] == "token_expired"
        ]
        assert len(token_events) == 1
        assert token_events[0]["platform"] == "tinder"
        assert token_events[0]["severity"] == "warn"
        assert token_events[0]["payload"]["http_status"] == 401
        token_updates = [
            u for u in fake_supabase.updates
            if u["table"] == "clapcheeks_user_settings"
            and "tinder_auth_token_expires_at" in u["patch"]
        ]
        assert len(token_updates) == 1

    def test_451_inserts_critical_event(self, monitor, fake_supabase):
        monitor.check_response("hinge", 451, body=None)
        events = [
            e for e in fake_supabase.inserts
            if e["signal_type"] == "http_451"
        ]
        assert len(events) == 1
        assert events[0]["severity"] == "critical"
        assert events[0]["platform"] == "hinge"


# ---------------------------------------------------------------------------
# JSON body pattern persistence
# ---------------------------------------------------------------------------
class TestJsonPatternPersist:
    def test_tinder_hard_ban_json_pattern(self, monitor, fake_supabase):
        body = {"error": {"code": 40303, "message": "banned"}}
        status = monitor.check_response("tinder", 200, body=body)
        assert status == BanStatus.HARD_BAN
        events = [e for e in fake_supabase.inserts if e["signal_type"] == "json_pattern_hard"]
        assert len(events) == 1
        assert events[0]["severity"] == "critical"
        assert events[0]["platform"] == "tinder"

    def test_bumble_rate_limited_json_pattern(self, monitor, fake_supabase):
        # Bumble RATE_LIMITED maps to soft_ban → json_pattern_soft signal
        body = {"error_type": "RATE_LIMITED"}
        monitor.check_response("bumble", 200, body=body)
        soft = [e for e in fake_supabase.inserts if e["signal_type"] == "json_pattern_soft"]
        assert len(soft) >= 1
        assert soft[0]["severity"] == "warn"
        assert soft[0]["platform"] == "bumble"


# ---------------------------------------------------------------------------
# Public ban-signal recorders (shadowban, match-rate, recaptcha, etc.)
# ---------------------------------------------------------------------------
class TestPublicRecorders:
    def test_match_rate_drop_persists(self, monitor, fake_supabase):
        monitor.record_match_rate_drop("tinder", ratio=0.4, window_days=7)
        events = [e for e in fake_supabase.inserts if e["signal_type"] == "match_rate_drop"]
        assert len(events) == 1
        assert events[0]["platform"] == "tinder"
        assert events[0]["severity"] == "warn"
        assert "0.40" in events[0]["payload"]["details"]

    def test_likes_you_freeze_persists(self, monitor, fake_supabase):
        monitor.record_likes_you_freeze("hinge", frozen_for_hours=48)
        events = [e for e in fake_supabase.inserts if e["signal_type"] == "likes_you_freeze"]
        assert len(events) == 1
        assert events[0]["platform"] == "hinge"
        assert "48" in events[0]["payload"]["details"]

    def test_recaptcha_persists(self, monitor, fake_supabase):
        monitor.record_recaptcha("tinder", page="login")
        events = [e for e in fake_supabase.inserts if e["signal_type"] == "recaptcha"]
        assert len(events) == 1
        assert "login" in events[0]["payload"]["details"]

    def test_shadowban_persists(self, monitor, fake_supabase):
        monitor.record_shadowban_suspected("hinge", "Likes You queue stale 3d + match rate -70%")
        events = [e for e in fake_supabase.inserts if e["signal_type"] == "shadowban_suspected"]
        assert len(events) == 1
        assert events[0]["severity"] == "critical"


# ---------------------------------------------------------------------------
# Connection-error handler persistence
# ---------------------------------------------------------------------------
class TestErrorHandlerPersist:
    def test_connection_error_persists_send_failure(self, monitor, fake_supabase):
        monitor.handle_error("tinder", ConnectionError("Connection refused"))
        events = [e for e in fake_supabase.inserts if e["signal_type"] == "send_failure"]
        assert len(events) == 1
        assert events[0]["severity"] == "warn"
        assert "refused" in events[0]["payload"]["error"].lower()

    def test_keyword_error_persists_critical(self, monitor, fake_supabase):
        monitor.handle_error("tinder", RuntimeError("Account banned for ToS violation"))
        events = [e for e in fake_supabase.inserts if e["signal_type"] == "error_keyword"]
        assert len(events) == 1
        assert events[0]["severity"] == "critical"


# ---------------------------------------------------------------------------
# JWT update_token_expiry
# ---------------------------------------------------------------------------
class TestUpdateTokenExpiry:
    def test_jwt_with_exp_writes_to_settings(self, monitor, fake_supabase):
        future = int(time.time()) + 3600
        token = _make_jwt(future)
        iso = monitor.update_token_expiry("tinder", token)
        assert iso is not None
        updates = [
            u for u in fake_supabase.updates
            if u["table"] == "clapcheeks_user_settings"
        ]
        assert len(updates) == 1
        assert "tinder_auth_token_expires_at" in updates[0]["patch"]

    def test_opaque_token_returns_none(self, monitor, fake_supabase):
        iso = monitor.update_token_expiry("bumble", "opaque-cookie-string")
        assert iso is None

    def test_unknown_platform_no_update(self, monitor, fake_supabase):
        iso = monitor.update_token_expiry("okcupid", _make_jwt(int(time.time()) + 60))
        assert iso is not None
        for u in fake_supabase.updates:
            for col in u["patch"].keys():
                assert "expires_at" not in col


# ---------------------------------------------------------------------------
# Resilience: missing client / missing user_id
# ---------------------------------------------------------------------------
class TestResilience:
    def test_no_supabase_client_does_not_raise(self, monkeypatch, tmp_path):
        monkeypatch.setenv("CLAPCHEEKS_BAN_STATE_FILE", str(tmp_path / "s.json"))
        m = BanMonitor(user_id="abc")
        m._supabase_client = None
        monkeypatch.setattr(m, "_get_supabase", lambda: None)
        result = m._persist_ban_event("tinder", "http_403")
        assert result is False

    def test_no_user_id_does_not_raise(self, monkeypatch, fake_supabase, tmp_path):
        monkeypatch.setenv("CLAPCHEEKS_BAN_STATE_FILE", str(tmp_path / "s.json"))
        monkeypatch.delenv("CLAPCHEEKS_USER_ID", raising=False)
        m = BanMonitor()
        m._supabase_client = fake_supabase
        monkeypatch.setattr(m, "_resolve_user_id", lambda: None)
        result = m._persist_ban_event("tinder", "http_403")
        assert result is False
        assert fake_supabase.inserts == []

    def test_supabase_insert_exception_swallowed(self, monitor, fake_supabase, monkeypatch):
        def boom(*a, **kw):
            raise RuntimeError("supabase down")
        monkeypatch.setattr(fake_supabase, "execute", boom)
        result = monitor._persist_ban_event("tinder", "http_403")
        assert result is False

    def test_resolve_user_id_uses_env_fallback(self, monkeypatch, tmp_path):
        monkeypatch.setenv("CLAPCHEEKS_BAN_STATE_FILE", str(tmp_path / "s.json"))
        monkeypatch.setenv("CLAPCHEEKS_USER_ID", "env-uuid-zzz")
        m = BanMonitor()
        assert m._resolve_user_id() == "env-uuid-zzz"
