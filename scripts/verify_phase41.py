#!/usr/bin/env python3
"""Verify Phase 41 Conversation Intelligence (AI-8326).

Runs the analyzer / strategy / red-flag modules end-to-end against fixture
conversations and asserts behavior. Exits non-zero on any failure so it can
be wired into CI.

Run: python3 scripts/verify_phase41.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the agent package importable when running from repo root.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent"))

from clapcheeks.conversation.analyzer import analyze_conversation  # noqa: E402
from clapcheeks.conversation.strategy import (  # noqa: E402
    generate_strategy,
    render_strategy_for_prompt,
)
from clapcheeks.conversation.red_flags import detect_red_flags, red_flag_summary  # noqa: E402


def _msg(role, text, ts=None):
    out = {"role": role, "content": text}
    if ts:
        out["sent_at"] = ts
    return out


HOT = [
    _msg("assistant", "saw you climbed in joshua tree, that takes some serious nerve",
         "2026-04-20T19:00:00Z"),
    _msg("user", "haha thanks!! it was actually my first lead climb. terrifying but amazing",
         "2026-04-20T19:02:00Z"),
    _msg("assistant", "what got you into climbing", "2026-04-20T19:05:00Z"),
    _msg("user", "my older brother dragged me to a gym two years ago and i got obsessed. "
                 "do you climb? we should go sometime", "2026-04-20T19:07:00Z"),
    _msg("assistant", "i bouldered for a while in encinitas. would love to go outdoor with you",
         "2026-04-20T19:30:00Z"),
    _msg("user", "yes!! mission gorge has some easy outdoor routes if you wanna start there. "
                 "what are you doing this weekend?", "2026-04-20T19:33:00Z"),
    _msg("assistant", "saturday is wide open", "2026-04-20T19:40:00Z"),
    _msg("user", "perfect 😉 give me your number and i'll text you the time",
         "2026-04-20T19:42:00Z"),
]

COLD = [
    _msg("assistant", "hey how was your weekend"),
    _msg("user", "k"),
    _msg("assistant", "did you do anything fun"),
    _msg("user", "no"),
    _msg("assistant", "any plans coming up"),
    _msg("user", "lol idk"),
    _msg("assistant", "i was thinking of grabbing food this week"),
    _msg("user", "ok"),
]

SCAM = [
    _msg("user", "hi handsome, you seem really sweet"),
    _msg("assistant", "thanks, you too"),
    _msg("user", "i feel like we have something special. you might be the one i've been waiting for"),
    _msg("assistant", "haha that's intense, we just matched"),
    _msg("user", "i want to facetime but my camera is broken right now"),
    _msg("assistant", "no worries"),
    _msg("user", "actually can i ask you something. my mom is in the hospital and i'm "
                 "stuck overseas. can you help with cashapp? i'll pay you back"),
    _msg("assistant", "uh, no"),
    _msg("user", "let's chat on telegram, my username is @sweet_emily_2024"),
]

INCONSISTENT = [
    _msg("user", "hey im 28 and live in san diego"),
    _msg("assistant", "cool, what part?"),
    _msg("user", "north park, you?"),
    _msg("assistant", "encinitas"),
    _msg("user", "haha i actually live in los angeles, i was just visiting"),
    _msg("assistant", "ok"),
    _msg("user", "im 32 by the way"),
]


def section(name):
    print(f"\n=== {name} ===")


def assert_true(cond, msg):
    if not cond:
        raise AssertionError(f"FAIL: {msg}")
    print(f"  OK  {msg}")


def main() -> int:
    failures = 0

    try:
        section("CONV-01 analyzer")
        a = analyze_conversation([])
        assert_true(a.message_count == 0, "empty conversation safe")
        assert_true(a.engagement_level == "cold", "empty -> cold")

        a = analyze_conversation(HOT)
        assert_true(a.message_count == 8, "hot count = 8")
        assert_true(a.her_message_count == 4, "her count = 4")
        assert_true(a.engagement_level in {"warm", "hot"}, f"hot engagement (got {a.engagement_level})")
        assert_true(a.flirtation_level > 0.0, f"hot flirtation > 0 (got {a.flirtation_level})")
        assert_true(a.sentiment_score > 0.0, f"hot sentiment > 0 (got {a.sentiment_score})")
        assert_true(a.response_time.her_median_seconds is not None, "her response time computed")
        assert_true(a.emoji_frequency > 0.0, "emoji frequency > 0")
        assert_true(bool(a.topics), f"topics extracted (got {list(a.topics)})")

        a = analyze_conversation(COLD)
        assert_true(a.engagement_level == "cold", "cold -> cold")

        # Alternative key shapes
        msgs = [{"sender": "her", "text": "hey"}, {"sender": "us", "text": "hi"}]
        a = analyze_conversation(msgs)
        assert_true(a.her_message_count == 1 and a.us_message_count == 1,
                    "sender/text keys handled")

        section("CONV-02 strategy")
        s = generate_strategy({}, HOT)
        assert_true(len(s.try_topics) == 5, f"5 try_topics (got {len(s.try_topics)})")
        assert_true(len(s.avoid_topics) <= 3, f"<=3 avoid_topics (got {len(s.avoid_topics)})")
        assert_true(s.move_to_text_score >= 70,
                    f"hot conversation move score >= 70 (got {s.move_to_text_score}: {s.rationale})")

        s_cold = generate_strategy({}, COLD)
        assert_true(s_cold.move_to_text_score < 50,
                    f"cold conversation move score < 50 (got {s_cold.move_to_text_score})")

        s_emma = generate_strategy({"interests": ["climbing", "ramen", "techno"]}, HOT)
        assert_true("climbing" in s_emma.try_topics, "interests appear in try_topics")
        assert_true("ramen" in s_emma.try_topics, "ramen in try_topics")

        s_rf = generate_strategy({"red_flags": ["no_hookups"]}, HOT)
        assert_true(
            "sex_flirt" in s_rf.avoid_topics or "future_plans" in s_rf.avoid_topics,
            "red flags propagate to avoid_topics",
        )

        block = render_strategy_for_prompt(s_emma)
        assert_true("CONVERSATION STRATEGY" in block, "render produces prompt block")
        assert_true("climbing" in block, "render includes try_topics")

        section("CONV-05 red flags")
        flags = detect_red_flags(HOT)
        assert_true(flags == [], f"hot conversation = no flags (got {[f.code for f in flags]})")

        flags = detect_red_flags(COLD)
        codes = [f.code for f in flags]
        assert_true("low_effort" in codes, f"cold -> low_effort (got {codes})")

        flags = detect_red_flags(SCAM)
        codes = [f.code for f in flags]
        assert_true("financial_request" in codes, "scam -> financial_request")
        assert_true("love_bombing" in codes, "scam -> love_bombing")
        assert_true("catfish_indicators" in codes, "scam -> catfish_indicators")
        assert_true("external_redirect" in codes, "scam -> external_redirect")
        fin = next(f for f in flags if f.code == "financial_request")
        assert_true(fin.severity == "critical", "financial_request severity = critical")

        flags = detect_red_flags(INCONSISTENT)
        codes = [f.code for f in flags]
        assert_true("inconsistent" in codes, f"INCONSISTENT -> inconsistent (got {codes})")

        s = red_flag_summary(detect_red_flags(SCAM))
        assert_true(s["flagged"] is True, "summary flagged=True")
        assert_true(s["max_severity"] == "critical", "summary max_severity=critical")
        s = red_flag_summary([])
        assert_true(s["flagged"] is False, "empty summary flagged=False")

    except AssertionError as e:
        print(str(e))
        failures += 1

    print()
    if failures:
        print(f"FAILED: {failures} assertion(s) failed.")
        return 1
    print("PASSED: all Phase 41 verifications green.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
