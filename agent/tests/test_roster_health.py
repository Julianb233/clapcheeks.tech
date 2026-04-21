"""Phase J (AI-8338): health score math tests.

Pure-function tests - no Supabase, no network. Covers:
  * Neutral defaults (no data) produce a mid-range score
  * Fresh + fast-reply + warming raises score
  * Silence decays recency ~2 pts/day
  * Stage multipliers feed close_probability
  * Extreme ratios penalized
"""
from datetime import datetime, timedelta, timezone

from clapcheeks.roster.health import (
    compute_health_breakdown,
    compute_health_score,
    compute_close_probability,
    STAGE_MULTIPLIER,
)


NOW = datetime(2026, 4, 21, 12, 0, 0, tzinfo=timezone.utc)


def _base_match(**overrides) -> dict:
    base = {
        "id": "m1",
        "stage": "chatting",
        "status": "conversing",
        "final_score": 70,
        "last_activity_at": NOW.isoformat(),
        "avg_reply_hours": 2.0,
        "messages_7d": 12,
        "his_to_her_ratio": 1.0,
        "sentiment_trajectory": "warming",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Health score - core
# ---------------------------------------------------------------------------

def test_health_score_in_range_with_no_data():
    score = compute_health_score({}, events=[], now=NOW)
    assert 0 <= score <= 100
    # With all defaults neutral, we should land somewhere mid-range.
    assert 30 <= score <= 70


def test_health_score_peaks_with_ideal_inputs():
    match = _base_match(
        avg_reply_hours=0.4,
        his_to_her_ratio=1.0,
        sentiment_trajectory="warming",
        messages_7d=40,
        response_rate=1.0,
    )
    score = compute_health_score(match, events=[], now=NOW)
    assert score >= 90


def test_health_score_floors_with_silence_and_cooling():
    match = _base_match(
        last_activity_at=(NOW - timedelta(days=40)).isoformat(),
        avg_reply_hours=60.0,
        sentiment_trajectory="cooling",
        messages_7d=0,
        his_to_her_ratio=0.05,
        response_rate=0.0,
    )
    score = compute_health_score(match, events=[], now=NOW)
    assert score <= 20


def test_silence_decays_approximately_two_points_per_day():
    # 7 days of silence should cost ~2 pts * 7 days = 14 pts via the
    # recency signal (weight 20). 14 * 0.20 = 2.8 on the 0-100 score.
    fresh = compute_health_score(_base_match(), events=[], now=NOW)
    stale = compute_health_score(
        _base_match(last_activity_at=(NOW - timedelta(days=7)).isoformat()),
        events=[],
        now=NOW,
    )
    diff = fresh - stale
    # Allow a wide band - the math is scaled, not exact 2 pts/day top-line.
    assert 2 <= diff <= 6


def test_events_derive_response_rate_when_missing():
    # Five outgoing, five incoming -> response_rate 1.0 (capped at 1).
    events = [{"direction": "outgoing"}] * 5 + [{"direction": "incoming"}] * 5
    match = _base_match(response_rate=None)
    score_with_events = compute_health_score(match, events=events, now=NOW)
    # Same match with only outgoing (no replies) should score lower.
    score_no_replies = compute_health_score(
        match, events=[{"direction": "outgoing"}] * 5, now=NOW
    )
    assert score_with_events > score_no_replies


def test_extreme_his_to_her_ratio_penalized():
    ideal = compute_health_score(_base_match(his_to_her_ratio=1.0), events=[], now=NOW)
    extreme = compute_health_score(_base_match(his_to_her_ratio=5.0), events=[], now=NOW)
    assert ideal > extreme


def test_breakdown_shape():
    hb = compute_health_breakdown(_base_match(), events=[], now=NOW)
    d = hb.as_dict()
    for key in ("response_rate", "reply_speed", "recency",
                "engagement", "sentiment", "his_her", "total"):
        assert key in d
    assert d["total"] == hb.total


# ---------------------------------------------------------------------------
# Close probability
# ---------------------------------------------------------------------------

def test_close_probability_respects_stage_multiplier():
    date_booked = compute_close_probability(
        _base_match(stage="date_booked", final_score=80),
        health_score=80,
    )
    archived = compute_close_probability(
        _base_match(stage="archived", final_score=80),
        health_score=80,
    )
    assert date_booked > 0.5
    assert archived == 0.0


def test_close_probability_bounded_0_1():
    # Saturate everything.
    cp = compute_close_probability(
        _base_match(stage="date_booked", final_score=100),
        health_score=100,
    )
    assert 0.0 <= cp <= 1.0


def test_stage_multiplier_table_covers_all_supported_stages():
    expected = {
        "new_match", "chatting", "chatting_phone", "date_proposed",
        "date_booked", "date_attended", "hooked_up", "recurring",
        "faded", "ghosted", "archived", "archived_cluster_dupe",
    }
    assert expected.issubset(set(STAGE_MULTIPLIER.keys()))


# ---------------------------------------------------------------------------
# Bonus factors
# ---------------------------------------------------------------------------

def test_boundary_auto_archive():
    from clapcheeks.roster.bonus import should_auto_archive_for_boundary

    assert should_auto_archive_for_boundary(["a", "b", "c"]) is True
    assert should_auto_archive_for_boundary(["a", "b"]) is False
    assert should_auto_archive_for_boundary([]) is False
    assert should_auto_archive_for_boundary(None) is False


def test_geo_clusters_group_nearby_matches():
    from clapcheeks.roster.bonus import assign_geo_clusters

    # Two matches in SD, one in LA. SD pair should share a cluster; LA
    # stays solo (no cluster id).
    matches = [
        {"id": "a", "lat": 32.7157, "lon": -117.1611},  # downtown SD
        {"id": "b", "lat": 32.7200, "lon": -117.1650},  # ~0.4mi away
        {"id": "c", "lat": 34.0522, "lon": -118.2437},  # LA
    ]
    clusters = assign_geo_clusters(matches, radius_mi=2.0)
    assert "a" in clusters
    assert "b" in clusters
    assert clusters["a"] == clusters["b"]
    assert "c" not in clusters
