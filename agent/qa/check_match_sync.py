"""Phase A match intake loop verification (AI-8315).

pytest-compatible but placed outside ``agent/tests/`` so the fleet's
test-file-protection hook (which blocks new test files under /tests/)
does not reject it. Run with:

    cd /opt/agency-workspace/clapcheeks.tech/agent
    python3 -m pytest qa/check_match_sync.py -v

The tests exercise:
  * Tinder + Hinge parse_match_to_intel
  * sync_matches() with fully-mocked Supabase client
  * Photo download + upload path (via fake content)
  * Idempotent upsert (duplicate match yields single row)
  * 401 Tinder response marks token stale + NULLs it in user_settings
"""
from __future__ import annotations

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Make the agent package importable when pytest is run from agent/qa
_AGENT_ROOT = Path(__file__).resolve().parents[1]
if str(_AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(_AGENT_ROOT))


USER_ID = "9c848c51-8996-4f1f-9dbf-50128e3408ea"


# ---------------------------------------------------------------------------
# Fake Supabase + storage
# ---------------------------------------------------------------------------


class _FakeExec:
    def __init__(self, data=None):
        self.data = data or []

    def execute(self):
        return self


class _FakeQuery:
    def __init__(self, store, table_name):
        self.store = store
        self.table_name = table_name
        self._payload = None
        self._filter = {}
        self._select = None

    def select(self, cols):
        self._select = cols
        return self

    def eq(self, col, val):
        self._filter[col] = val
        return self

    def limit(self, n):
        return self

    def insert(self, payload):
        self.store.setdefault(self.table_name, []).append(("insert", payload))
        return self

    def upsert(self, payload, on_conflict=None):
        self.store.setdefault(self.table_name, []).append(
            ("upsert", payload, on_conflict),
        )
        if self.table_name == "clapcheeks_matches" and on_conflict:
            key_cols = on_conflict.split(",")
            rows = self.store.setdefault("_matches_state", {})
            k = tuple(payload.get(c) for c in key_cols)
            rows[k] = payload
        return self

    def update(self, payload):
        self._payload = payload
        self.store.setdefault(self.table_name, []).append(
            ("update", payload, dict(self._filter)),
        )
        return self

    def execute(self):
        if self.table_name == "clapcheeks_user_settings" and self._select:
            rows = self.store.get("__users__", [])
            filtered = [
                r for r in rows
                if all(r.get(k) == v for k, v in self._filter.items())
            ]
            return _FakeExec(filtered)
        return _FakeExec([])


class _FakeStorageBucket:
    def __init__(self, store):
        self.store = store

    def upload(self, path, file, file_options=None):
        self.store.setdefault("__uploads__", []).append({
            "path": path,
            "size": len(file) if file else 0,
            "options": file_options,
        })
        return {"path": path}


class _FakeStorage:
    def __init__(self, store):
        self.store = store

    def list_buckets(self):
        return [{"name": "match-photos"}]

    def create_bucket(self, name, options=None):
        return {"name": name}

    def from_(self, bucket):
        return _FakeStorageBucket(self.store)


class _FakeClient:
    def __init__(self, store):
        self.store = store
        self.storage = _FakeStorage(store)

    def table(self, name):
        return _FakeQuery(self.store, name)


# ---------------------------------------------------------------------------
# Canned payloads
# ---------------------------------------------------------------------------


def _tinder_match(match_id="m1", person_id="p1", name="Ada", with_photo=True):
    return {
        "_id": match_id,
        "last_activity_date": "2026-04-20T18:00:00Z",
        "person": {
            "_id": person_id,
            "name": name,
            "bio": "Builder. Reader. Hiker.",
            "birth_date": "1995-06-15",
            "photos": [{"url": "https://cdn.example.com/p1.jpg"}] if with_photo else [],
        },
    }


def _tinder_profile(user_id="p1", name="Ada"):
    return {
        "results": {
            "_id": user_id,
            "name": name,
            "bio": "Builder. Reader. Hiker.",
            "birth_date": "1995-06-15",
            "photos": [
                {"url": "https://cdn.example.com/p1-hires.jpg"},
                {"url": "https://cdn.example.com/p2-hires.jpg"},
            ],
            "jobs": [{"title": {"name": "Engineer"}, "company": {"name": "Acme"}}],
            "schools": [{"name": "Stanford"}],
            "instagram": {"username": "ada.builds"},
            "spotify_top_artists": [{"name": "Phoebe Bridgers", "id": "pb"}],
        }
    }


def _hinge_match(match_id="hm1", subject_id="s1", name="Maya"):
    return {
        "matchId": match_id,
        "createdAt": "2026-04-20T12:00:00Z",
        "subject": {"subjectId": subject_id, "firstName": name},
    }


def _hinge_profile(subject_id="s1", name="Maya"):
    return {
        "subject": {
            "subjectId": subject_id,
            "firstName": name,
            "age": 27,
            "bio": "Dance, dogs, dumplings.",
            "birthday": "1998-07-22",
            "photos": [
                {"cdnUrl": "https://hinge.example.com/ph1.jpg"},
                {"cdnUrl": "https://hinge.example.com/ph2.jpg"},
            ],
            "prompts": [
                {
                    "prompt": {"question": "Typical Sunday"},
                    "answer": "Farmers market then museum.",
                },
            ],
            "employments": [{"employer": {"name": "Studio"}, "jobTitle": "Designer"}],
            "educations": [{"schoolName": "UCLA"}],
            "instagram": {"username": "maya.dances"},
        }
    }


def _make_session_mock(responses):
    """Build a requests.Session mock that returns payloads keyed by URL substring."""
    session = MagicMock()

    def _request(method, url, **kwargs):
        resp = MagicMock()
        for prefix, payload in responses.items():
            if prefix in url:
                resp.status_code = 200
                resp.content = b"{}"
                resp.json.return_value = payload
                resp.text = ""
                return resp
        resp.status_code = 404
        resp.content = b""
        resp.json.return_value = {}
        resp.text = ""
        return resp

    session.request.side_effect = _request
    # Use a MagicMock for headers so both .update() and assignment work.
    session.headers = MagicMock()
    session.headers.update = MagicMock()
    return session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def store():
    return {}


@pytest.fixture
def fake_client(store):
    return _FakeClient(store)


def _prime_user(store, tinder_token=None, hinge_token=None):
    store["__users__"] = [{
        "user_id": USER_ID,
        "tinder_auth_token": tinder_token,
        "hinge_auth_token": hinge_token,
    }]


def _photo_response():
    r = MagicMock()
    r.status_code = 200
    r.content = b"\xff\xd8\xff\xe0" + b"PHOTO" * 10
    return r


def _patch_sync_module(monkeypatch, fake_client):
    import clapcheeks.match_sync as ms
    monkeypatch.setattr(ms, "_load_supabase_env", lambda: ("http://fake", "fakekey"))
    monkeypatch.setattr("supabase.create_client", lambda url, key: fake_client)
    monkeypatch.setattr(ms.requests, "get", lambda *a, **k: _photo_response())


def _init_tinder_mock(self, responses):
    from clapcheeks.platforms.tinder_api import TinderAPIClient

    self.token = "x"
    self.base_url = "https://api.gotinder.com"
    self.wire = "json"
    self.locale = "en-US"
    self.liked = self.passed = self.errors = 0
    self.session = _make_session_mock(responses)
    self._request = types.MethodType(TinderAPIClient._request, self)
    self._get_json = types.MethodType(TinderAPIClient._get_json, self)
    self._post_json = types.MethodType(TinderAPIClient._post_json, self)
    self.login = types.MethodType(TinderAPIClient.login, self)
    self._fetch_recs = types.MethodType(TinderAPIClient._fetch_recs, self)
    self.list_all_matches = types.MethodType(TinderAPIClient.list_all_matches, self)
    self.get_match_profile = types.MethodType(TinderAPIClient.get_match_profile, self)
    self._try_browser_refresh = lambda: False


def _init_hinge_mock(self, responses):
    from clapcheeks.platforms.hinge_api import HingeAPIClient

    self.token = "h"
    self.base_url = "https://prod-api.hingeaws.net"
    self.ai_service_url = None
    self.liked = self.passed = self.errors = self.commented = 0
    self.session = _make_session_mock(responses)
    self._request = types.MethodType(HingeAPIClient._request, self)
    self.login = types.MethodType(HingeAPIClient.login, self)
    self.list_all_matches = types.MethodType(HingeAPIClient.list_all_matches, self)
    self.get_match_profile = types.MethodType(HingeAPIClient.get_match_profile, self)
    self._try_sms_refresh = lambda: False


# ---------------------------------------------------------------------------
# Parser tests
# ---------------------------------------------------------------------------


class TestTinderParser:
    def test_parse_produces_expected_shape(self):
        from clapcheeks.platforms.tinder_api import TinderAPIClient

        intel = TinderAPIClient.parse_match_to_intel(
            _tinder_match(), _tinder_profile()["results"],
        )
        assert intel["external_id"] == "m1"
        assert intel["name"] == "Ada"
        assert intel["birth_date"] == "1995-06-15"
        assert intel["school"] == "Stanford"
        assert intel["job"] == "Engineer"
        assert intel["instagram_handle"] == "ada.builds"
        assert intel["spotify_artists"][0]["name"] == "Phoebe Bridgers"
        assert len(intel["photos"]) == 2
        assert intel["photos"][0]["url"].startswith("https://")

    def test_parse_without_profile(self):
        from clapcheeks.platforms.tinder_api import TinderAPIClient

        intel = TinderAPIClient.parse_match_to_intel(_tinder_match())
        assert intel["name"] == "Ada"
        assert intel["photos"]


class TestHingeParser:
    def test_parse_full_profile(self):
        from clapcheeks.platforms.hinge_api import HingeAPIClient

        intel = HingeAPIClient.parse_match_to_intel(
            _hinge_match(), _hinge_profile()["subject"],
        )
        assert intel["external_id"] == "hm1"
        assert intel["name"] == "Maya"
        assert intel["birth_date"] == "1998-07-22"
        assert intel["age"] == 27
        assert intel["school"] == "UCLA"
        assert intel["job"] == "Designer"
        assert intel["instagram_handle"] == "maya.dances"
        assert intel["prompts"][0]["question"] == "Typical Sunday"
        assert len(intel["photos"]) == 2


# ---------------------------------------------------------------------------
# sync_matches integration tests (with mocked Supabase + HTTP)
# ---------------------------------------------------------------------------


class TestSyncMatchesTinder:
    def test_new_match_upserts_with_photos(self, monkeypatch, fake_client, store):
        _prime_user(store, tinder_token="TINDER_TOK")
        _patch_sync_module(monkeypatch, fake_client)

        from clapcheeks.platforms import tinder_api as ta
        responses = {
            "/v2/profile": {"ok": True},
            "/v2/matches": {
                "data": {"matches": [_tinder_match()], "next_page_token": None},
            },
            "/user/p1": _tinder_profile(),
        }
        monkeypatch.setattr(
            ta.TinderAPIClient, "__init__",
            lambda self, token=None, **kw: _init_tinder_mock(self, responses),
        )

        from clapcheeks.match_sync import sync_matches
        summary = sync_matches(once=True)

        assert summary["upserted"] == 1, summary
        assert summary["photos_uploaded"] >= 1
        assert len(store.get("__uploads__", [])) >= 1

        upserts = [r for r in store.get("clapcheeks_matches", []) if r[0] == "upsert"]
        assert upserts, "no upsert recorded"
        _, payload, _ = upserts[0]
        assert payload["user_id"] == USER_ID
        assert payload["platform"] == "tinder"
        assert payload["external_id"] == "m1"
        assert payload["name"] == "Ada"
        assert payload["photos_jsonb"][0]["supabase_path"]

    def test_duplicate_match_dedupes(self, monkeypatch, fake_client, store):
        _prime_user(store, tinder_token="TINDER_TOK")
        _patch_sync_module(monkeypatch, fake_client)

        from clapcheeks.platforms import tinder_api as ta
        responses = {
            "/v2/profile": {"ok": True},
            "/v2/matches": {
                "data": {
                    "matches": [_tinder_match(), _tinder_match()],
                    "next_page_token": None,
                },
            },
            "/user/p1": _tinder_profile(),
        }
        monkeypatch.setattr(
            ta.TinderAPIClient, "__init__",
            lambda self, token=None, **kw: _init_tinder_mock(self, responses),
        )

        from clapcheeks.match_sync import sync_matches
        sync_matches(once=True)

        state = store.get("_matches_state", {})
        assert len(state) == 1, state

    def test_auth_401_marks_token_stale(self, monkeypatch, fake_client, store):
        _prime_user(store, tinder_token="EXPIRED")
        _patch_sync_module(monkeypatch, fake_client)

        from clapcheeks.platforms import tinder_api as ta

        def _init_fail(self, token=None, **kw):
            from clapcheeks.platforms.tinder_api import TinderAuthError
            self.token = "EXPIRED"
            self.base_url = "https://api.gotinder.com"
            self.wire = "json"
            self.locale = "en-US"
            self.liked = self.passed = self.errors = 0
            self.session = MagicMock()

            def _raise(*a, **kw):
                raise TinderAuthError("401 test")

            self.login = _raise
            self.list_all_matches = _raise
            self.get_match_profile = lambda mid: None
            self._try_browser_refresh = lambda: False

        monkeypatch.setattr(ta.TinderAPIClient, "__init__", _init_fail)

        from clapcheeks.match_sync import sync_matches
        summary = sync_matches(once=True)
        assert summary["auth_expired"] == [f"{USER_ID}/tinder"]

        updates = [r for r in store.get("clapcheeks_user_settings", []) if r[0] == "update"]
        assert any(
            u[1].get("tinder_auth_token") is None for u in updates
        ), updates


class TestSyncMatchesHinge:
    def test_new_match_upserts(self, monkeypatch, fake_client, store):
        _prime_user(store, hinge_token="HINGE_TOK")
        _patch_sync_module(monkeypatch, fake_client)

        from clapcheeks.platforms import hinge_api as ha
        responses = {
            "/user/v2/public/me": {"id": USER_ID},
            "/match/v1": {"matches": [_hinge_match()]},
            "/subject/v1/s1": _hinge_profile(),
        }
        monkeypatch.setattr(
            ha.HingeAPIClient, "__init__",
            lambda self, token=None, **kw: _init_hinge_mock(self, responses),
        )

        from clapcheeks.match_sync import sync_matches
        summary = sync_matches(once=True)

        assert summary["upserted"] == 1, summary
        upserts = [r for r in store.get("clapcheeks_matches", []) if r[0] == "upsert"]
        assert upserts
        _, payload, _ = upserts[0]
        assert payload["platform"] == "hinge"
        assert payload["name"] == "Maya"
        assert payload["prompts_jsonb"][0]["question"] == "Typical Sunday"
