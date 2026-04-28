"""AI-8814 — Idempotency tests for attribute extractor.

Running extract_attributes twice on the same input must yield <= ±1 attribute
drift between runs. We mock _call_claude_extract to return a fixed result,
so stochasticity is eliminated and both runs must match exactly.
"""
from __future__ import annotations

import pytest
from unittest.mock import patch

from clapcheeks.intel.attributes import (
    extract_attributes,
    DEFAULT_CATEGORIES,
    AttributeUpdate,
)

MESSAGES = [
    {"sender": "her", "body": "I've been vegan for 3 years"},
    {"sender": "us", "body": "Nice!"},
    {"sender": "her", "body": "I also don't drink at all"},
    {"sender": "us", "body": "Coffee date then"},
    {"sender": "her", "body": "I'm such a morning person, up at 5am"},
    {"sender": "her", "body": "My dog Charlie is my everything"},
]

FIXED_RAW = {
    "dietary": [
        {"value": "vegan", "confidence": 0.95, "source_msg_excerpt": "I've been vegan for 3 years", "source_msg_index": 0},
        {"value": "sober", "confidence": 0.90, "source_msg_excerpt": "I don't drink at all", "source_msg_index": 2},
    ],
    "allergy": [],
    "schedule": [
        {"value": "morning person", "confidence": 0.90, "source_msg_excerpt": "I'm such a morning person, up at 5am", "source_msg_index": 4},
    ],
    "lifestyle": [
        {"value": "has a dog", "confidence": 0.90, "source_msg_excerpt": "My dog Charlie is my everything", "source_msg_index": 5},
    ],
    "logistics": [],
    "comms": [],
}


def _count_attributes(update: AttributeUpdate) -> int:
    total = 0
    for cat in ("dietary", "allergy", "schedule", "lifestyle", "logistics", "comms"):
        total += len(getattr(update, cat, []))
    return total


def _collect_values(update: AttributeUpdate) -> set[str]:
    values = set()
    for cat in ("dietary", "allergy", "schedule", "lifestyle", "logistics", "comms"):
        for item in getattr(update, cat, []):
            values.add(f"{cat}:{item.value}")
    return values


class TestIdempotency:
    def test_same_input_same_attributes(self):
        """Two runs on the same input (mocked) must return identical attribute sets."""
        with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=FIXED_RAW):
            run1 = extract_attributes(MESSAGES, api_key="test-key")
        with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=FIXED_RAW):
            run2 = extract_attributes(MESSAGES, api_key="test-key")

        values1 = _collect_values(run1)
        values2 = _collect_values(run2)
        drift = len(values1.symmetric_difference(values2))
        assert drift == 0, f"Attribute drift between identical runs: {values1.symmetric_difference(values2)}"

    def test_count_within_tolerance(self):
        """Total attribute count must be within ±1 between runs (stochasticity tolerance)."""
        with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=FIXED_RAW):
            run1 = extract_attributes(MESSAGES, api_key="test-key")
        with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=FIXED_RAW):
            run2 = extract_attributes(MESSAGES, api_key="test-key")

        count1 = _count_attributes(run1)
        count2 = _count_attributes(run2)
        assert abs(count1 - count2) <= 1, f"Count drift: {count1} vs {count2}"

    def test_merge_idempotent(self):
        """Merging the same delta twice should not duplicate attributes."""
        from clapcheeks.intel.attributes import merge_attributes, AttributeItem

        delta_update = extract_attributes.__class__  # just to set up AttributeUpdate
        from clapcheeks.intel.attributes import AttributeUpdate

        delta = AttributeUpdate(
            dietary=[AttributeItem("vegan", 0.95, "I've been vegan", 0)],
        )

        first_merge = merge_attributes({}, delta)
        second_merge = merge_attributes(first_merge, delta)

        assert len(second_merge["dietary"]) == 1, \
            f"Expected 1 vegan entry after second merge, got {len(second_merge['dietary'])}"

    def test_dismissed_values_stable_across_runs(self):
        """Dismissed values must remain absent after multiple extraction runs."""
        prior = {
            "_dismissed": [{"category": "dietary", "value": "vegan"}],
        }
        raw = {**FIXED_RAW}  # includes vegan

        with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=raw):
            run1 = extract_attributes(MESSAGES, prior=prior, api_key="test-key")
        with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=raw):
            run2 = extract_attributes(MESSAGES, prior=prior, api_key="test-key")

        for run in (run1, run2):
            assert all(i.value != "vegan" for i in run.dietary), \
                "Dismissed vegan re-appeared in dietary"

    def test_no_cross_contamination_between_calls(self):
        """Sequential calls for different fixtures must not share state."""
        raw_a = {
            "dietary": [{"value": "vegan", "confidence": 0.95, "source_msg_excerpt": "...", "source_msg_index": 0}],
            "allergy": [], "schedule": [], "lifestyle": [], "logistics": [], "comms": [],
        }
        raw_b = {
            "dietary": [{"value": "carnivore", "confidence": 0.90, "source_msg_excerpt": "...", "source_msg_index": 0}],
            "allergy": [], "schedule": [], "lifestyle": [], "logistics": [], "comms": [],
        }

        msgs_a = [{"sender": "her", "body": "I'm vegan"}]
        msgs_b = [{"sender": "her", "body": "I eat meat exclusively"}]

        with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=raw_a):
            result_a = extract_attributes(msgs_a, api_key="test-key")
        with patch("clapcheeks.intel.attributes._call_claude_extract", return_value=raw_b):
            result_b = extract_attributes(msgs_b, api_key="test-key")

        assert any(i.value == "vegan" for i in result_a.dietary)
        assert not any(i.value == "vegan" for i in result_b.dietary)
        assert any(i.value == "carnivore" for i in result_b.dietary)
