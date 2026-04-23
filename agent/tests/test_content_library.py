"""Phase L (AI-8340) tests - content library + auto-posting.

Covers:

* scheduler.build_weekly_plan - ratio compliance, diversity, thirst cap
* scheduler.categories_ratio - default fallback + normalization
* publisher.check_ig_freshness - stale vs fresh vs never-posted
* publisher.post_library_item_now - happy path + no-session path
* publisher.drain_due - in_progress reconcile + failure states
* categorize.categorize_with_vision - mocked vision tags -> category

We reuse the FakeSupabase harness from test_job_queue to avoid touching
a real database.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from tests.test_job_queue import FakeSupabase, _FakeResp, _FakeQuery, _FakeTable


# ---------------------------------------------------------------------------
# Extended FakeSupabase helpers used by Phase L
# ---------------------------------------------------------------------------


class _LteQuery(_FakeQuery):
    """Adds .lte / .is_ to the base fake query (used by publisher)."""
    def lte(self, col, val):
        self._filters.append(("lte", col, val))
        return self

    def is_(self, col, val):
        self._filters.append(("is", col, val))
        return self

    def _matches(self):
        rows = []
        for r in self._table.rows:
            ok = True
            for flt in self._filters:
                op = flt[0]
                col = flt[1]
                val = flt[2] if len(flt) > 2 else None
                cell = r.get(col)
                if op == "eq" and cell != val:
                    ok = False; break
                if op == "in" and cell not in val:
                    ok = False; break
                if op == "lt" and (cell is None or str(cell) >= str(val)):
                    ok = False; break
                if op == "lte" and (cell is None or str(cell) > str(val)):
                    ok = False; break
                if op == "is":
                    if val == "null" and cell is not None:
                        ok = False; break
            if ok:
                rows.append(r)
        if self._order_col:
            rows = sorted(rows, key=lambda r: (r.get(self._order_col) or ""),
                          reverse=self._order_desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        return rows


class _SmartTable(_FakeTable):
    def select(self, *cols):
        return _LteQuery(self)


def _patch_fake(fake):
    """Replace the fake's table factory so all tables get .lte/.is_."""
    for name, t in list(fake._tables.items()):
        new_t = _SmartTable()
        new_t.rows = t.rows
        fake._tables[name] = new_t

    def table(name):
        t = fake._tables.get(name)
        if t is None:
            t = _SmartTable()
            fake._tables[name] = t
        elif not isinstance(t, _SmartTable):
            new_t = _SmartTable()
            new_t.rows = t.rows
            fake._tables[name] = new_t
            t = new_t
        return t

    fake.table = table
    return fake


@pytest.fixture
def fake_supabase():
    return _patch_fake(FakeSupabase())


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------


PERSONA_FIXTURE = {
    "content_library": {
        "ratio": {
            "beach_house_work_from_home": 0.30,
            "dog_faith": 0.30,
            "beach_active": 0.20,
            "entrepreneur_behind_scenes": 0.10,
            "food_drinks_mission_beach": 0.10,
        },
        "posts_per_day": 1,
        "freshness_rule": {
            "max_staleness_days_before_opening_high_score_match": 3,
        },
    },
}


def _library(n_per_cat=3):
    cats = [
        "beach_house_work_from_home", "dog_faith", "beach_active",
        "entrepreneur_behind_scenes", "food_drinks_mission_beach",
        "ted_talk_speaking",
    ]
    out = []
    counter = 0
    for cat in cats:
        for i in range(n_per_cat):
            counter += 1
            out.append({
                "id": f"item-{counter}",
                "user_id": "u1",
                "category": cat,
                "target_time_of_day": "anytime",
                "post_type": "story",
                "posted_at": None,
            })
    return out


class TestSchedulerRatio:
    def test_ratio_respects_beach_plus_dog_60pct(self):
        from clapcheeks.content.scheduler import build_weekly_plan, summary_counts

        plan = build_weekly_plan(
            _library(n_per_cat=5),
            PERSONA_FIXTURE,
            start_date=datetime(2026, 4, 21, tzinfo=timezone.utc),
            days=7,
            rng=random.Random(1),
        )
        counts = summary_counts(plan)
        beach_plus_dog_active = sum(
            counts.get(k, 0) for k in (
                "beach_house_work_from_home", "dog_faith", "beach_active",
            )
        )
        assert len(plan) == 7, f"should plan 7 posts, got {len(plan)}"
        assert beach_plus_dog_active >= 4, (
            f"beach+dog+active should be >= 4/7 (57%), got {beach_plus_dog_active}: {counts}"
        )

    def test_thirst_cap_entrepreneur_plus_speaking_max_one_per_week(self):
        from clapcheeks.content.scheduler import build_weekly_plan, summary_counts

        thirsty_persona = {
            "content_library": {
                "ratio": {
                    "entrepreneur_behind_scenes": 0.50,
                    "ted_talk_speaking": 0.50,
                },
                "posts_per_day": 1,
            },
        }
        plan = build_weekly_plan(
            _library(n_per_cat=5),
            thirsty_persona,
            start_date=datetime(2026, 4, 21, tzinfo=timezone.utc),
            days=7,
            rng=random.Random(1),
        )
        counts = summary_counts(plan)
        thirsty = counts.get("entrepreneur_behind_scenes", 0) + counts.get(
            "ted_talk_speaking", 0
        )
        assert thirsty <= 1, (
            f"entrepreneur+ted_talk should be capped at 1/7, got {thirsty}"
        )

    def test_diversity_no_two_same_cats_in_a_row_when_possible(self):
        from clapcheeks.content.scheduler import build_weekly_plan

        plan = build_weekly_plan(
            _library(n_per_cat=5),
            PERSONA_FIXTURE,
            start_date=datetime(2026, 4, 21, tzinfo=timezone.utc),
            days=7,
            rng=random.Random(1),
        )
        cats = [p["category"] for p in plan]
        repeats = sum(1 for i in range(1, len(cats)) if cats[i] == cats[i - 1])
        assert repeats <= 1, f"too many back-to-back cats: {cats}"

    def test_skips_already_queued_items(self):
        from clapcheeks.content.scheduler import build_weekly_plan

        lib = _library(n_per_cat=3)
        anchor = datetime(2026, 4, 21, tzinfo=timezone.utc)
        existing = [
            {
                "content_library_id": lib[0]["id"],
                "scheduled_for": anchor.isoformat(),
            }
        ]
        plan = build_weekly_plan(
            lib,
            PERSONA_FIXTURE,
            start_date=anchor,
            days=7,
            existing_pending=existing,
            rng=random.Random(1),
        )
        assert all(p["content_library_id"] != lib[0]["id"] for p in plan)


class TestSchedulerQueue:
    def test_save_plan_to_queue_deduplicates(self, fake_supabase):
        from clapcheeks.content.scheduler import save_plan_to_queue

        plan = [
            {
                "day_offset": 0,
                "scheduled_for": "2026-04-22T19:00:00+00:00",
                "content_library_id": "item-1",
                "category": "beach_active",
                "reason": "",
            },
            {
                "day_offset": 1,
                "scheduled_for": "2026-04-23T19:00:00+00:00",
                "content_library_id": "item-2",
                "category": "dog_faith",
                "reason": "",
            },
        ]
        n = save_plan_to_queue(plan, user_id="u1", client=fake_supabase)
        assert n == 2
        rows = fake_supabase.table("clapcheeks_posting_queue").rows
        assert len(rows) == 2
        assert all(r["status"] == "pending" for r in rows)


# ---------------------------------------------------------------------------
# Freshness gate
# ---------------------------------------------------------------------------


class TestFreshness:
    def _seed_library(self, fake, posted_at_iso):
        fake.table("clapcheeks_content_library").rows.append({
            "id": "lib-1",
            "user_id": "u1",
            "post_type": "story",
            "posted_at": posted_at_iso,
        })

    def test_never_posted_is_stale(self, fake_supabase):
        from clapcheeks.content.publisher import check_ig_freshness
        result = check_ig_freshness(
            "u1", max_staleness_days=3, client=fake_supabase,
        )
        assert result["is_stale"] is True
        assert result["most_recent_posted_at"] is None

    def test_recent_post_is_fresh(self, fake_supabase):
        from clapcheeks.content.publisher import check_ig_freshness
        now = datetime(2026, 4, 21, 12, tzinfo=timezone.utc)
        recent = (now - timedelta(days=1)).isoformat()
        self._seed_library(fake_supabase, recent)
        result = check_ig_freshness(
            "u1",
            max_staleness_days=3,
            now=now,
            client=fake_supabase,
        )
        assert result["is_stale"] is False
        assert result["days_since_last_post"] == pytest.approx(1.0, abs=0.01)

    def test_stale_post_trips_gate(self, fake_supabase):
        from clapcheeks.content.publisher import check_ig_freshness
        now = datetime(2026, 4, 21, 12, tzinfo=timezone.utc)
        old = (now - timedelta(days=5)).isoformat()
        self._seed_library(fake_supabase, old)
        result = check_ig_freshness(
            "u1",
            max_staleness_days=3,
            now=now,
            client=fake_supabase,
        )
        assert result["is_stale"] is True
        assert result["days_since_last_post"] == pytest.approx(5.0, abs=0.01)


# ---------------------------------------------------------------------------
# Publisher - post_library_item_now
# ---------------------------------------------------------------------------


class TestPostNow:
    def test_missing_row_reports_correctly(self, fake_supabase):
        from clapcheeks.content.publisher import post_library_item_now
        out = post_library_item_now(
            user_id="u1",
            content_library_id="nope",
            client=fake_supabase,
            signed_url="https://signed.example/file.jpg",
        )
        assert out["ok"] is False
        assert out["reason"] == "missing_row"

    def test_no_session_alerts_julian(self, fake_supabase):
        from clapcheeks.content.publisher import post_library_item_now

        fake_supabase.table("clapcheeks_content_library").rows.append({
            "id": "lib-1",
            "user_id": "u1",
            "media_path": "stories/hello.jpg",
            "caption": "",
            "category": "beach_active",
            "post_type": "story",
        })
        fake_supabase.table("clapcheeks_user_settings").rows.append({
            "user_id": "u1",
            "instagram_auth_token": None,
        })

        with patch(
            "clapcheeks.job_queue.alert_julian_extension_offline",
            return_value=True,
        ) as mock_alert:
            out = post_library_item_now(
                user_id="u1",
                content_library_id="lib-1",
                client=fake_supabase,
                signed_url="https://signed.example/hello.jpg",
            )
        assert out["ok"] is False
        assert out["reason"] == "no_session"
        mock_alert.assert_called_once()

    def test_happy_path_enqueues_job(self, fake_supabase):
        from clapcheeks.content.publisher import post_library_item_now

        fake_supabase.table("clapcheeks_content_library").rows.append({
            "id": "lib-2",
            "user_id": "u1",
            "media_path": "stories/sunset.jpg",
            "caption": "Mission Beach golden hour",
            "category": "food_drinks_mission_beach",
            "post_type": "story",
        })
        fake_supabase.table("clapcheeks_user_settings").rows.append({
            "user_id": "u1",
            "instagram_auth_token": json.dumps({
                "sessionid": "SESS", "ds_user_id": "123",
                "csrftoken": "CSR", "mid": "MID", "ig_did": "DID",
            }),
        })

        out = post_library_item_now(
            user_id="u1",
            content_library_id="lib-2",
            client=fake_supabase,
            signed_url="https://signed.example/sunset.jpg",
        )
        assert out["ok"] is True, out
        assert out["job_id"]
        jobs = fake_supabase.table("clapcheeks_agent_jobs").rows
        assert len(jobs) == 1
        job = jobs[0]
        assert job["job_type"] == "ig_post_story"
        assert job["platform"] == "instagram"
        assert job["job_params"]["body"]["image_url"].endswith("sunset.jpg")
        assert "Mission Beach" in job["job_params"]["body"]["caption"]


# ---------------------------------------------------------------------------
# Publisher - drain_due reconcile
# ---------------------------------------------------------------------------


class TestDrainDue:
    def test_reconciles_completed_job_posts_library(self, fake_supabase):
        from clapcheeks.content.publisher import drain_due

        fake_supabase.table("clapcheeks_posting_queue").rows.append({
            "id": "q1",
            "user_id": "u1",
            "content_library_id": "lib-3",
            "scheduled_for": "2026-04-21T19:00:00+00:00",
            "status": "in_progress",
            "agent_job_id": "job-x",
        })
        fake_supabase.table("clapcheeks_content_library").rows.append({
            "id": "lib-3",
            "user_id": "u1",
            "category": "beach_active",
            "post_type": "story",
            "posted_at": None,
        })
        fake_supabase.table("clapcheeks_agent_jobs").rows.append({
            "id": "job-x",
            "status": "completed",
            "result_jsonb": {
                "status_code": 200,
                "body": {"media": {"id": "ig-post-123"}},
            },
        })

        now = datetime(2026, 4, 22, tzinfo=timezone.utc)
        stats = drain_due(now=now, client=fake_supabase)
        assert stats["posted"] >= 1

        q = fake_supabase.table("clapcheeks_posting_queue").rows[0]
        lib = fake_supabase.table("clapcheeks_content_library").rows[0]
        assert q["status"] == "posted"
        assert lib["posted_at"] is not None
        assert lib.get("platform_post_id") == "ig-post-123"

    def test_reconciles_failed_job_flips_queue_failed(self, fake_supabase):
        from clapcheeks.content.publisher import drain_due

        fake_supabase.table("clapcheeks_posting_queue").rows.append({
            "id": "q2",
            "user_id": "u1",
            "content_library_id": "lib-4",
            "scheduled_for": "2026-04-21T19:00:00+00:00",
            "status": "in_progress",
            "agent_job_id": "job-y",
        })
        fake_supabase.table("clapcheeks_agent_jobs").rows.append({
            "id": "job-y",
            "status": "failed",
            "error": "ig_upload_http_403",
        })

        now = datetime(2026, 4, 22, tzinfo=timezone.utc)
        stats = drain_due(now=now, client=fake_supabase)
        assert stats["failed"] >= 1
        q = fake_supabase.table("clapcheeks_posting_queue").rows[0]
        assert q["status"] == "failed"


# ---------------------------------------------------------------------------
# Categorize
# ---------------------------------------------------------------------------


class TestCategorize:
    def test_beach_active_tags_pick_beach_active(self):
        from clapcheeks.content.categorize import classify_from_tags
        tags = {
            "activities": ["surfing", "beach"],
            "locations": ["beach", "outdoors"],
            "aesthetic": "athletic",
            "energy": "high",
            "solo_vs_group": "solo",
        }
        cat, conf = classify_from_tags(tags)
        assert cat == "beach_active"
        assert conf > 0.2

    def test_dog_tags_pick_dog_faith(self):
        from clapcheeks.content.categorize import classify_from_tags
        tags = {
            "activities": ["dog_walking"],
            "notable_details": ["dog_present", "cross"],
            "locations": ["outdoors"],
        }
        cat, _ = classify_from_tags(tags)
        assert cat == "dog_faith"

    def test_speaking_tags_pick_ted_talk(self):
        from clapcheeks.content.categorize import classify_from_tags
        tags = {
            "activities": ["speaking", "presentation"],
            "locations": ["stage", "auditorium"],
            "notable_details": ["microphone", "podium"],
        }
        cat, _ = classify_from_tags(tags)
        assert cat == "ted_talk_speaking"

    def test_food_tags_pick_food_category(self):
        from clapcheeks.content.categorize import classify_from_tags
        tags = {
            "activities": ["dining"],
            "food_signals": ["wine", "sushi"],
            "locations": ["restaurant"],
        }
        cat, _ = classify_from_tags(tags)
        assert cat == "food_drinks_mission_beach"

    def test_categorize_with_vision_uses_injected_fn(self):
        from clapcheeks.content.categorize import categorize_with_vision

        def fake_analyze(_url):
            return {
                "activities": ["surfing"],
                "locations": ["beach"],
                "aesthetic": "athletic",
                "energy": "high",
            }

        out = categorize_with_vision("http://example/pic.jpg", analyze_fn=fake_analyze)
        assert out["category"] == "beach_active"
        assert 0.0 <= out["confidence"] <= 1.0
        assert "tags" in out
