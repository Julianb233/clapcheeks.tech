"""Tests for Phase M (AI-8345) agent job queue.

These tests mock the Supabase client so they can run on any machine
without a live database. The real integration surface is:

    daemon -> enqueue_job() -> insert
    extension -> claim + fetch + POST /api/ingest/api-result
    daemon -> wait_for_completion() -> row flipped to completed

Here we fake the extension side by directly mutating the mock client's
internal row store.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# In-memory fake Supabase client
# ---------------------------------------------------------------------------


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Chainable query builder mimicking supabase-py's fluent API."""

    def __init__(self, table):
        self._table = table
        self._filters = []
        self._limit = None
        self._order_col = None
        self._order_desc = False

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def in_(self, col, vals):
        self._filters.append(("in", col, list(vals)))
        return self

    def lt(self, col, val):
        self._filters.append(("lt", col, val))
        return self

    def select(self, *cols):
        return self

    def order(self, col, desc=False):
        self._order_col = col
        self._order_desc = desc
        return self

    def limit(self, n):
        self._limit = int(n)
        return self

    def _matches(self):
        rows = []
        for r in self._table.rows:
            ok = True
            for op, col, val in self._filters:
                cell = r.get(col)
                if op == "eq" and cell != val:
                    ok = False
                    break
                if op == "in" and cell not in val:
                    ok = False
                    break
                if op == "lt":
                    if cell is None or str(cell) >= str(val):
                        ok = False
                        break
            if ok:
                rows.append(r)
        if self._order_col:
            rows = sorted(
                rows,
                key=lambda r: (r.get(self._order_col) or ""),
                reverse=self._order_desc,
            )
        if self._limit is not None:
            rows = rows[: self._limit]
        return rows

    def execute(self):
        return _FakeResp(self._matches())


class _InsertQuery:
    def __init__(self, table, row):
        self._table = table
        self._row = row

    def execute(self):
        import uuid
        out = dict(self._row)
        out.setdefault("id", str(uuid.uuid4()))
        out.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        out.setdefault("retry_count", 0)
        out.setdefault("priority", out.get("priority", 5))
        self._table.rows.append(out)
        return _FakeResp([dict(out)])


class _UpdateQuery(_FakeQuery):
    def __init__(self, table, patch_):
        super().__init__(table)
        self._patch = patch_

    def execute(self):
        rows = self._matches()
        for r in rows:
            r.update(self._patch)
        return _FakeResp([dict(r) for r in rows])


class _FakeTable:
    def __init__(self):
        self.rows = []

    def insert(self, row):
        return _InsertQuery(self, row)

    def select(self, *cols):
        return _FakeQuery(self)

    def update(self, patch_):
        return _UpdateQuery(self, patch_)


class FakeSupabase:
    def __init__(self):
        self._tables = {}

    def table(self, name):
        return self._tables.setdefault(name, _FakeTable())


@pytest.fixture
def fake_supabase():
    return FakeSupabase()


# ---------------------------------------------------------------------------
# enqueue_job
# ---------------------------------------------------------------------------


class TestEnqueueJob:
    def test_inserts_pending_row(self, fake_supabase):
        from clapcheeks.job_queue import enqueue_job

        job_id = enqueue_job(
            user_id="u1",
            job_type="list_matches",
            platform="tinder",
            url="https://api.gotinder.com/v2/matches?count=60",
            method="GET",
            headers={"X-Auth-Token": "abc"},
            client=fake_supabase,
        )
        assert job_id is not None
        rows = fake_supabase.table("clapcheeks_agent_jobs").rows
        assert len(rows) == 1
        row = rows[0]
        assert row["user_id"] == "u1"
        assert row["job_type"] == "list_matches"
        assert row["platform"] == "tinder"
        assert row["status"] == "pending"
        assert row["job_params"]["url"].startswith("https://api.gotinder.com")
        assert row["job_params"]["method"] == "GET"
        assert row["job_params"]["headers"]["X-Auth-Token"] == "abc"

    def test_requires_core_fields(self, fake_supabase):
        from clapcheeks.job_queue import enqueue_job

        with pytest.raises(ValueError):
            enqueue_job(
                user_id="",
                job_type="list_matches",
                platform="tinder",
                url="https://x",
                client=fake_supabase,
            )

    def test_insert_failure_returns_none(self, fake_supabase):
        from clapcheeks.job_queue import enqueue_job

        class _Boom(_FakeTable):
            def insert(self, row):
                class _E:
                    def execute(self_inner):
                        raise RuntimeError("db down")
                return _E()

        fake_supabase._tables["clapcheeks_agent_jobs"] = _Boom()
        job_id = enqueue_job(
            user_id="u1",
            job_type="list_matches",
            platform="tinder",
            url="https://api.gotinder.com/v2/matches",
            client=fake_supabase,
        )
        assert job_id is None


# ---------------------------------------------------------------------------
# wait_for_completion
# ---------------------------------------------------------------------------


class TestWaitForCompletion:
    def test_returns_result_when_completed(self, fake_supabase):
        from clapcheeks.job_queue import enqueue_job, wait_for_completion

        job_id = enqueue_job(
            user_id="u1",
            job_type="list_matches",
            platform="tinder",
            url="https://api.gotinder.com/v2/matches",
            client=fake_supabase,
        )
        for r in fake_supabase.table("clapcheeks_agent_jobs").rows:
            if r["id"] == job_id:
                r["status"] = "completed"
                r["result_jsonb"] = {
                    "status_code": 200,
                    "body": {"data": {"matches": [{"_id": "m1"}]}},
                    "headers": {},
                }
                break

        result = wait_for_completion(
            job_id,
            timeout_seconds=2,
            poll_interval_seconds=0.05,
            client=fake_supabase,
        )
        assert result is not None
        assert result["status_code"] == 200
        assert result["body"]["data"]["matches"][0]["_id"] == "m1"

    def test_returns_none_on_failure(self, fake_supabase):
        from clapcheeks.job_queue import enqueue_job, wait_for_completion

        job_id = enqueue_job(
            user_id="u1",
            job_type="get_profile",
            platform="tinder",
            url="https://api.gotinder.com/user/xyz",
            client=fake_supabase,
        )
        for r in fake_supabase.table("clapcheeks_agent_jobs").rows:
            if r["id"] == job_id:
                r["status"] = "failed"
                r["error"] = "http_401"
                break
        result = wait_for_completion(
            job_id,
            timeout_seconds=2,
            poll_interval_seconds=0.05,
            client=fake_supabase,
        )
        assert result is None

    def test_returns_none_on_stale(self, fake_supabase):
        from clapcheeks.job_queue import enqueue_job, wait_for_completion

        job_id = enqueue_job(
            user_id="u1",
            job_type="list_matches",
            platform="tinder",
            url="https://x",
            client=fake_supabase,
        )
        for r in fake_supabase.table("clapcheeks_agent_jobs").rows:
            if r["id"] == job_id:
                r["status"] = "stale_no_extension"
                break
        result = wait_for_completion(
            job_id,
            timeout_seconds=2,
            poll_interval_seconds=0.05,
            client=fake_supabase,
        )
        assert result is None

    def test_timeout_returns_none(self, fake_supabase):
        from clapcheeks.job_queue import enqueue_job, wait_for_completion

        job_id = enqueue_job(
            user_id="u1",
            job_type="list_matches",
            platform="tinder",
            url="https://x",
            client=fake_supabase,
        )
        started = time.monotonic()
        result = wait_for_completion(
            job_id,
            timeout_seconds=1,
            poll_interval_seconds=0.1,
            client=fake_supabase,
        )
        elapsed = time.monotonic() - started
        assert result is None
        assert elapsed >= 0.9


# ---------------------------------------------------------------------------
# mark_stale_no_extension
# ---------------------------------------------------------------------------


class TestMarkStale:
    def test_flips_old_pending_rows(self, fake_supabase):
        from clapcheeks.job_queue import mark_stale_no_extension

        old_iso = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
        fresh_iso = datetime.now(timezone.utc).isoformat()

        fake_supabase.table("clapcheeks_agent_jobs").rows.extend([
            {
                "id": "old1",
                "user_id": "u1",
                "status": "pending",
                "created_at": old_iso,
                "job_params": {"url": "x"},
            },
            {
                "id": "claimed-old",
                "user_id": "u1",
                "status": "claimed",
                "created_at": old_iso,
                "job_params": {"url": "x"},
            },
            {
                "id": "fresh",
                "user_id": "u1",
                "status": "pending",
                "created_at": fresh_iso,
                "job_params": {"url": "x"},
            },
            {
                "id": "done",
                "user_id": "u1",
                "status": "completed",
                "created_at": old_iso,
                "job_params": {"url": "x"},
            },
        ])

        n = mark_stale_no_extension(stale_after_minutes=10, client=fake_supabase)
        assert n == 2
        rows = {r["id"]: r["status"] for r in fake_supabase.table("clapcheeks_agent_jobs").rows}
        assert rows["old1"] == "stale_no_extension"
        assert rows["claimed-old"] == "stale_no_extension"
        assert rows["fresh"] == "pending"
        assert rows["done"] == "completed"


# ---------------------------------------------------------------------------
# alert_julian_extension_offline
# ---------------------------------------------------------------------------


class TestAlert:
    def test_calls_god_mac_send(self):
        from clapcheeks import job_queue

        calls = []

        class _FakeProc:
            def __init__(self, rc):
                self.returncode = rc
                self.stdout = ""
                self.stderr = ""

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            return _FakeProc(0)

        with patch("subprocess.run", side_effect=fake_run):
            ok = job_queue.alert_julian_extension_offline(phone="+15551234567")
        assert ok is True
        assert calls and calls[0][:4] == ["god", "mac", "send", "+15551234567"]

    def test_non_zero_return_is_false(self):
        from clapcheeks import job_queue

        class _FakeProc:
            returncode = 1
            stdout = ""
            stderr = "boom"

        with patch("subprocess.run", return_value=_FakeProc()):
            ok = job_queue.alert_julian_extension_offline(phone="+15551234567")
        assert ok is False


# ---------------------------------------------------------------------------
# End-to-end: daemon side of the extension handshake
# ---------------------------------------------------------------------------


class TestDaemonConsumer:
    def test_enqueue_then_simulated_extension_complete(self, fake_supabase):
        """Simulates the full round trip: daemon enqueues, extension flips
        the row to completed with a real-looking body, daemon reads it.
        """
        from clapcheeks.job_queue import enqueue_job, wait_for_completion

        job_id = enqueue_job(
            user_id="user-1",
            job_type="list_matches",
            platform="tinder",
            url="https://api.gotinder.com/v2/matches?count=60&locale=en&message=0",
            method="GET",
            headers={"X-Auth-Token": "t1"},
            client=fake_supabase,
        )

        completed_body = {
            "data": {
                "matches": [
                    {"_id": "m1", "person": {"_id": "p1", "name": "Ada"}},
                    {"_id": "m2", "person": {"_id": "p2", "name": "Grace"}},
                ],
                "next_page_token": None,
            }
        }
        for r in fake_supabase.table("clapcheeks_agent_jobs").rows:
            if r["id"] == job_id:
                r["status"] = "completed"
                r["result_jsonb"] = {
                    "status_code": 200,
                    "body": completed_body,
                    "headers": {"x-ratelimit-remaining": "29"},
                }

        result = wait_for_completion(
            job_id,
            timeout_seconds=2,
            poll_interval_seconds=0.05,
            client=fake_supabase,
        )
        assert result is not None
        assert result["status_code"] == 200
        matches = result["body"]["data"]["matches"]
        assert len(matches) == 2
        assert matches[0]["_id"] == "m1"
