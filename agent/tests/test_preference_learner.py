"""Phase H (AI-8322) tests — ML preference learner.

Covers:
- Feature extractor on sample match rows produces expected keys + ranges.
- Synthetic 500-decision corpus trains to >70% held-out accuracy.
- score_with_model is deterministic (same inputs -> same float).
- Insufficient-data / degenerate cases return None.
- blend_with_rules weights shift correctly across decision-count bands.
- Phase I scoring still works when preference_model_v is null (no regression).
"""
from __future__ import annotations

import json
import random
from typing import Any

import pytest

from clapcheeks.ml.features import (
    ACTIVITY_TAGS,
    BODY_TAGS,
    VISION_VOCAB,
    extract_features,
    feature_keys,
    features_to_vector,
)
from clapcheeks.ml.trainer import (
    BLEND_BANDS,
    blend_with_rules,
    fit_in_memory,
    score_with_model,
)
from clapcheeks.scoring import score_match


# ---------------------------------------------------------------------------
# Feature extractor
# ---------------------------------------------------------------------------

def test_feature_keys_are_deterministic_and_unique():
    keys = feature_keys()
    assert len(keys) == len(set(keys))
    assert "age_norm" in keys
    assert "distance_norm" in keys
    assert "casual_intent_score" in keys
    for t in BODY_TAGS:
        assert f"body_{t}" in keys
    for t in ACTIVITY_TAGS:
        assert f"activity_{t}" in keys
    for t in VISION_VOCAB:
        assert f"vision_{t}" in keys
    vec = features_to_vector({}, keys)
    assert len(vec) == len(keys)


def test_extract_features_sample_match_in_range():
    match = {
        "age": 27,
        "distance_miles": 5.4,
        "height_in": 66,
        "bio": "Christian, dog mom, entrepreneur building something big.",
        "vision_summary": ["fit", "beach", "yoga"],
        "instagram_intel": {
            "post_count": 120,
            "following_count": 500,
            "follower_count": 2400,
            "interests": ["yoga", "gym"],
        },
        "photos_jsonb": [{"url": f"https://x/{i}.jpg"} for i in range(6)],
        "final_score": 0.78,
    }
    feats = extract_features(match)
    assert 0.0 <= feats["age_norm"] <= 1.0
    assert feats["age_in_range"] == 1.0
    assert feats["distance_in_range"] == 1.0
    assert feats["height_in_range"] == 1.0
    assert feats["christian_signal"] == 1.0
    assert feats["entrepreneur_signal"] == 1.0
    assert feats["dog_signal"] == 1.0
    assert feats["ambition_signal"] == 1.0
    assert feats["body_fit"] == 1.0
    assert feats["activity_beach"] == 1.0
    assert feats["activity_yoga"] == 1.0
    assert feats["activity_gym"] == 1.0
    assert feats["rule_final_score"] == pytest.approx(0.78)
    for v in feats.values():
        assert isinstance(v, float)


def test_extract_features_handles_string_vision_json():
    match = {"age": 25, "vision_summary": '["fit", "gym"]'}
    feats = extract_features(match)
    assert feats["body_fit"] == 1.0
    assert feats["activity_gym"] == 1.0


def test_extract_features_empty_row_is_all_zero():
    feats = extract_features({})
    for k, v in feats.items():
        assert v == 0.0, f"{k} leaked non-zero on empty row: {v}"


# ---------------------------------------------------------------------------
# Trainer: synthetic corpus
# ---------------------------------------------------------------------------

def _synthetic_pair(label: int, rng: random.Random) -> dict[str, Any]:
    if label == 1:
        return {
            "age": rng.randint(22, 32),
            "distance_miles": rng.uniform(0.0, 12.0),
            "height_in": rng.randint(63, 69),
            "bio": rng.choice([
                "Christian, entrepreneur, dog mom",
                "Ambitious founder, hustling",
                "Driven and goal-oriented, dog is my world",
                "Gym, yoga, beach -- loving life",
            ]),
            "vision_summary": rng.choice([
                ["fit", "beach", "yoga"],
                ["athletic", "gym", "surfing"],
                ["fit", "hiking", "outdoors"],
                ["active", "running", "volleyball"],
            ]),
            "final_score": rng.uniform(0.55, 0.95),
        }
    return {
        "age": rng.choice([rng.randint(18, 20), rng.randint(35, 50)]),
        "distance_miles": rng.uniform(25.0, 50.0),
        "height_in": rng.choice([58, 59, 71, 72]),
        "bio": rng.choice([
            "Looking for something serious, no hookups",
            "Single mom, my kids are my world",
            "420 friendly, wake and bake",
            "Just looking for my person, long-term",
        ]),
        "vision_summary": rng.choice([
            ["curvy"],
            ["plus_size"],
            [],
            ["smoking"],
        ]),
        "final_score": rng.uniform(0.05, 0.35),
    }


def _synthetic_dataset(n: int, seed: int = 7) -> list[tuple[dict, int]]:
    rng = random.Random(seed)
    rows: list[tuple[dict, int]] = []
    for i in range(n):
        label = 1 if i % 2 == 0 else 0
        match = _synthetic_pair(label, rng)
        rows.append((extract_features(match), label))
    rng.shuffle(rows)
    return rows


def test_fit_in_memory_500_synthetic_decisions_above_70_percent():
    rows = _synthetic_dataset(500, seed=13)
    model_v = fit_in_memory(rows, seed=13, min_decisions=200)
    assert model_v is not None
    assert model_v["model_type"] in ("logreg", "gbm")
    assert model_v["accuracy"] > 0.70, (
        f"held-out accuracy too low: {model_v['accuracy']:.3f}"
    )
    assert model_v["n_samples"] == 500
    assert "feature_keys" in model_v
    blob = json.dumps(model_v)
    reloaded = json.loads(blob)
    assert reloaded["accuracy"] == model_v["accuracy"]


def test_score_with_model_deterministic():
    rows = _synthetic_dataset(300, seed=21)
    model_v = fit_in_memory(rows, seed=21, min_decisions=200)
    assert model_v is not None
    feats = rows[0][0]
    a = score_with_model(feats, model_v)
    b = score_with_model(feats, model_v)
    assert a == b
    assert 0.0 <= a <= 1.0


def test_score_with_model_returns_none_on_missing_or_malformed():
    assert score_with_model({}, None) is None
    assert score_with_model({}, {}) is None
    assert score_with_model({}, {"model_type": "logreg"}) is None
    assert score_with_model({}, {"feature_keys": ["a"], "model_type": "mystery"}) is None


def test_fit_in_memory_insufficient_data_returns_none():
    rows = _synthetic_dataset(50, seed=3)
    assert fit_in_memory(rows, min_decisions=200) is None


def test_fit_in_memory_single_class_returns_none():
    rng = random.Random(99)
    rows = [(extract_features(_synthetic_pair(1, rng)), 1) for _ in range(250)]
    assert fit_in_memory(rows, min_decisions=200) is None


# ---------------------------------------------------------------------------
# Blend bands
# ---------------------------------------------------------------------------

def test_blend_with_rules_pure_rules_below_200():
    for n in (0, 1, 50, 199):
        assert blend_with_rules(0.4, 0.9, n) == pytest.approx(0.4)


def test_blend_with_rules_partial_weight_200_to_499():
    blended = blend_with_rules(rule_score=0.2, model_score=0.8, n_decisions=250)
    assert blended == pytest.approx(0.3 * 0.8 + 0.7 * 0.2)


def test_blend_with_rules_parity_above_500():
    blended = blend_with_rules(rule_score=0.0, model_score=1.0, n_decisions=600)
    assert blended == pytest.approx(0.5)
    blended2 = blend_with_rules(rule_score=1.0, model_score=0.0, n_decisions=10_000)
    assert blended2 == pytest.approx(0.5)


def test_blend_with_rules_none_model_is_safe():
    assert blend_with_rules(0.42, None, 1_000) == pytest.approx(0.42)


def test_blend_bands_monotonic():
    floors = [b[0] for b in BLEND_BANDS]
    assert floors == sorted(floors, reverse=True)
    model_weights_by_floor = {b[0]: b[1] for b in BLEND_BANDS}
    assert model_weights_by_floor[500] >= model_weights_by_floor[200]
    assert model_weights_by_floor[200] >= model_weights_by_floor[0]


# ---------------------------------------------------------------------------
# Phase I regression
# ---------------------------------------------------------------------------

_PERSONA = {
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
                    "preferred": ["beach", "surfing", "yoga", "gym"],
                    "points_per_signal": 4,
                },
            },
        },
        "location": {
            "location_weight": 0.35,
            "max_miles_full_score": 5,
            "max_miles_soft_drop": 15,
            "max_miles_hard_cutoff": 30,
        },
    },
}


def test_score_match_still_works_with_null_model():
    match = {"age": 26, "distance_miles": 4.0, "height_in": 66, "vision_summary": ["fit"]}
    result = score_match(match, _PERSONA, preference_model_v=None, n_decisions=0)
    assert "final_score" in result
    assert 0.0 <= result["final_score"] <= 1.0
    assert result["model_score"] is None
    assert "rule_score" in result


def test_score_match_blends_when_model_present():
    rows = _synthetic_dataset(400, seed=5)
    model_v = fit_in_memory(rows, seed=5, min_decisions=200)
    assert model_v is not None
    match = {"age": 26, "distance_miles": 4.0, "height_in": 66, "vision_summary": ["fit"]}
    result = score_match(
        match, _PERSONA, preference_model_v=model_v, n_decisions=400,
    )
    assert result["model_score"] is not None
    assert 0.0 <= result["final_score"] <= 1.0
    assert result["rule_score"] >= 0.1
