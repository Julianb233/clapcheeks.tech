"""AI-8814 — Tests for attribute extractor.

Tests the pure-function logic (parse, merge, dismiss) without hitting the API.
The _call_claude_extract function is mocked so these tests run in CI without
an API key.

Target: >=80% precision across all 6 categories on fixture conversations.
"""
from __future__ import annotations

import pytest
from unittest.mock import patch

from clapcheeks.intel.attributes import (
    AttributeItem,
    AttributeUpdate,
    extract_attributes,
    merge_attributes,
    dismiss_attribute,
    _parse_extract_result,
    _filter_dismissed,
    _get_dismissed_set,
    DEFAULT_CATEGORIES,
    MIN_CONFIDENCE,
)


# ---------------------------------------------------------------------------
# Fixture conversations
# ---------------------------------------------------------------------------

FIXTURE_VEGAN = [
    {"sender": "her", "body": "I've been vegan for like 3 years now"},
    {"sender": "us", "body": "Nice, any good spots you like?"},
    {"sender": "her", "body": "I love Gracias Madre, it's fully plant-based"},
]

FIXTURE_SOBER = [
    {"sender": "her", "body": "I don't really drink at all actually"},
    {"sender": "us", "body": "Cool, so coffee date then?"},
    {"sender": "her", "body": "Haha yes exactly, I'm basically sober"},
]

FIXTURE_ALCOHOL_FREE_DRY_JAN = [
    {"sender": "her", "body": "I did dry January and honestly just kept it going"},
    {"sender": "us", "body": "That's impressive"},
    {"sender": "her", "body": "Yeah I'm alcohol-free now, feel so much better"},
]

FIXTURE_NUT_ALLERGY = [
    {"sender": "her", "body": "Oh heads up I have a severe nut allergy"},
    {"sender": "us", "body": "Good to know, I'll keep that in mind"},
    {"sender": "her", "body": "Yeah I carry an epipen everywhere"},
]

FIXTURE_CELIAC = [
    {"sender": "her", "body": "I have celiac disease so no gluten for me"},
    {"sender": "us", "body": "Ah got it, Italian places are out then?"},
    {"sender": "her", "body": "Most yeah, unless they have GF pasta"},
]

FIXTURE_MORNING_PERSON = [
    {"sender": "her", "body": "I'm such a morning person lol"},
    {"sender": "us", "body": "Like how early?"},
    {"sender": "her", "body": "I'm up at 5:30 to workout before work"},
]

FIXTURE_REMOTE = [
    {"sender": "her", "body": "I work from home so my schedule is pretty flexible"},
    {"sender": "us", "body": "Oh that's nice"},
    {"sender": "her", "body": "Yeah remote work is the best, I can do weekday lunches easily"},
]

FIXTURE_DOG = [
    {"sender": "her", "body": "My dog Charlie is basically my whole personality"},
    {"sender": "us", "body": "Haha what kind?"},
    {"sender": "her", "body": "He's a golden, absolutely obsessed with him"},
]

FIXTURE_420 = [
    {"sender": "her", "body": "I'm 420 friendly if that matters to you"},
    {"sender": "us", "body": "Totally fine with me"},
    {"sender": "her", "body": "Cool, I just wanted to be upfront"},
]

FIXTURE_KIDS = [
    {"sender": "her", "body": "I have a 4 year old so my schedule can be a bit chaotic"},
    {"sender": "us", "body": "Totally understand"},
    {"sender": "her", "body": "Weekends are usually his dad's so I'm free then"},
]

FIXTURE_SLOW_TEXTER = [
    {"sender": "her", "body": "Warning I'm terrible at texting lol"},
    {"sender": "us", "body": "Haha noted"},
    {"sender": "her", "body": "Like I'll reply eventually just don't take it personally"},
]

FIXTURE_RESTAURANT_FAN = [
    {"sender": "her", "body": "I love that vegan restaurant on 3rd"},
    {"sender": "us", "body": "Oh yeah I've heard of it"},
    {"sender": "her", "body": "Their burgers are so good"},
]

FIXTURE_EMPTY = [
    {"sender": "her", "body": "Hey how's your week going?"},
    {"sender": "us", "body": "Pretty good! How about you?"},
    {"sender": "her", "body": "Not bad, busy but good"},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_raw(category_results: dict) -> dict:
    base = {cat: [] for cat in DEFAULT_CATEGORIES}
    base.update(category_results)
    return base


def _item(value: str, confidence: float, excerpt: str = "...", idx: int = 0) -> dict:
    return {
        "value": value,
        "confidence": confidence,
        "source_msg_excerpt": excerpt,
        "source_msg_index": idx,
    }


# ---------------------------------------------------------------------------
# Unit tests: _parse_extract_result
# ---------------------------------------------------------------------------

class TestParseExtractResult:
    def test_vegan_dietary(self):
        raw = _make_raw({"dietary": [_item("vegan", 0.95, "I've been vegan for 3 years")]})
        result = _parse_extract_result(raw, DEFAULT_CATEGORIES)
        assert len(result.dietary) == 1
        assert result.dietary[0].value == "vegan"
        assert result.dietary[0].confidence == pytest.approx(0.95)

    def test_allergy_life_safety(self):
        raw = _make_raw({"allergy": [_item("nut allergy", 1.0, "I have a severe nut allergy")]})
        result = _parse_extract_result(raw, DEFAULT_CATEGORIES)
        assert len(result.allergy) == 1
        assert result.allergy[0].value == "nut allergy"

    def test_filters_low_confidence(self):
        raw = _make_raw({"dietary": [
            _item("vegan", 0.30, "..."),
            _item("sober", 0.80, "I don't drink"),
        ]})
        result = _parse_extract_result(raw, DEFAULT_CATEGORIES)
        assert len(result.dietary) == 1
        assert result.dietary[0].value == "sober"

    def test_empty_categories(self):
        raw = _make_raw({})
        result = _parse_extract_result(raw, DEFAULT_CATEGORIES)
        assert result.dietary == []
        assert result.allergy == []
        assert result.avg_confidence == pytest.approx(0.0)

    def test_avg_confidence_calculated(self):
        raw = _make_raw({"dietary": [
            _item("vegan", 0.9, "..."),
            _item("sober", 0.7, "..."),
        ]})
        result = _parse_extract_result(raw, DEFAULT_CATEGORIES)
        assert result.avg_confidence == pytest.approx(0.8)

    def test_source_excerpt_truncated_to_100(self):
        long = "x" * 200
        raw = _make_raw({"lifestyle": [_item("has a dog", 0.9, long)]})
        result = _parse_extract_result(raw, DEFAULT_CATEGORIES)
        assert len(result.lifestyle[0].source_msg_excerpt) <= 100

    def test_value_truncated_to_60(self):
        raw = _make_raw({"schedule": [_item("a" * 100, 0.9, "...")]})
        result = _parse_extract_result(raw, DEFAULT_CATEGORIES)
        assert len(result.schedule[0].value) <= 60


# ---------------------------------------------------------------------------
# Unit tests: dismissed guard
# ---------------------------------------------------------------------------

class TestDismissed:
    def test_get_dismissed_empty(self):
        assert _get_dismissed_set(None) == set()
        assert _get_dismissed_set({}) == set()

    def test_get_dismissed_set(self):
        prior = {"_dismissed": [
            {"category": "dietary", "value": "vegan"},
            {"category": "allergy", "value": "nut allergy"},
        ]}
        dismissed = _get_dismissed_set(prior)
        assert "dietary:vegan" in dismissed
        assert "allergy:nut allergy" in dismissed

    def test_filter_dismissed_removes_item(self):
        update = AttributeUpdate(
            dietary=[AttributeItem("vegan", 0.9, "...", 0)],
            allergy=[AttributeItem("nut allergy", 1.0, "...", 1)],
        )
        dismissed = {"dietary:vegan"}
        result = _filter_dismissed(update, dismissed)
        assert result.dietary == []
        assert len(result.allergy) == 1

    def test_filter_dismissed_case_insensitive(self):
        update = AttributeUpdate(
            dietary=[AttributeItem("Vegan", 0.9, "...", 0)],
        )
        dismissed = {"dietary:vegan"}
        result = _filter_dismissed(update, dismissed)
        assert result.dietary == []


# ---------------------------------------------------------------------------
# Unit tests: merge_attributes
# ---------------------------------------------------------------------------

class TestMergeAttributes:
    def test_merge_empty_prior(self):
        delta = AttributeUpdate(dietary=[AttributeItem("vegan", 0.9, "...", 0)])
        merged = merge_attributes({}, delta)
        assert len(merged["dietary"]) == 1
        assert merged["dietary"][0]["value"] == "vegan"

    def test_merge_deduplicates_by_value(self):
        prior = {"dietary": [{"value": "vegan", "confidence": 0.7, "source_msg_excerpt": "old", "source_msg_index": 0}]}
        delta = AttributeUpdate(dietary=[AttributeItem("vegan", 0.95, "newer excerpt", 5)])
        merged = merge_attributes(prior, delta)
        assert len(merged["dietary"]) == 1
        assert merged["dietary"][0]["confidence"] == pytest.approx(0.95)

    def test_merge_preserves_prior_not_in_delta(self):
        prior = {
            "dietary": [{"value": "sober", "confidence": 0.9, "source_msg_excerpt": "...", "source_msg_index": 0}],
        }
        delta = AttributeUpdate(dietary=[AttributeItem("vegan", 0.85, "...", 5)])
        merged = merge_attributes(prior, delta)
        values = [i["value"] for i in merged["dietary"]]
        assert "sober" in values
        assert "vegan" in values

    def test_merge_carries_over_dismissed(self):
        prior = {"_dismissed": [{"category": "dietary", "value": "vegan", "dismissed_at": "2026-01-01T00:00:00Z"}]}
        delta = AttributeUpdate()
        merged = merge_attributes(prior, delta)
        assert len(merged["_dismissed"]) == 1

    def test_merge_sets_extracted_at(self):
        delta = AttributeUpdate()
        merged = merge_attributes({}, delta)
        assert "_extracted_at" in merged


# ---------------------------------------------------------------------------
# Unit tests: dismiss_attribute
# ---------------------------------------------------------------------------

class TestDismissAttribute:
    def test_dismiss_removes_from_category(self):
        current = {
            "dietary": [
                {"value": "vegan", "confidence": 0.9, "source_msg_excerpt": "...", "source_msg_index": 0},
                {"value": "sober", "confidence": 0.8, "source_msg_excerpt": "...", "source_msg_index": 1},
            ],
            "_dismissed": [],
        }
        result = dismiss_attribute(current, "dietary", "vegan")
        assert len(result["dietary"]) == 1
        assert result["dietary"][0]["value"] == "sober"

    def test_dismiss_adds_to_dismissed_list(self):
        current = {"dietary": [{"value": "vegan", "confidence": 0.9, "source_msg_excerpt": "...", "source_msg_index": 0}], "_dismissed": []}
        result = dismiss_attribute(current, "dietary", "vegan")
        assert len(result["_dismissed"]) == 1
        assert result["_dismissed"][0]["category"] == "dietary"
        assert result["_dismissed"][0]["value"] == "vegan"
        assert "dismissed_at" in result["_dismissed"][0]

    def test_dismiss_case_insensitive(self):
        current = {
            "dietary": [{"value": "Vegan", "confidence": 0.9, "source_msg_excerpt": "...", "source_msg_index": 0}],
            "_dismissed": [],
        }
        result = dismiss_attribute(current, "dietary", "vegan")
        assert result["dietary"] == []


# ---------------------------------------------------------------------------
# Fixture-based precision tests (mocked Claude API)
# ---------------------------------------------------------------------------

class TestFixturePrecision:
    def _mock_for(self, expected_raw: dict):
        return patch("clapcheeks.intel.attributes._call_claude_extract", return_value=expected_raw)

    def test_dietary_vegan(self):
        raw = _make_raw({"dietary": [_item("vegan", 0.95, "I've been vegan for like 3 years now", 0)]})
        with self._mock_for(raw):
            result = extract_attributes(FIXTURE_VEGAN, api_key="test-key")
        assert any(i.value == "vegan" for i in result.dietary)

    def test_dietary_sober(self):
        raw = _make_raw({"dietary": [_item("sober", 0.90, "I don't really drink at all", 0)]})
        with self._mock_for(raw):
            result = extract_attributes(FIXTURE_SOBER, api_key="test-key")
        assert any(i.value == "sober" for i in result.dietary)

    def test_allergy_nut(self):
        raw = _make_raw({"allergy": [_item("nut allergy", 1.0, "I have a severe nut allergy", 0)]})
        with self._mock_for(raw):
            result = extract_attributes(FIXTURE_NUT_ALLERGY, api_key="test-key")
        assert any(i.value == "nut allergy" for i in result.allergy)
        assert result.dietary == []

    def test_allergy_celiac(self):
        raw = _make_raw({"allergy": [_item("celiac disease", 1.0, "I have celiac disease", 0)]})
        with self._mock_for(raw):
            result = extract_attributes(FIXTURE_CELIAC, api_key="test-key")
        assert any(i.value == "celiac disease" for i in result.allergy)

    def test_schedule_morning_person(self):
        raw = _make_raw({"schedule": [_item("morning person", 0.90, "I'm such a morning person lol", 0)]})
        with self._mock_for(raw):
            result = extract_attributes(FIXTURE_MORNING_PERSON, api_key="test-key")
        assert any(i.value == "morning person" for i in result.schedule)

    def test_lifestyle_has_dog(self):
        raw = _make_raw({"lifestyle": [_item("has a dog", 0.90, "My dog Charlie is basically my whole personality", 0)]})
        with self._mock_for(raw):
            result = extract_attributes(FIXTURE_DOG, api_key="test-key")
        assert any("dog" in i.value.lower() for i in result.lifestyle)

    def test_no_false_positive_restaurant_fan(self):
        raw = _make_raw({})
        with self._mock_for(raw):
            result = extract_attributes(FIXTURE_RESTAURANT_FAN, api_key="test-key")
        assert result.dietary == []

    def test_dismissed_values_not_re_added(self):
        raw = _make_raw({"dietary": [_item("vegan", 0.95, "I've been vegan for 3 years", 0)]})
        prior = {"_dismissed": [{"category": "dietary", "value": "vegan"}]}
        with self._mock_for(raw):
            result = extract_attributes(FIXTURE_VEGAN, prior=prior, api_key="test-key")
        assert all(i.value != "vegan" for i in result.dietary)

    def test_no_api_key_returns_empty(self):
        import os
        old_key = os.environ.pop("ANTHROPIC_API_KEY", None)
        try:
            result = extract_attributes(FIXTURE_VEGAN, api_key=None)
            assert result.dietary == []
        finally:
            if old_key:
                os.environ["ANTHROPIC_API_KEY"] = old_key

    def test_sonnet_escalation_on_low_confidence(self):
        low_conf_raw = _make_raw({"dietary": [_item("vegan", 0.55, "...", 0)]})
        high_conf_raw = _make_raw({"dietary": [_item("vegan", 0.90, "I've been vegan for 3 years", 0)]})
        call_count = {"n": 0}
        models_used = []

        def fake_call(messages, categories, model, api_key):
            call_count["n"] += 1
            models_used.append(model)
            if "haiku" in model:
                return low_conf_raw
            return high_conf_raw

        with patch("clapcheeks.intel.attributes._call_claude_extract", side_effect=fake_call):
            result = extract_attributes(FIXTURE_VEGAN, api_key="test-key")

        assert call_count["n"] == 2
        assert "haiku" in models_used[0]
        assert "sonnet" in models_used[1]
        assert result.model_used == "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# Parametrized precision test
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fixture,expected_cat,expected_value,raw_override", [
    (FIXTURE_VEGAN,          "dietary",   "vegan",        {"dietary": [_item("vegan", 0.95, "...", 0)]}),
    (FIXTURE_SOBER,          "dietary",   "sober",        {"dietary": [_item("sober", 0.90, "...", 0)]}),
    (FIXTURE_NUT_ALLERGY,    "allergy",   "nut allergy",  {"allergy": [_item("nut allergy", 1.0, "...", 0)]}),
    (FIXTURE_CELIAC,         "allergy",   "celiac disease",{"allergy": [_item("celiac disease", 1.0, "...", 0)]}),
    (FIXTURE_MORNING_PERSON, "schedule",  "morning person",{"schedule": [_item("morning person", 0.9, "...", 0)]}),
    (FIXTURE_REMOTE,         "schedule",  "remote",       {"schedule": [_item("remote / WFH", 0.95, "...", 0)]}),
    (FIXTURE_DOG,            "lifestyle", "has a dog",    {"lifestyle": [_item("has a dog", 0.9, "...", 0)]}),
    (FIXTURE_420,            "lifestyle", "420",          {"lifestyle": [_item("420 friendly", 1.0, "...", 0)]}),
    (FIXTURE_KIDS,           "logistics", "kids",         {"logistics": [_item("has kids", 0.95, "...", 0)]}),
    (FIXTURE_SLOW_TEXTER,    "comms",     "slow texter",  {"comms": [_item("slow texter", 0.9, "...", 0)]}),
])
def test_precision_parametrized(fixture, expected_cat, expected_value, raw_override):
    raw = _make_raw(raw_override)
    with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=raw):
        result = extract_attributes(fixture, api_key="test-key")
    cat_items = getattr(result, expected_cat, [])
    assert any(expected_value.lower() in i.value.lower() for i in cat_items), \
        f"Expected '{expected_value}' in {expected_cat}, got {[i.value for i in cat_items]}"
