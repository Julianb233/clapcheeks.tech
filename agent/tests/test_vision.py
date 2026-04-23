"""Phase B tests for clapcheeks.photos.vision (AI-8316).

Covers:
- analyze_photo + analyze_photos_batch parse Claude responses
- aggregate_vision produces <=280 char, ASCII-only summaries
- Dedupe hash is stable
- Empty / malformed responses return EMPTY_TAGS instead of raising
- Batch size of 3 per API call
- Cost estimator is reasonable
- Daemon worker upserts clapcheeks_photo_scores + writes vision_summary
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from clapcheeks.photos import vision


# ---------------------------------------------------------------------------
# Helpers for mocking the Anthropic SDK
# ---------------------------------------------------------------------------

class _FakeContent:
    def __init__(self, text):
        self.text = text


class _FakeResponse:
    def __init__(self, text):
        self.content = [_FakeContent(text)]


def _patch_anthropic(response_text):
    """Patch anthropic.Anthropic client to return a canned response."""
    fake_client = MagicMock()
    fake_client.messages.create.return_value = _FakeResponse(response_text)

    fake_module = MagicMock()
    fake_module.Anthropic.return_value = fake_client
    return patch.dict("sys.modules", {"anthropic": fake_module}), fake_client


def _patch_image_loader(payload=b"jpeg-bytes"):
    """Patch the internal image loader to skip network I/O."""
    return patch(
        "clapcheeks.photos.vision._load_image_bytes",
        return_value=(payload, "image/jpeg"),
    )


# ---------------------------------------------------------------------------
# Hash
# ---------------------------------------------------------------------------

class TestPhotoHash:
    def test_stable(self):
        a = vision.photo_hash("https://example.com/x.jpg")
        b = vision.photo_hash("https://example.com/x.jpg")
        assert a == b

    def test_different_urls(self):
        a = vision.photo_hash("https://example.com/x.jpg")
        b = vision.photo_hash("https://example.com/y.jpg")
        assert a != b

    def test_is_hex_string(self):
        h = vision.photo_hash("foo")
        assert len(h) == 64
        int(h, 16)  # parseable as hex


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

class TestParser:
    def test_parse_clean_array(self):
        text = json.dumps(
            [
                {
                    "activities": ["beach", "yoga"],
                    "locations": ["beach"],
                    "food_signals": [],
                    "aesthetic": "athletic",
                    "energy": "high",
                    "solo_vs_group": "solo",
                    "travel_signals": [],
                    "notable_details": ["sunset"],
                }
            ]
        )
        out = vision._parse_vision_response(text, expected_n=1)
        assert len(out) == 1
        assert out[0]["activities"] == ["beach", "yoga"]
        assert out[0]["aesthetic"] == "athletic"

    def test_parse_code_fenced_json(self):
        text = "```json\n" + json.dumps([{"aesthetic": "casual"}]) + "\n```"
        out = vision._parse_vision_response(text, expected_n=1)
        assert out[0]["aesthetic"] == "casual"

    def test_malformed_returns_empty(self):
        out = vision._parse_vision_response("definitely not json", 3)
        assert len(out) == 3
        for row in out:
            assert row["activities"] == []
            assert row["aesthetic"] is None

    def test_empty_string_returns_empty(self):
        out = vision._parse_vision_response("", 2)
        assert len(out) == 2

    def test_pads_missing_items(self):
        text = json.dumps([{"aesthetic": "casual"}])
        out = vision._parse_vision_response(text, expected_n=3)
        assert len(out) == 3
        assert out[0]["aesthetic"] == "casual"
        assert out[1]["aesthetic"] is None
        assert out[2]["aesthetic"] is None

    def test_coerces_string_tag_to_list(self):
        text = json.dumps([{"activities": "beach", "locations": "outdoors"}])
        out = vision._parse_vision_response(text, expected_n=1)
        assert out[0]["activities"] == ["beach"]
        assert out[0]["locations"] == ["outdoors"]

    def test_lowercases_tags(self):
        text = json.dumps([{"activities": ["BEACH", "Yoga"]}])
        out = vision._parse_vision_response(text, expected_n=1)
        assert out[0]["activities"] == ["beach", "yoga"]

    def test_single_object_wrapped_as_array(self):
        text = json.dumps({"aesthetic": "glam"})
        out = vision._parse_vision_response(text, expected_n=1)
        assert out[0]["aesthetic"] == "glam"


# ---------------------------------------------------------------------------
# analyze_photo / analyze_photos_batch
# ---------------------------------------------------------------------------

class TestAnalyzePhoto:
    def test_no_api_key_returns_empty(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        out = vision.analyze_photo("https://example.com/x.jpg")
        assert out == vision.EMPTY_TAGS

    def test_single_photo_parses(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        response = json.dumps(
            [
                {
                    "activities": ["hiking"],
                    "locations": ["mountain"],
                    "food_signals": [],
                    "aesthetic": "athletic",
                    "energy": "high",
                    "solo_vs_group": "solo",
                    "travel_signals": [],
                    "notable_details": [],
                }
            ]
        )
        patcher, client = _patch_anthropic(response)
        with patcher, _patch_image_loader():
            out = vision.analyze_photo("https://example.com/x.jpg")

        assert out["activities"] == ["hiking"]
        assert out["aesthetic"] == "athletic"
        client.messages.create.assert_called_once()

    def test_batch_chunks_by_three(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        urls = [f"https://example.com/p{i}.jpg" for i in range(7)]
        response = json.dumps([{"aesthetic": "casual"} for _ in range(3)])
        patcher, client = _patch_anthropic(response)
        with patcher, _patch_image_loader():
            results = vision.analyze_photos_batch(urls)

        assert len(results) == 7
        # Exactly ceil(7 / 3) = 3 calls
        assert client.messages.create.call_count == 3

    def test_batch_six_photos_two_calls(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        urls = [f"https://example.com/p{i}.jpg" for i in range(6)]
        response = json.dumps([{"aesthetic": "casual"} for _ in range(3)])
        patcher, client = _patch_anthropic(response)
        with patcher, _patch_image_loader():
            results = vision.analyze_photos_batch(urls)

        assert len(results) == 6
        assert client.messages.create.call_count == 2

    def test_image_load_failure_returns_empty_for_that_slot(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        urls = ["https://example.com/ok.jpg", "https://example.com/bad.jpg"]
        response = json.dumps([{"aesthetic": "athletic"}])

        def fake_loader(u):
            if "bad" in u:
                raise RuntimeError("boom")
            return b"ok", "image/jpeg"

        patcher, _ = _patch_anthropic(response)
        with patcher, patch(
            "clapcheeks.photos.vision._load_image_bytes", side_effect=fake_loader
        ):
            out = vision.analyze_photos_batch(urls)

        assert out[0]["aesthetic"] == "athletic"
        assert out[1] == vision.EMPTY_TAGS

    def test_api_exception_returns_empty(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        fake_client = MagicMock()
        fake_client.messages.create.side_effect = RuntimeError("429")
        fake_module = MagicMock()
        fake_module.Anthropic.return_value = fake_client
        with patch.dict("sys.modules", {"anthropic": fake_module}), _patch_image_loader():
            out = vision.analyze_photo("https://example.com/x.jpg")
        assert out == vision.EMPTY_TAGS


# ---------------------------------------------------------------------------
# aggregate_vision
# ---------------------------------------------------------------------------

class TestAggregate:
    def _sample(self, n=6):
        return [
            {
                "activities": ["beach", "yoga"],
                "locations": ["beach"],
                "food_signals": ["coffee"],
                "aesthetic": "athletic",
                "energy": "high",
                "solo_vs_group": "solo",
                "travel_signals": [],
                "notable_details": ["sunset"],
            }
            for _ in range(n)
        ]

    def test_empty_list_returns_empty_string(self):
        assert vision.aggregate_vision([]) == ""

    def test_under_280_chars(self):
        s = vision.aggregate_vision(self._sample(6))
        assert len(s) <= 280

    def test_ascii_only(self):
        s = vision.aggregate_vision(self._sample(6))
        for c in s:
            assert 32 <= ord(c) < 127, f"non-ASCII char: {c!r} in {s!r}"

    def test_no_em_dash(self):
        s = vision.aggregate_vision(self._sample(6))
        assert "\u2014" not in s
        assert "\u2013" not in s

    def test_no_ellipsis(self):
        s = vision.aggregate_vision(self._sample(6))
        assert "\u2026" not in s
        assert "..." not in s

    def test_mentions_activities(self):
        s = vision.aggregate_vision(self._sample(6))
        assert "beach" in s or "yoga" in s

    def test_hard_cap_truncates_even_with_many_signals(self):
        dense = [
            {
                "activities": [f"act{i}" for i in range(8)],
                "locations": [f"loc{i}" for i in range(8)],
                "food_signals": [f"food{i}" for i in range(8)],
                "aesthetic": "athletic",
                "energy": "high",
                "solo_vs_group": "solo",
                "travel_signals": [f"travel{i}" for i in range(8)],
                "notable_details": [f"note{i}" for i in range(8)],
            }
        ]
        s = vision.aggregate_vision(dense)
        assert len(s) <= 280

    def test_summary_includes_aesthetic(self):
        results = [{"aesthetic": "glam", "energy": "high", "solo_vs_group": "solo",
                    "activities": [], "locations": [], "food_signals": [],
                    "travel_signals": [], "notable_details": []}]
        s = vision.aggregate_vision(results)
        assert "glam" in s

    def test_strips_curly_quotes(self):
        results = [{"aesthetic": "casual", "energy": None, "solo_vs_group": None,
                    "activities": [], "locations": [],
                    "food_signals": ["caf\u00e9"],
                    "travel_signals": [], "notable_details": ["\u201cbook\u201d"]}]
        s = vision.aggregate_vision(results)
        assert "\u201c" not in s
        assert "\u201d" not in s


# ---------------------------------------------------------------------------
# Cost estimator
# ---------------------------------------------------------------------------

class TestCost:
    def test_thirty_photos_under_a_dime(self):
        assert vision.estimate_cost_usd(30) <= 0.10

    def test_scales_linearly(self):
        assert vision.estimate_cost_usd(10) == pytest.approx(10 * vision.COST_PER_IMAGE_USD)


# ---------------------------------------------------------------------------
# Daemon vision worker integration
# ---------------------------------------------------------------------------

class TestDaemonVisionWorker:
    def test_process_match_upserts_photo_scores_and_summary(self, monkeypatch):
        """End-to-end: daemon picks an unanalyzed match, analyzes photos,
        upserts scores, writes vision_summary."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("SUPABASE_URL", "https://fake.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service-role-key")

        from clapcheeks import daemon as daemon_mod

        match_row = {
            "id": "11111111-1111-1111-1111-111111111111",
            "user_id": "9c848c51-8996-4f1f-9dbf-50128e3408ea",
            "photos_jsonb": [
                {"url": "https://example.com/a.jpg"},
                {"url": "https://example.com/b.jpg"},
                {"url": "https://example.com/c.jpg"},
            ],
        }
        response_text = json.dumps(
            [
                {"activities": ["beach"], "aesthetic": "athletic",
                 "energy": "high", "solo_vs_group": "solo",
                 "locations": ["beach"], "food_signals": [],
                 "travel_signals": [], "notable_details": []},
                {"activities": ["yoga"], "aesthetic": "athletic",
                 "energy": "medium", "solo_vs_group": "solo",
                 "locations": ["studio"], "food_signals": [],
                 "travel_signals": [], "notable_details": []},
                {"activities": ["gym"], "aesthetic": "athletic",
                 "energy": "high", "solo_vs_group": "solo",
                 "locations": ["gym"], "food_signals": [],
                 "travel_signals": [], "notable_details": []},
            ]
        )

        upsert_calls = []
        patch_calls = []

        def fake_get(url, headers=None, params=None, timeout=None):
            r = MagicMock()
            r.status_code = 200
            r.json.return_value = []
            return r

        def fake_post(url, headers=None, json=None, params=None, timeout=None):
            upsert_calls.append({"url": url, "json": json, "params": params})
            r = MagicMock()
            r.status_code = 201
            r.text = ""
            return r

        def fake_patch(url, headers=None, json=None, params=None, timeout=None):
            patch_calls.append({"url": url, "json": json, "params": params})
            r = MagicMock()
            r.status_code = 204
            r.text = ""
            return r

        patcher_anth, _ = _patch_anthropic(response_text)
        with patcher_anth, _patch_image_loader(), \
             patch("requests.get", side_effect=fake_get), \
             patch("requests.post", side_effect=fake_post), \
             patch("requests.patch", side_effect=fake_patch):
            processed = daemon_mod._process_match_vision(match_row)

        assert processed is True
        score_upserts = [c for c in upsert_calls if "clapcheeks_photo_scores" in c["url"]]
        assert len(score_upserts) == 3
        match_patches = [c for c in patch_calls if "clapcheeks_matches" in c["url"]]
        assert len(match_patches) == 1
        assert "vision_summary" in match_patches[0]["json"]
        summary = match_patches[0]["json"]["vision_summary"]
        assert isinstance(summary, str)
        assert len(summary) <= 280

    def test_process_match_skips_when_no_photos(self, monkeypatch):
        from clapcheeks import daemon as daemon_mod

        match_row = {
            "id": "22222222-2222-2222-2222-222222222222",
            "user_id": "9c848c51-8996-4f1f-9dbf-50128e3408ea",
            "photos_jsonb": [],
        }
        processed = daemon_mod._process_match_vision(match_row)
        assert processed is False

    def test_dedupe_skips_already_analyzed_photos(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("SUPABASE_URL", "https://fake.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service-role-key")

        from clapcheeks import daemon as daemon_mod

        match_row = {
            "id": "33333333-3333-3333-3333-333333333333",
            "user_id": "9c848c51-8996-4f1f-9dbf-50128e3408ea",
            "photos_jsonb": [
                {"url": "https://example.com/cached.jpg"},
                {"url": "https://example.com/new.jpg"},
            ],
        }

        existing_hash = vision.photo_hash("https://example.com/cached.jpg")
        existing_row = {
            "photo_hash": existing_hash,
            "activities": ["beach"],
            "locations": ["beach"],
            "food_signals": [],
            "aesthetic": "athletic",
            "energy": "high",
            "solo_vs_group": "solo",
            "travel_signals": [],
            "notable_details": [],
        }

        response_text = json.dumps(
            [{"activities": ["gym"], "aesthetic": "athletic",
              "energy": "high", "solo_vs_group": "solo",
              "locations": ["gym"], "food_signals": [],
              "travel_signals": [], "notable_details": []}]
        )

        fake_anth = MagicMock()
        fake_anth.messages.create.return_value = _FakeResponse(response_text)
        fake_mod = MagicMock()
        fake_mod.Anthropic.return_value = fake_anth

        def fake_get(url, headers=None, params=None, timeout=None):
            r = MagicMock()
            r.status_code = 200
            if "clapcheeks_photo_scores" in url:
                r.json.return_value = [existing_row]
            else:
                r.json.return_value = []
            return r

        def fake_post(url, headers=None, json=None, params=None, timeout=None):
            r = MagicMock()
            r.status_code = 201
            r.text = ""
            return r

        def fake_patch(url, headers=None, json=None, params=None, timeout=None):
            r = MagicMock()
            r.status_code = 204
            r.text = ""
            return r

        with patch.dict("sys.modules", {"anthropic": fake_mod}), _patch_image_loader(), \
             patch("requests.get", side_effect=fake_get), \
             patch("requests.post", side_effect=fake_post), \
             patch("requests.patch", side_effect=fake_patch):
            daemon_mod._process_match_vision(match_row)

        # Only one Claude call for the new photo
        assert fake_anth.messages.create.call_count == 1
