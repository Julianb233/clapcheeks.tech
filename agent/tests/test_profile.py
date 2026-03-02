"""Tests for profile dataclass and JSON persistence."""
import json
from pathlib import Path

import pytest

from clapcheeks.profile import Profile, load_profile, save_profile, profile_exists, PROFILE_PATH, PROFILE_DIR


@pytest.fixture(autouse=True)
def _isolate_profile(tmp_path, monkeypatch):
    """Redirect profile storage to a temp directory for every test."""
    test_dir = tmp_path / ".clapcheeks"
    test_file = test_dir / "profile.json"
    monkeypatch.setattr("clapcheeks.profile.PROFILE_DIR", test_dir)
    monkeypatch.setattr("clapcheeks.profile.PROFILE_PATH", test_file)


def test_save_then_load_roundtrip():
    p = Profile(name="Alice", age=28, location="NYC", looking_for="serious",
                pref_traits=["funny", "kind"], dealbreakers=["smoking"])
    save_profile(p)
    loaded = load_profile()
    assert loaded.name == "Alice"
    assert loaded.age == 28
    assert loaded.location == "NYC"
    assert loaded.looking_for == "serious"
    assert loaded.pref_traits == ["funny", "kind"]
    assert loaded.dealbreakers == ["smoking"]


def test_load_returns_defaults_when_missing():
    p = load_profile()
    assert p.name == ""
    assert p.age == 0
    assert p.convo_style == "balanced"


def test_load_returns_defaults_when_corrupt(tmp_path):
    from clapcheeks import profile as mod
    mod.PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    mod.PROFILE_PATH.write_text("NOT VALID JSON {{{")
    p = load_profile()
    assert p.name == ""
    assert p.age == 0


def test_updated_at_set_on_save():
    p = Profile(name="Bob")
    assert p.updated_at == ""
    save_profile(p)
    assert p.updated_at != ""
    assert "T" in p.updated_at  # ISO format


def test_profile_exists_false_when_no_file():
    assert profile_exists() is False


def test_profile_exists_true_after_save():
    save_profile(Profile(name="Test"))
    assert profile_exists() is True
