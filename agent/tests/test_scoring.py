"""Phase I tests for clapcheeks.scoring.

Covers:
- Location piecewise math
- Age / height / body / activity / bonuses rules
- Casual intent tiers (strong, medium, inverse, none)
- Dealbreakers zero out final_score
- Integration: realistic match row -> expected score
- Persona shape compatibility (top-level weights vs nested ranking_weights)
"""
from __future__ import annotations

import pytest

from clapcheeks.scoring import (
    CRITERIA_THEORETICAL_MAX,
    detect_casual_intent,
    detect_dealbreakers,
    haversine_miles,
    resolve_distance_miles,
    score_criteria,
    score_location,
    score_match,
)


# Canonical persona mirrors the row saved to Supabase for Julian.
PERSONA = {
    "ranking_weights": {
        "criteria": {
            "criteria_weight": 0.65,
            "rules": {
                "age_in_range": {"range": [21, 33], "points": 20, "outside_penalty": -40},
                "height_in_range": {
                    "range_in": [63, 69], "points": 10,
                    "outside_penalty": -5, "missing_penalty": 0,
                },
                "body_type_match": {
                    "preferred_tags": ["fit", "thin", "athletic", "active"],
                    "points_per_match": 8,
                },
                "activity_signals": {
                    "preferred": [
                        "beach", "surfing", "yoga", "gym",
                        "outdoors", "hiking", "running", "volleyball",
                    ],
                    "points_per_signal": 4,
                },
                "positive_bonuses": {
                    "christian_signal": {"points": 5},
                    "entrepreneur_signal": {"points": 6},
                    "ambition_signals": {"points": 4},
                    "dog_owner": {"points": 5},
                },
                "casual_intent_signal": {"points": 18},
                "dealbreakers": {
                    "excessive_tattoos": {"auto_pass": True},
                    "smoking_in_photos": {"auto_pass": True},
                    "bio_mentions_kids": {"auto_pass": True},
                    "drug_signals": {"auto_pass": True},
                },
            },
        },
        "location": {
            "anchor_lat": 32.7701,
            "anchor_lng": -117.2520,
            "location_weight": 0.35,
            "max_miles_full_score": 5,
            "max_miles_soft_drop": 15,
            "max_miles_hard_cutoff": 30,
        },
    }
}


# ---------------------------------------------------------------------------
# Location
# ---------------------------------------------------------------------------

class TestLocation:
    def test_zero_distance_full_score(self):
        assert score_location(0, PERSONA["ranking_weights"]) == 1.0

    def test_five_miles_boundary(self):
        assert score_location(5, PERSONA["ranking_weights"]) == 1.0

    def test_ten_miles_linear_midpoint(self):
        s = score_location(10, PERSONA["ranking_weights"])
        assert s == pytest.approx(0.65, rel=1e-3)

    def test_fifteen_miles_soft_floor(self):
        s = score_location(15, PERSONA["ranking_weights"])
        assert s == pytest.approx(0.3, rel=1e-3)

    def test_twenty_miles_between_soft_and_hard(self):
        s = score_location(20, PERSONA["ranking_weights"])
        assert s == pytest.approx(0.2333, rel=1e-2)

    def test_thirty_miles_hard_floor(self):
        s = score_location(30, PERSONA["ranking_weights"])
        assert s == pytest.approx(0.1, rel=1e-3)

    def test_fifty_miles_zero(self):
        assert score_location(50, PERSONA["ranking_weights"]) == 0.0

    def test_unknown_distance_zero(self):
        assert score_location(None, PERSONA["ranking_weights"]) == 0.0

    def test_haversine_known_distance(self):
        d = haversine_miles(32.7701, -117.2520, 32.7157, -117.1611)
        assert 4 < d < 8

    def test_resolve_from_match_distance_miles(self):
        d = resolve_distance_miles({"distance_miles": 7.2}, PERSONA["ranking_weights"])
        assert d == 7.2

    def test_resolve_from_lat_lng(self):
        row = {"latitude": 32.7157, "longitude": -117.1611}
        d = resolve_distance_miles(row, PERSONA["ranking_weights"])
        assert d is not None
        assert 4 < d < 8

    def test_resolve_from_intel_km(self):
        row = {"match_intel": {"distance_km": 10}}
        d = resolve_distance_miles(row, PERSONA["ranking_weights"])
        assert d == pytest.approx(6.21, rel=1e-2)


# ---------------------------------------------------------------------------
# Criteria rules
# ---------------------------------------------------------------------------

class TestAge:
    def test_in_range(self):
        _, detail = score_criteria({"age": 26}, PERSONA["ranking_weights"])
        assert detail["breakdown"].get("age_in_range") == 20

    def test_below_range(self):
        _, detail = score_criteria({"age": 19}, PERSONA["ranking_weights"])
        assert detail["breakdown"].get("age_in_range") == -40

    def test_above_range(self):
        _, detail = score_criteria({"age": 40}, PERSONA["ranking_weights"])
        assert detail["breakdown"].get("age_in_range") == -40

    def test_missing_age(self):
        _, detail = score_criteria({}, PERSONA["ranking_weights"])
        assert "age_in_range" not in detail["breakdown"]


class TestHeight:
    def test_in_range(self):
        _, d = score_criteria({"height_in": 66}, PERSONA["ranking_weights"])
        assert d["breakdown"].get("height_in_range") == 10

    def test_outside_range(self):
        _, d = score_criteria({"height_in": 72}, PERSONA["ranking_weights"])
        assert d["breakdown"].get("height_in_range") == -5

    def test_from_match_intel(self):
        row = {"match_intel": {"height_in": 65}}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("height_in_range") == 10

    def test_missing_height_no_penalty(self):
        _, d = score_criteria({}, PERSONA["ranking_weights"])
        assert d["breakdown"].get("height_in_range", 0) == 0


class TestBodyType:
    def test_single_tag_match(self):
        row = {"vision_summary": ["fit"]}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("body_type_match") == 8

    def test_multiple_tag_match(self):
        row = {"vision_summary": ["fit", "athletic"]}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("body_type_match") == 16

    def test_no_match(self):
        row = {"vision_summary": ["curvy"]}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert "body_type_match" not in d["breakdown"]

    def test_vision_summary_as_csv_string(self):
        row = {"vision_summary": "fit, athletic"}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("body_type_match") == 16

    def test_vision_summary_as_json_string(self):
        row = {"vision_summary": '["fit", "thin"]'}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("body_type_match") == 16


class TestActivitySignals:
    def test_vision_only(self):
        row = {"vision_summary": ["beach", "gym"]}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("activity_signals") == 8

    def test_instagram_only(self):
        row = {"instagram_intel": {"interests": ["yoga", "hiking"]}}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("activity_signals") == 8

    def test_union_of_sources(self):
        row = {
            "vision_summary": ["beach"],
            "instagram_intel": {"interests": ["yoga"]},
        }
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("activity_signals") == 8


class TestBonuses:
    def test_christian(self):
        row = {"bio": "Jesus is my savior. Church on Sundays."}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("christian_signal") == 5

    def test_entrepreneur(self):
        row = {"bio": "Founder of my own business"}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("entrepreneur_signal") == 6

    def test_ambition(self):
        row = {"bio": "Ambitious and goal-oriented"}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("ambition_signals") == 4

    def test_dog_owner_text(self):
        row = {"bio": "My dog is my whole world"}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("dog_owner") == 5

    def test_dog_owner_vision(self):
        row = {"vision_summary": ["dog", "beach"]}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("dog_owner") == 5


# ---------------------------------------------------------------------------
# Casual intent
# ---------------------------------------------------------------------------

class TestCasualIntent:
    def test_strong_hookup_language(self):
        tier, _ = detect_casual_intent("No strings attached, down for whatever")
        assert tier == "strong"

    def test_strong_visiting(self):
        tier, _ = detect_casual_intent("Visiting San Diego this weekend")
        assert tier == "strong"

    def test_strong_short_term(self):
        tier, _ = detect_casual_intent("Looking for something casual, short-term vibes")
        assert tier == "strong"

    def test_medium_new_in_town(self):
        tier, _ = detect_casual_intent("New to SD, looking to explore")
        assert tier == "medium"

    def test_medium_bachelorette(self):
        tier, _ = detect_casual_intent("Here for a bachelorette")
        assert tier == "medium"

    def test_inverse_serious(self):
        tier, _ = detect_casual_intent("Looking for something serious, my person")
        assert tier == "inverse"

    def test_inverse_beats_strong(self):
        tier, _ = detect_casual_intent(
            "Visiting SD but here for something real, no hookups"
        )
        assert tier == "inverse"

    def test_none(self):
        tier, _ = detect_casual_intent("I love dogs and hiking.")
        assert tier == "none"

    def test_strong_points_in_criteria(self):
        row = {"bio": "No strings, just having fun"}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("casual_intent_strong") == 18

    def test_medium_points_in_criteria(self):
        row = {"bio": "Just moved to San Diego"}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("casual_intent_medium") == 10

    def test_inverse_penalty_in_criteria(self):
        row = {"bio": "Not here for hookups"}
        _, d = score_criteria(row, PERSONA["ranking_weights"])
        assert d["breakdown"].get("casual_intent_inverse") == -25


# ---------------------------------------------------------------------------
# Dealbreakers
# ---------------------------------------------------------------------------

class TestDealbreakers:
    def test_kids_in_bio(self):
        row = {"bio": "Single mom of two beautiful kids"}
        flags = detect_dealbreakers(row)
        assert "bio_mentions_kids" in flags

    def test_kids_emoji_phrase(self):
        row = {"bio": "I have two kids, they come first"}
        flags = detect_dealbreakers(row)
        assert "bio_mentions_kids" in flags

    def test_drugs_in_bio(self):
        row = {"bio": "420 friendly, wake and bake"}
        flags = detect_dealbreakers(row)
        assert "drug_signals" in flags

    def test_excessive_tattoos_vision(self):
        row = {"vision_summary": ["excessive_tattoos"]}
        flags = detect_dealbreakers(row)
        assert "excessive_tattoos" in flags

    def test_smoking_vision(self):
        row = {"vision_summary": ["smoking"]}
        flags = detect_dealbreakers(row)
        assert "smoking_in_photos" in flags

    def test_clean_match_no_flags(self):
        row = {"bio": "Love yoga and my dog", "vision_summary": ["fit", "beach"]}
        assert detect_dealbreakers(row) == []

    def test_dealbreaker_zeroes_final_score(self):
        row = {
            "age": 26,
            "height_in": 66,
            "vision_summary": ["fit", "beach"],
            "bio": "Single mom of two. Love yoga.",
            "distance_miles": 3,
        }
        result = score_match(row, PERSONA)
        assert result["final_score"] == 0.0
        assert "bio_mentions_kids" in result["dealbreaker_flags"]
        assert result["location_score"] == 1.0


# ---------------------------------------------------------------------------
# Integration
# ---------------------------------------------------------------------------

class TestIntegration:
    def test_ideal_casual_match(self):
        row = {
            "age": 26,
            "height_in": 66,
            "distance_miles": 3,
            "vision_summary": ["fit", "beach", "yoga"],
            "bio": "Visiting San Diego this week. Love my dog. Building my own business.",
        }
        result = score_match(row, PERSONA)
        assert result["final_score"] > 0.6
        assert result["location_score"] == 1.0
        assert result["distance_miles"] == 3
        assert "casual intent (strong)" in result["scoring_reason"]
        assert result["dealbreaker_flags"] == []

    def test_weak_match_far_away(self):
        row = {
            "age": 40,
            "distance_miles": 25,
            "bio": "Looking for something serious",
        }
        result = score_match(row, PERSONA)
        assert result["final_score"] < 0.15
        assert result["criteria_score"] == 0.0
        assert "serious-only" in result["scoring_reason"]

    def test_out_of_range_zero(self):
        row = {"age": 26, "distance_miles": 50}
        result = score_match(row, PERSONA)
        assert result["location_score"] == 0.0
        assert result["final_score"] < 0.15

    def test_empty_match_row(self):
        row = {}
        result = score_match(row, PERSONA)
        assert result["final_score"] == 0.0
        assert result["dealbreaker_flags"] == []

    def test_persona_without_ranking_weights_wrapper(self):
        direct = PERSONA["ranking_weights"]
        row = {"age": 26, "distance_miles": 3}
        result = score_match(row, direct)
        assert result["location_score"] == 1.0
        assert result["criteria_score"] > 0.0

    def test_final_score_formula(self):
        row = {"age": 26, "distance_miles": 3}
        result = score_match(row, PERSONA)
        expected_final = 0.35 * 1.0 + 0.65 * (20 / CRITERIA_THEORETICAL_MAX)
        assert result["final_score"] == pytest.approx(expected_final, rel=1e-2)

    def test_scoring_reason_mentions_distance(self):
        row = {"age": 26, "distance_miles": 3}
        result = score_match(row, PERSONA)
        assert "3.0mi" in result["scoring_reason"] or "3mi" in result["scoring_reason"]

    def test_casual_intent_boost_beats_just_base(self):
        base = {"age": 26, "height_in": 66, "distance_miles": 3}
        with_casual = dict(base, bio="In town for the weekend")
        r1 = score_match(base, PERSONA)
        r2 = score_match(with_casual, PERSONA)
        assert r2["final_score"] > r1["final_score"]
        assert r2["criteria_score"] > r1["criteria_score"]

    def test_dealbreaker_kills_even_with_high_base(self):
        row = {
            "age": 26,
            "height_in": 66,
            "distance_miles": 2,
            "vision_summary": ["fit", "beach", "yoga", "outdoors"],
            "bio": "Visiting for the weekend. Christian. Dog mom. 420 friendly.",
        }
        result = score_match(row, PERSONA)
        assert result["final_score"] == 0.0
        assert "drug_signals" in result["dealbreaker_flags"]


# ---------------------------------------------------------------------------
# Custom persona edge cases
# ---------------------------------------------------------------------------

class TestPersonaVariations:
    def test_empty_persona_defaults(self):
        row = {"age": 26, "distance_miles": 3}
        result = score_match(row, {})
        assert result["location_score"] == 1.0
        assert result["criteria_score"] == 0.0

    def test_normalization_cap_at_1(self):
        row = {
            "age": 26,
            "height_in": 66,
            "vision_summary": [
                "fit", "thin", "athletic", "active",
                "beach", "surfing", "yoga", "gym",
                "outdoors", "hiking", "running", "volleyball",
                "dog",
            ],
            "bio": (
                "Christian entrepreneur founder, ambitious and driven. "
                "In town for the weekend, no strings attached."
            ),
        }
        s, _ = score_criteria(row, PERSONA["ranking_weights"])
        assert s <= 1.0
