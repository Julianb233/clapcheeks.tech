"""AI-8814 — Sanitizer attribute-conflict tests.

When the AI drafter produces a message that conflicts with a known match attribute,
the sanitizer must block it. Key cases:
  - bourbon/whiskey suggestion when match is sober
  - gluten pasta/bread when match has celiac
  - steak/meat suggestion when match is vegan

These tests wire into the existing sanitize_and_validate pipeline by augmenting
it with an attribute-conflict check function.
"""
from __future__ import annotations

import pytest

from clapcheeks.intel.attributes import check_draft_attribute_conflicts


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

SOBER_ATTRS = {
    "dietary": [
        {"value": "sober", "confidence": 0.95, "source_msg_excerpt": "...", "source_msg_index": 0},
    ],
    "allergy": [],
    "schedule": [],
    "lifestyle": [],
    "logistics": [],
    "comms": [],
}

CELIAC_ATTRS = {
    "dietary": [],
    "allergy": [
        {"value": "celiac disease", "confidence": 1.0, "source_msg_excerpt": "...", "source_msg_index": 0},
    ],
    "schedule": [],
    "lifestyle": [],
    "logistics": [],
    "comms": [],
}

VEGAN_ATTRS = {
    "dietary": [
        {"value": "vegan", "confidence": 0.95, "source_msg_excerpt": "...", "source_msg_index": 0},
    ],
    "allergy": [],
    "schedule": [],
    "lifestyle": [],
    "logistics": [],
    "comms": [],
}

NUT_ALLERGY_ATTRS = {
    "dietary": [],
    "allergy": [
        {"value": "nut allergy", "confidence": 1.0, "source_msg_excerpt": "...", "source_msg_index": 0},
    ],
    "schedule": [],
    "lifestyle": [],
    "logistics": [],
    "comms": [],
}

EMPTY_ATTRS = {}


class TestSoberConflicts:
    def test_bourbon_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Want to grab some bourbon at this speakeasy I know?",
            SOBER_ATTRS,
        )
        assert not ok
        assert any("sober" in c.lower() or "alcohol" in c.lower() for c in conflicts)

    def test_whiskey_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "They have an amazing whiskey selection, want to check it out?",
            SOBER_ATTRS,
        )
        assert not ok

    def test_beer_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Want to grab a beer after?",
            SOBER_ATTRS,
        )
        assert not ok

    def test_wine_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "I know a great wine bar downtown",
            SOBER_ATTRS,
        )
        assert not ok

    def test_cocktail_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Their cocktails are incredible, you'd love it",
            SOBER_ATTRS,
        )
        assert not ok

    def test_coffee_allowed(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Coffee date? There's a great spot on 3rd",
            SOBER_ATTRS,
        )
        assert ok, f"Unexpected conflicts: {conflicts}"

    def test_juice_allowed(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "They have the best fresh juice and smoothies",
            SOBER_ATTRS,
        )
        assert ok, f"Unexpected conflicts: {conflicts}"


class TestCeliacConflicts:
    def test_gluten_pasta_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Have you been to Bestia? Their pasta is incredible",
            CELIAC_ATTRS,
        )
        assert not ok
        assert any("celiac" in c.lower() or "gluten" in c.lower() for c in conflicts)

    def test_bread_based_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Their sourdough bread basket is amazing",
            CELIAC_ATTRS,
        )
        assert not ok

    def test_pizza_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Want to grab pizza?",
            CELIAC_ATTRS,
        )
        assert not ok

    def test_gluten_free_restaurant_allowed(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "They have a full gluten-free menu, you'd be safe there",
            CELIAC_ATTRS,
        )
        assert ok, f"Unexpected conflicts: {conflicts}"

    def test_sushi_allowed(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Want to get sushi? Omakase if you're down",
            CELIAC_ATTRS,
        )
        assert ok, f"Unexpected conflicts: {conflicts}"


class TestVeganConflicts:
    def test_steakhouse_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Have you been to Mastro's? Best steak in LA",
            VEGAN_ATTRS,
        )
        assert not ok
        assert any("vegan" in c.lower() for c in conflicts)

    def test_burger_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "They have the best burgers, want to check it out?",
            VEGAN_ATTRS,
        )
        assert not ok

    def test_vegan_restaurant_allowed(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Gracias Madre has an amazing vegan menu",
            VEGAN_ATTRS,
        )
        assert ok, f"Unexpected conflicts: {conflicts}"

    def test_salad_allowed(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Want to grab lunch? There's a good salad spot",
            VEGAN_ATTRS,
        )
        assert ok, f"Unexpected conflicts: {conflicts}"


class TestNutAllergyConflicts:
    def test_peanut_butter_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Thai peanut sauce is the best, you'd love this place",
            NUT_ALLERGY_ATTRS,
        )
        assert not ok
        assert any("allergy" in c.lower() or "nut" in c.lower() for c in conflicts)

    def test_walnut_blocked(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "The walnut brownie here is incredible",
            NUT_ALLERGY_ATTRS,
        )
        assert not ok

    def test_nut_free_mentioned_allowed(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "They're fully nut-free, you'd be totally safe there",
            NUT_ALLERGY_ATTRS,
        )
        assert ok, f"Unexpected conflicts: {conflicts}"


class TestNoAttributes:
    def test_no_attrs_always_ok(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Want to grab bourbon at that speakeasy?",
            EMPTY_ATTRS,
        )
        assert ok
        assert conflicts == []

    def test_none_attrs_always_ok(self):
        ok, conflicts = check_draft_attribute_conflicts(
            "Their pasta is incredible",
            None,
        )
        assert ok
        assert conflicts == []
