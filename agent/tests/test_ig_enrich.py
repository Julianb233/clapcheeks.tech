"""Tests for Phase C (AI-8317) Instagram enrichment."""
from __future__ import annotations

from unittest.mock import patch

import pytest


class TestExtractHandles:
    def test_explicit_ig_prefix(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles("IG: @sarah.m") == ["sarah.m"]
        assert extract_ig_handles("ig - zora.vibes") == ["zora.vibes"]
        assert extract_ig_handles("insta: @maya_nyc") == ["maya_nyc"]
        assert extract_ig_handles("instagram: dani.codes") == ["dani.codes"]

    def test_at_handle_in_free_text(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles(
            "berlin -> nyc. say hi @sarah.m if we match"
        ) == ["sarah.m"]

    def test_naked_handle_with_cue(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles("my insta is sarahm_") == ["sarahm_"]
        assert extract_ig_handles("find me on ig: nyc_nomad") == ["nyc_nomad"]
        assert extract_ig_handles("follow me @brenda.travels") == ["brenda.travels"]

    def test_rejects_email_addresses(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles("email @me at @gmail.com") != ["gmail.com"]

    def test_rejects_numeric_only(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles("@1234567890") == []

    def test_rejects_stopwords(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles("@instagram") == []
        assert extract_ig_handles("@the") == []
        assert extract_ig_handles("@about") == []

    def test_rejects_consecutive_dots(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles("@foo..bar") == []

    def test_rejects_too_short(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles("@ab") == []

    def test_dedupes_multiple_mentions(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        text = "IG: @sarah.m -- also find @sarah.m again"
        assert extract_ig_handles(text) == ["sarah.m"]

    def test_empty_inputs(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        assert extract_ig_handles(None) == []
        assert extract_ig_handles("") == []
        assert extract_ig_handles("no handles here") == []

    def test_order_is_highest_signal_first(self):
        from clapcheeks.social.ig_handle import extract_ig_handles

        text = "say hi @johndoe. ig: @sarah.m"
        result = extract_ig_handles(text)
        assert result[0] == "sarah.m"
        assert "johndoe" in result


WEB_PROFILE_INFO_SAMPLE = {
    "data": {
        "user": {
            "username": "sarah.m",
            "full_name": "Sarah M",
            "biography": "nyc + pdx. long runs, longer dinners.",
            "is_private": False,
            "is_verified": False,
            "edge_followed_by": {"count": 1843},
            "edge_follow": {"count": 421},
            "edge_owner_to_timeline_media": {
                "count": 217,
                "edges": [
                    {
                        "node": {
                            "shortcode": "CxYz1",
                            "taken_at_timestamp": 1713225600,
                            "is_video": False,
                            "edge_media_to_caption": {
                                "edges": [{"node": {"text": "coffee + the east river. #nyc #coffee"}}],
                            },
                            "edge_liked_by": {"count": 84},
                            "edge_media_to_comment": {"count": 5},
                        },
                    },
                    {
                        "node": {
                            "shortcode": "CxYz2",
                            "taken_at_timestamp": 1713052800,
                            "is_video": True,
                            "edge_media_to_caption": {
                                "edges": [{"node": {"text": "ramen run in little tokyo #nyc #ramen"}}],
                            },
                            "edge_liked_by": {"count": 110},
                            "edge_media_to_comment": {"count": 9},
                        },
                    },
                    {
                        "node": {
                            "shortcode": "CxYz3",
                            "taken_at_timestamp": 1712880000,
                            "edge_media_to_caption": {
                                "edges": [{"node": {"text": "hike day. #trail #coffee"}}],
                            },
                            "edge_liked_by": {"count": 67},
                            "edge_media_to_comment": {"count": 2},
                        },
                    },
                ],
            },
        },
    },
}


class TestParseIgUserFeed:
    def test_happy_path(self):
        from clapcheeks.social.ig_parser import parse_ig_user_feed

        out = parse_ig_user_feed(WEB_PROFILE_INFO_SAMPLE)
        assert out["handle"] == "sarah.m"
        assert out["display_name"] == "Sarah M"
        assert out["follower_count"] == 1843
        assert out["following_count"] == 421
        assert out["post_count"] == 217
        assert out["is_private"] is False
        assert len(out["recent_posts"]) == 3
        assert out["recent_posts"][0]["shortcode"] == "CxYz1"
        assert out["recent_posts"][0]["like_count"] == 84
        assert "nyc" in out["common_hashtags"]
        assert "coffee" in out["common_hashtags"]

    def test_aesthetic_tags_inferred(self):
        from clapcheeks.social.ig_parser import parse_ig_user_feed

        out = parse_ig_user_feed(WEB_PROFILE_INFO_SAMPLE)
        assert "foodie" in out["aesthetic_tags"]
        assert "outdoor" in out["aesthetic_tags"]

    def test_private_profile(self):
        from clapcheeks.social.ig_parser import parse_ig_user_feed

        raw = {
            "data": {
                "user": {
                    "username": "locked_account",
                    "is_private": True,
                    "edge_followed_by": {"count": 243},
                    "edge_owner_to_timeline_media": {"count": 57, "edges": []},
                }
            }
        }
        out = parse_ig_user_feed(raw)
        assert out["is_private"] is True
        assert out["follower_count"] == 243
        assert out["post_count"] == 57
        assert out["recent_posts"] == []

    def test_missing_user_returns_empty(self):
        from clapcheeks.social.ig_parser import parse_ig_user_feed

        assert parse_ig_user_feed({})["handle"] is None
        assert parse_ig_user_feed(None)["handle"] is None
        assert parse_ig_user_feed({"nothing": "here"})["handle"] is None

    def test_result_envelope_unwraps(self):
        from clapcheeks.social.ig_parser import parse_ig_user_feed

        env = {"status_code": 200, "body": WEB_PROFILE_INFO_SAMPLE}
        out = parse_ig_user_feed(env)
        assert out["handle"] == "sarah.m"

    def test_captures_up_to_12_posts(self):
        from clapcheeks.social.ig_parser import parse_ig_user_feed

        edges = [
            {"node": {
                "shortcode": f"c{i}",
                "taken_at_timestamp": 1700000000 + i * 86400,
                "edge_media_to_caption": {
                    "edges": [{"node": {"text": f"post {i} #tag{i % 3}"}}]
                },
                "edge_liked_by": {"count": i * 10},
            }}
            for i in range(20)
        ]
        raw = {"data": {"user": {
            "username": "prolific",
            "edge_owner_to_timeline_media": {"count": 20, "edges": edges},
        }}}
        out = parse_ig_user_feed(raw)
        assert len(out["recent_posts"]) == 12


class TestAggregateIgIntel:
    def test_summary_is_ascii_only(self):
        from clapcheeks.social.ig_parser import (
            aggregate_ig_intel, parse_ig_user_feed,
        )

        out = parse_ig_user_feed(WEB_PROFILE_INFO_SAMPLE)
        summary = aggregate_ig_intel(out)
        assert all(ord(c) < 128 for c in summary), summary

    def test_summary_has_no_em_dashes(self):
        from clapcheeks.social.ig_parser import (
            aggregate_ig_intel, parse_ig_user_feed,
        )

        out = parse_ig_user_feed(WEB_PROFILE_INFO_SAMPLE)
        summary = aggregate_ig_intel(out)
        assert "\u2014" not in summary
        assert "\u2013" not in summary

    def test_summary_under_280_chars(self):
        from clapcheeks.social.ig_parser import (
            aggregate_ig_intel, parse_ig_user_feed,
        )

        out = parse_ig_user_feed(WEB_PROFILE_INFO_SAMPLE)
        assert len(aggregate_ig_intel(out)) <= 280

    def test_private_profile_summary(self):
        from clapcheeks.social.ig_parser import aggregate_ig_intel

        parsed = {
            "handle": "locked_account",
            "is_private": True,
            "follower_count": 243,
            "post_count": 57,
        }
        s = aggregate_ig_intel(parsed)
        assert "Private IG" in s
        assert "@locked_account" in s

    def test_empty_parsed_returns_empty(self):
        from clapcheeks.social.ig_parser import aggregate_ig_intel

        assert aggregate_ig_intel(None) == ""
        assert aggregate_ig_intel({}) == ""
        assert aggregate_ig_intel({"handle": None}) == ""

    def test_very_long_captions_stripped_to_limit(self):
        from clapcheeks.social.ig_parser import (
            aggregate_ig_intel, parse_ig_user_feed,
        )

        long_caption = "travel " * 1000 + "#wanderlust " * 100
        raw = {"data": {"user": {
            "username": "chatty",
            "edge_owner_to_timeline_media": {"count": 1, "edges": [
                {"node": {
                    "shortcode": "c",
                    "taken_at_timestamp": 1700000000,
                    "edge_media_to_caption": {
                        "edges": [{"node": {"text": long_caption}}]
                    },
                    "edge_liked_by": {"count": 5},
                }}
            ]},
        }}}
        out = parse_ig_user_feed(raw)
        assert len(aggregate_ig_intel(out)) <= 280


class _FakeResponse:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body
        self.text = str(body) if body is not None else ""

    def json(self):
        return self._body


class TestEnrichOne:
    def test_happy_path_writes_intel(self):
        from clapcheeks import ig_enrich

        match = {
            "id": "m-1", "user_id": "u-1",
            "bio": "", "prompts_jsonb": [],
            "instagram_handle": "sarah.m",
        }

        with patch.object(ig_enrich, "enqueue_job", return_value="job-1") as eq, \
             patch.object(ig_enrich, "wait_for_completion",
                          return_value={"status_code": 200, "body": WEB_PROFILE_INFO_SAMPLE}) as wf, \
             patch.object(ig_enrich, "_creds", return_value=("https://x.supabase.co", "k")), \
             patch("requests.patch") as rp:
            rp.return_value = _FakeResponse(204)

            result = ig_enrich.enrich_one(match)

            assert result["status"] == "ok"
            assert result["handle"] == "sarah.m"
            assert result["summary"]
            assert eq.call_count == 1
            assert wf.call_count == 1
            assert rp.call_count == 1
            sent_body = rp.call_args.kwargs["json"]
            assert "instagram_intel" in sent_body
            assert sent_body["instagram_is_private"] is False
            assert sent_body["instagram_intel"]["handle"] == "sarah.m"
            assert "summary" in sent_body["instagram_intel"]

    def test_handle_discovered_from_bio_when_column_empty(self):
        from clapcheeks import ig_enrich

        match = {
            "id": "m-2", "user_id": "u-1",
            "bio": "nyc. IG: @zora.vibes",
            "prompts_jsonb": [],
            "instagram_handle": None,
        }
        with patch.object(ig_enrich, "enqueue_job", return_value="job-2") as eq, \
             patch.object(ig_enrich, "wait_for_completion",
                          return_value={"status_code": 200,
                                        "body": {"data": {"user": {
                                            "username": "zora.vibes",
                                            "is_private": False,
                                            "edge_followed_by": {"count": 500},
                                            "edge_owner_to_timeline_media": {
                                                "count": 10, "edges": [],
                                            },
                                        }}}}), \
             patch.object(ig_enrich, "_creds", return_value=("https://x.supabase.co", "k")), \
             patch("requests.patch", return_value=_FakeResponse(204)):

            result = ig_enrich.enrich_one(match)
            assert result["handle"] == "zora.vibes"
            called_url = eq.call_args.kwargs["url"]
            assert "zora.vibes" in called_url

    def test_private_profile_flagged(self):
        from clapcheeks import ig_enrich

        match = {
            "id": "m-3", "user_id": "u-1",
            "instagram_handle": "private_account",
        }
        private_body = {"data": {"user": {
            "username": "private_account",
            "is_private": True,
            "edge_followed_by": {"count": 42},
            "edge_owner_to_timeline_media": {"count": 17, "edges": []},
        }}}
        with patch.object(ig_enrich, "enqueue_job", return_value="job-3"), \
             patch.object(ig_enrich, "wait_for_completion",
                          return_value={"status_code": 200, "body": private_body}), \
             patch.object(ig_enrich, "_creds", return_value=("https://x.supabase.co", "k")), \
             patch("requests.patch") as rp:
            rp.return_value = _FakeResponse(204)
            result = ig_enrich.enrich_one(match)
            assert result["status"] == "private"
            sent = rp.call_args.kwargs["json"]
            assert sent["instagram_is_private"] is True
            assert sent["instagram_intel"]["private"] is True

    def test_no_handle_persists_marker(self):
        from clapcheeks import ig_enrich

        match = {"id": "m-4", "user_id": "u-1",
                 "bio": "no social media here", "prompts_jsonb": [],
                 "instagram_handle": None}
        with patch.object(ig_enrich, "enqueue_job") as eq, \
             patch.object(ig_enrich, "_creds",
                          return_value=("https://x.supabase.co", "k")), \
             patch("requests.patch") as rp:
            rp.return_value = _FakeResponse(204)
            result = ig_enrich.enrich_one(match)
            assert result["status"] == "no_handle"
            assert eq.call_count == 0
            assert rp.call_count == 1
            sent = rp.call_args.kwargs["json"]
            assert sent["instagram_intel"]["error"] == "no_handle_found"

    def test_fallback_endpoint_when_primary_fails(self):
        from clapcheeks import ig_enrich

        match = {"id": "m-5", "user_id": "u-1",
                 "instagram_handle": "sarah.m"}
        with patch.object(ig_enrich, "enqueue_job",
                          side_effect=["job-primary", "job-fallback"]) as eq, \
             patch.object(ig_enrich, "wait_for_completion",
                          side_effect=[
                              {"status_code": 500, "body": None},
                              {"status_code": 200,
                               "body": {"graphql": {"user": {
                                   "username": "sarah.m",
                                   "is_private": False,
                                   "edge_followed_by": {"count": 1},
                                   "edge_owner_to_timeline_media": {
                                       "count": 1, "edges": [],
                                   },
                               }}}},
                          ]), \
             patch.object(ig_enrich, "_creds",
                          return_value=("https://x.supabase.co", "k")), \
             patch("requests.patch", return_value=_FakeResponse(204)):
            result = ig_enrich.enrich_one(match)
            assert result["status"] == "ok"
            assert eq.call_count == 2
            urls = [c.kwargs["url"] for c in eq.call_args_list]
            assert "web_profile_info" in urls[0]
            assert "__a=1" in urls[1]

    def test_job_enqueue_uses_ig_user_feed_type(self):
        from clapcheeks import ig_enrich

        match = {"id": "m-6", "user_id": "u-1",
                 "instagram_handle": "anyone"}
        with patch.object(ig_enrich, "enqueue_job",
                          return_value="job") as eq, \
             patch.object(ig_enrich, "wait_for_completion",
                          return_value={"status_code": 404, "body": None}), \
             patch.object(ig_enrich, "_creds",
                          return_value=("https://x.supabase.co", "k")), \
             patch("requests.patch", return_value=_FakeResponse(204)):
            ig_enrich.enrich_one(match)
            assert eq.call_args.kwargs["job_type"] == "ig_user_feed"
            assert eq.call_args.kwargs["platform"] == "instagram"


class TestRunOnce:
    def test_run_once_with_no_candidates(self):
        from clapcheeks import ig_enrich

        with patch.object(ig_enrich, "find_matches_needing_ig", return_value=[]):
            stats = ig_enrich.run_once()
            assert stats["scanned"] == 0
            assert stats["enriched"] == 0

    def test_run_once_aggregates_per_match_statuses(self):
        from clapcheeks import ig_enrich

        matches = [
            {"id": "m-a", "user_id": "u", "instagram_handle": "a"},
            {"id": "m-b", "user_id": "u", "instagram_handle": "b"},
            {"id": "m-c", "user_id": "u", "instagram_handle": "c"},
        ]
        side_effects = [
            {"match_id": "m-a", "handle": "a", "status": "ok"},
            {"match_id": "m-b", "handle": "b", "status": "private"},
            {"match_id": "m-c", "handle": "c", "status": "fetch_failed"},
        ]
        with patch.object(ig_enrich, "find_matches_needing_ig",
                          return_value=matches), \
             patch.object(ig_enrich, "enrich_one",
                          side_effect=side_effects):
            stats = ig_enrich.run_once()
            assert stats["scanned"] == 3
            assert stats["enriched"] == 1
            assert stats["private"] == 1
            assert stats["fetch_failed"] == 1
