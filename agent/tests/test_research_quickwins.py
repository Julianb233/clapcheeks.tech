"""Tests for research-backed quick-wins (AI-research-quickwins).

Covers:
- Opener templates: pick_formula picks the right formula given profile shape
- Opener templates: build_opener_prompt emits a usable system addendum
- SelectivityGate: warm-up / under-cap / over-cap / reset behavior
- send_window: chat.db missing -> default peak hours fallback
- send_window: is_within_send_window True at target hour, False elsewhere
"""
from __future__ import annotations

import datetime
from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# Opener template library
# ---------------------------------------------------------------------------

class TestOpenerLibrary:
    def test_load_templates_returns_known_formulas(self):
        from clapcheeks.openers.library import load_templates

        templates = load_templates()
        formulas = templates.get("formulas", {})
        assert "oq_formula" in formulas
        assert "two_truths_lie" in formulas
        assert "prompt_callback" in formulas

    def test_pick_formula_prompt_callback_when_prompts_present(self):
        from clapcheeks.openers.library import pick_formula

        profile = {"prompts": ["best travel story: passport stolen in Vietnam"]}
        formula = pick_formula(profile)
        assert "47%" in formula.get("description", "")  # prompt_callback signature

    def test_pick_formula_oq_when_only_photos(self):
        from clapcheeks.openers.library import pick_formula

        profile = {"photo_descriptions": ["pole vaulting", "cabo cliff"]}
        formula = pick_formula(profile)
        assert "67%" in formula.get("description", "")  # oq_formula signature

    def test_pick_formula_two_truths_fallback_when_empty(self):
        from clapcheeks.openers.library import pick_formula

        formula = pick_formula({})
        assert "Hinge's own #1 opener" in formula.get("description", "")

    def test_pick_formula_fallback_when_none(self):
        from clapcheeks.openers.library import pick_formula

        formula = pick_formula(None)
        assert "Hinge's own #1 opener" in formula.get("description", "")

    def test_pick_formula_explicit_prefer_wins(self):
        from clapcheeks.openers.library import pick_formula

        # Even with prompts present, if user prefers two_truths_lie they get it
        profile = {"prompts": ["love coffee"]}
        formula = pick_formula(profile, prefer="two_truths_lie")
        assert "Hinge's own #1 opener" in formula.get("description", "")

    def test_build_opener_prompt_includes_examples_and_pattern(self):
        from clapcheeks.openers.library import build_opener_prompt, pick_formula

        profile = {"prompts": ["dream dinner guests: my grandmother"]}
        formula = pick_formula(profile)
        out = build_opener_prompt(formula, profile)
        assert "OPENER FORMULA:" in out
        assert "PATTERN:" in out
        assert "EXAMPLES:" in out
        assert "Her prompts:" in out
        # The model must be told to output ONLY the opener
        assert "ONLY the opener text" in out

    def test_opener_service_returns_addendum(self):
        from clapcheeks.openers import OpenerService

        svc = OpenerService()
        out = svc.build_for({"photo_descriptions": ["surfing in Bali"]})
        assert "OPENER FORMULA:" in out
        assert "67%" in out  # oq_formula was picked


# ---------------------------------------------------------------------------
# SelectivityGate
# ---------------------------------------------------------------------------

class TestSelectivityGate:
    def test_warmup_first_10_always_allows(self):
        from clapcheeks.safety import SelectivityGate

        gate = SelectivityGate()
        for _ in range(9):
            ok, reason = gate.can_like()
            assert ok is True, reason
            gate.record_like()
        # Still in warm-up at 9 swipes
        ok, reason = gate.can_like()
        assert ok is True
        assert "warming up" in reason

    def test_blocks_at_50_percent_after_10(self):
        from clapcheeks.safety import SelectivityGate

        gate = SelectivityGate()
        # 10 swipes total: 5 likes, 5 passes -> 50% > 30% cap
        for _ in range(5):
            gate.record_like()
        for _ in range(5):
            gate.record_pass()
        ok, reason = gate.can_like()
        assert ok is False
        assert "exceeds" in reason or "50%" in reason

    def test_allows_at_29_percent_after_10(self):
        from clapcheeks.safety import SelectivityGate

        gate = SelectivityGate()
        # 100 swipes: 29 likes / 71 passes = 29%
        for _ in range(29):
            gate.record_like()
        for _ in range(71):
            gate.record_pass()
        ok, reason = gate.can_like()
        assert ok is True
        assert "ok" in reason

    def test_reset_clears_counters(self):
        from clapcheeks.safety import SelectivityGate

        gate = SelectivityGate()
        for _ in range(5):
            gate.record_like()
        for _ in range(5):
            gate.record_pass()
        assert gate.likes == 5
        assert gate.passes == 5
        gate.reset_session()
        assert gate.likes == 0
        assert gate.passes == 0
        assert gate.ratio == 0.0

    def test_ratio_property(self):
        from clapcheeks.safety import SelectivityGate

        gate = SelectivityGate()
        for _ in range(3):
            gate.record_like()
        for _ in range(7):
            gate.record_pass()
        assert gate.ratio == pytest.approx(0.30)


# ---------------------------------------------------------------------------
# send_window — time-of-day per-recipient optimizer
# ---------------------------------------------------------------------------

class TestSendWindow:
    def test_falls_back_to_default_when_chat_db_missing(self, tmp_path):
        """When chat.db doesn't exist, we should hand back the default peak set."""
        import clapcheeks.safety.send_window as sw_mod

        with patch.object(sw_mod, "IMESSAGE_DB_PATH", tmp_path / "nonexistent.db"):
            hours = sw_mod.best_send_hour_for("+15555550100")
        assert hours == sw_mod.DEFAULT_PEAK_HOURS

    def test_default_peak_hours_cover_evening(self):
        from clapcheeks.safety.send_window import DEFAULT_PEAK_HOURS

        # Sanity: the default window is the evening peak per Nielsen + Hinge.
        # Must cover at least the 19-22 hour block.
        assert {19, 20, 21, 22}.issubset(DEFAULT_PEAK_HOURS)

    def test_is_within_send_window_true_at_target_hour(self, tmp_path):
        """Inside the target hour set, is_within_send_window returns True."""
        import clapcheeks.safety.send_window as sw_mod

        # Force fallback by pointing at a non-existent DB.
        with patch.object(sw_mod, "IMESSAGE_DB_PATH", tmp_path / "missing.db"):
            target_hour = next(iter(sw_mod.DEFAULT_PEAK_HOURS))
            now = datetime.datetime(2026, 4, 27, target_hour, 30)
            ok, reason = sw_mod.is_within_send_window("+15555550100", now=now)
        assert ok is True
        assert "in window" in reason

    def test_is_within_send_window_false_outside(self, tmp_path):
        """Outside the target hour set, is_within_send_window returns False."""
        import clapcheeks.safety.send_window as sw_mod

        with patch.object(sw_mod, "IMESSAGE_DB_PATH", tmp_path / "missing.db"):
            # Pick an hour NOT in DEFAULT_PEAK_HOURS = {17,18,19,20,21,22,23,0}
            outside_hour = 8  # 8am is not a peak hour
            assert outside_hour not in sw_mod.DEFAULT_PEAK_HOURS
            now = datetime.datetime(2026, 4, 27, outside_hour, 0)
            ok, reason = sw_mod.is_within_send_window("+15555550100", now=now)
        assert ok is False
        assert "outside window" in reason

    def test_next_window_hour_returns_future_target(self, tmp_path):
        import clapcheeks.safety.send_window as sw_mod

        with patch.object(sw_mod, "IMESSAGE_DB_PATH", tmp_path / "missing.db"):
            # 8am -> next target hour same day is 17 (5pm) per defaults
            now = datetime.datetime(2026, 4, 27, 8, 0)
            nxt = sw_mod.next_window_hour("+15555550100", now=now)
        assert nxt > now
        assert nxt.hour in sw_mod.DEFAULT_PEAK_HOURS
