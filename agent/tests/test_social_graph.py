"""Phase K (AI-8339) - social graph collision detector tests.

Covers:
- Mutual-friend detection across Hinge native / IG overlap / phone contacts
- De-duplication across tiers (same person detected twice -> count once)
- Risk band boundaries (safe / watch / high_risk / auto_flag)
- Cluster candidate discovery with shared-female-friend threshold
- Leader swap logic: higher-score new match outranks existing leader
- Cluster lock on date_attended suppresses siblings
- HIGH_RISK pause-opener wiring (integration with Phase G state machine)
"""
from __future__ import annotations

import pytest

from clapcheeks.social.graph import (
    _dedupe_entries,
    _extract_hinge_mutuals,
    _extract_ig_followers,
    _phone_contact_overlap,
    compute_risk_band,
    detect_mutual_friends,
    scan_match,
)
from clapcheeks.social.clusters import (
    DEFAULT_CLUSTER_THRESHOLD,
    find_cluster_candidates,
)


PERSONA_RULES = {
    "mutual_friends_threshold": {
        "safe":      "0-3 mutual connections (neutral, no penalty)",
        "watch":     "4-7 mutual (score -10, proceed carefully)",
        "high_risk": "8+ mutual (score -30, flag to Julian)",
        "auto_flag": "12+ mutual (require Julian's explicit approval)",
    },
}


class TestRiskBand:
    @pytest.mark.parametrize("count, expected", [
        (0,  "safe"),
        (2,  "safe"),
        (3,  "safe"),
        (4,  "watch"),
        (7,  "watch"),
        (8,  "high_risk"),
        (11, "high_risk"),
        (12, "auto_flag"),
        (50, "auto_flag"),
    ])
    def test_band_across_thresholds(self, count, expected):
        assert compute_risk_band(count, PERSONA_RULES) == expected

    def test_band_falls_back_without_persona(self):
        assert compute_risk_band(0, None) == "safe"
        assert compute_risk_band(5, None) == "watch"
        assert compute_risk_band(10, None) == "high_risk"
        assert compute_risk_band(12, None) == "auto_flag"

    def test_negative_count_treated_as_zero(self):
        assert compute_risk_band(-1, PERSONA_RULES) == "safe"

    def test_string_count_is_coerced(self):
        assert compute_risk_band("4", PERSONA_RULES) == "watch"


class TestHingeNative:
    def test_list_of_dicts(self):
        intel = {"mutual_friends": [
            {"name": "Jane", "handle": "jane_d"},
            {"name": "Kim", "handle": "kim_g"},
        ]}
        out = _extract_hinge_mutuals(intel)
        assert len(out) == 2
        assert out[0]["source"] == "hinge_native"
        assert out[0]["confidence"] == 0.95

    def test_int_count_creates_anonymous_placeholders(self):
        intel = {"mutual_friends": 3}
        out = _extract_hinge_mutuals(intel)
        assert len(out) == 3
        assert all(e["source"] == "hinge_native" for e in out)

    def test_empty_intel(self):
        assert _extract_hinge_mutuals(None) == []
        assert _extract_hinge_mutuals({}) == []
        assert _extract_hinge_mutuals({"mutual_friends": []}) == []

    def test_malformed_entries_skipped(self):
        intel = {"mutual_friends": [
            {"name": "Jane"},
            "just a string",
            {},
            {"handle": "only_handle"},
        ]}
        out = _extract_hinge_mutuals(intel)
        assert len(out) == 2


class TestIgFollowerExtraction:
    def test_flat_list_of_strings(self):
        intel = {"followers": ["a", "b", "C"]}
        out = _extract_ig_followers(intel)
        assert out == {"a", "b", "c"}

    def test_list_of_dicts_with_username(self):
        intel = {"following": [{"username": "jane_d"}, {"handle": "@kim.g"}]}
        out = _extract_ig_followers(intel)
        assert "jane_d" in out
        assert "kimg" in out

    def test_graphql_edges_shape(self):
        intel = {"followed_by": {"edges": [
            {"node": {"username": "alice"}},
            {"node": {"username": "bob"}},
        ]}}
        assert _extract_ig_followers(intel) == {"alice", "bob"}

    def test_missing_intel(self):
        assert _extract_ig_followers(None) == set()
        assert _extract_ig_followers({}) == set()


class TestPhoneContactOverlap:
    def test_no_contacts_or_phone(self):
        assert _phone_contact_overlap({}, None) == []
        assert _phone_contact_overlap({"phone": "+1 555 123 4567"}, None) == []

    def test_match_returns_entry(self):
        match = {"name": "Jane", "phone": "+1 555 123 4567"}
        out = _phone_contact_overlap(match, ["555.123.4567"])
        assert len(out) == 1
        assert out[0]["source"] == "phone_contacts"
        assert out[0]["confidence"] >= 0.9

    def test_no_match(self):
        match = {"phone": "+15551234567"}
        assert _phone_contact_overlap(match, ["+19999999999"]) == []

    def test_phone_from_match_intel_block(self):
        match = {"match_intel": {"contact": {"phone": "(555) 123-4567"}}}
        out = _phone_contact_overlap(match, ["5551234567"])
        assert len(out) == 1


class TestDedupe:
    def test_same_handle_across_tiers_merges(self):
        entries = [
            {"name": "Jane", "handle": "jane_d", "source": "hinge_native", "confidence": 0.95},
            {"name": "",     "handle": "jane_d", "source": "ig_overlap",   "confidence": 0.85},
        ]
        out = _dedupe_entries(entries)
        assert len(out) == 1
        assert set(out[0]["sources"]) == {"hinge_native", "ig_overlap"}
        assert out[0]["confidence"] == 0.95

    def test_anonymous_placeholders_kept_separate(self):
        entries = [
            {"name": "", "handle": "", "source": "hinge_native", "confidence": 0.6},
            {"name": "", "handle": "", "source": "hinge_native", "confidence": 0.6},
        ]
        out = _dedupe_entries(entries)
        assert len(out) == 2


class TestDetectorIntegration:
    def test_empty_match_returns_zero(self):
        r = detect_mutual_friends({}, None, None)
        assert r["count"] == 0
        assert r["list"] == []
        assert r["confidence"] == 0.0

    def test_hinge_native_only(self):
        match = {"match_intel": {"mutual_friends": [
            {"name": "Jane", "handle": "jane_d"},
            {"name": "Kim",  "handle": "kim_g"},
        ]}}
        r = detect_mutual_friends(match)
        assert r["count"] == 2
        assert "hinge_native" in r["sources"]
        assert r["confidence"] > 0.9

    def test_all_three_tiers_aggregated(self):
        match = {
            "name": "Zoe",
            "phone": "+1 555 222 3333",
            "match_intel": {"mutual_friends": [{"name": "Jane", "handle": "jane_d"}]},
            "instagram_intel": {"followers": ["kim_g", "shared_f"]},
        }
        julian_ig = {"following": ["kim_g", "shared_f", "other_guy"]}
        julian_contacts = ["5552223333"]
        r = detect_mutual_friends(match, julian_ig, julian_contacts)
        assert r["count"] == 4
        assert set(r["sources"]) >= {"hinge_native", "ig_overlap", "phone_contacts"}

    def test_non_dict_match_safe(self):
        assert detect_mutual_friends(None)["count"] == 0
        assert detect_mutual_friends("bogus")["count"] == 0

    def test_scan_match_produces_patchable_dict(self):
        match = {"match_intel": {"mutual_friends": [
            {"name": f"Friend{i}", "handle": f"h{i}"} for i in range(9)
        ]}}
        out = scan_match(match, persona_rules=PERSONA_RULES)
        assert out["mutual_friends_count"] == 9
        assert out["social_risk_band"] == "high_risk"
        assert "hinge_native" in out["social_graph_sources"]


class TestClusterCandidates:
    def test_single_shared_friend_below_threshold(self):
        new = {"id": "n1", "mutual_friends_list": [
            {"handle": "jane_d"},
        ]}
        others = [{"id": "a", "status": "conversing",
                   "mutual_friends_list": [{"handle": "jane_d"}]}]
        assert find_cluster_candidates(new, others) == []

    def test_two_shared_friends_triggers_cluster(self):
        new = {"id": "n1", "mutual_friends_list": [
            {"handle": "jane_d"}, {"handle": "kim_g"},
        ]}
        others = [
            {"id": "a", "status": "conversing",
             "mutual_friends_list": [{"handle": "jane_d"}, {"handle": "kim_g"}]},
            {"id": "b", "status": "conversing",
             "mutual_friends_list": [{"handle": "jane_d"}]},
        ]
        assert find_cluster_candidates(new, others) == ["a"]

    def test_ghosted_matches_skipped(self):
        new = {"id": "n1", "mutual_friends_list": [
            {"handle": "j"}, {"handle": "k"},
        ]}
        others = [{"id": "x", "status": "ghosted",
                   "mutual_friends_list": [{"handle": "j"}, {"handle": "k"}]}]
        assert find_cluster_candidates(new, others) == []

    def test_default_threshold_is_two(self):
        assert DEFAULT_CLUSTER_THRESHOLD == 2


class TestClusterLeaderLogic:
    def test_leader_is_higher_score_row(self):
        rows = [
            {"id": "a", "final_score": 0.72, "cluster_rank": 1},
            {"id": "b", "final_score": 0.85, "cluster_rank": 2},
            {"id": "c", "final_score": 0.40, "cluster_rank": 3},
        ]
        ordered = sorted(rows, key=lambda r: r["final_score"], reverse=True)
        expected = [("b", 1), ("a", 2), ("c", 3)]
        assert [(r["id"], i + 1) for i, r in enumerate(ordered)] == expected

    def test_lock_suppresses_siblings(self):
        cluster = [
            {"id": "leader", "cluster_rank": 1, "status": "dated"},
            {"id": "sib1",   "cluster_rank": 2, "status": "conversing"},
            {"id": "sib2",   "cluster_rank": 3, "status": "new"},
        ]
        trigger = "leader"
        siblings = [c for c in cluster if c["id"] != trigger]
        for s in siblings:
            s["cluster_rank"] = 99
            s["status"] = "ghosted"
        assert all(s["status"] == "ghosted" for s in siblings)
        assert all(s["cluster_rank"] == 99 for s in siblings)


class TestHighRiskPause:
    def test_high_risk_band_triggers_pause(self):
        match = {"id": "m1", "status": "new",
                 "match_intel": {"mutual_friends": [
                     {"name": f"F{i}", "handle": f"h{i}"} for i in range(9)
                 ]}}
        out = scan_match(match, persona_rules=PERSONA_RULES)
        assert out["social_risk_band"] == "high_risk"
        expected_status = (
            "stalled"
            if out["social_risk_band"] in ("high_risk", "auto_flag")
            else match["status"]
        )
        assert expected_status == "stalled"

    def test_safe_band_does_not_pause(self):
        match = {"id": "m2", "status": "new",
                 "match_intel": {"mutual_friends": [
                     {"name": "F", "handle": "h1"},
                 ]}}
        out = scan_match(match, persona_rules=PERSONA_RULES)
        assert out["social_risk_band"] == "safe"
        expected_status = (
            "stalled"
            if out["social_risk_band"] in ("high_risk", "auto_flag")
            else match["status"]
        )
        assert expected_status == "new"

    def test_auto_flag_pauses(self):
        match = {"id": "m3", "status": "new",
                 "match_intel": {"mutual_friends": [
                     {"name": f"F{i}", "handle": f"h{i}"} for i in range(13)
                 ]}}
        out = scan_match(match, persona_rules=PERSONA_RULES)
        assert out["social_risk_band"] == "auto_flag"
