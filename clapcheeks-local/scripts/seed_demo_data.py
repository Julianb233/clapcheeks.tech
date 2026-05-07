#!/usr/bin/env python3
"""Seed demo data into Convex dev (valiant-oriole-651).

Creates 3 fake people, ~30 messages, 4 scheduled_touches, and 1 pending_links
row so every Clapcheeks dashboard page has content during dev/demo sessions.

Usage:
    python scripts/seed_demo_data.py            # seed
    python scripts/seed_demo_data.py --wipe     # delete all Demo: rows

SAFETY BRAKE:
    All seeded people have whitelist_for_autoreply=False.
    The AI will NEVER auto-send to demo handles.

Linear: AI-9500-H (AI-9506)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

ENV: dict[str, str] = {}
for p in (
    Path("/opt/agency-workspace/clapcheeks.tech/web/.env.local"),
    Path("/opt/agency-workspace/clapcheeks.tech/.env.local"),
    Path.home() / ".clapcheeks" / ".env",
):
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                ENV.setdefault(k.strip(), v.strip().strip('"').strip("'"))

CONVEX_URL: str = ENV.get("CONVEX_URL") or ENV.get("NEXT_PUBLIC_CONVEX_URL", "")
CONVEX_DEPLOY_KEY: str = ENV.get("CONVEX_DEPLOY_KEY", "")
USER_ID: str = ENV.get("CONVEX_FLEET_USER_ID", "fleet-julian")

if not CONVEX_URL:
    sys.exit("FATAL: CONVEX_URL / NEXT_PUBLIC_CONVEX_URL not set in .env files.")

CONVEX_URL = CONVEX_URL.rstrip("/")


# ---------------------------------------------------------------------------
# Low-level Convex HTTP client
# ---------------------------------------------------------------------------

def _call(fn_path: str, args: dict[str, Any]) -> Any:
    """Call a Convex mutation or query via the HTTP API.

    ``fn_path`` examples:
        ``people:insert``  (mutation)
        ``conversations:findByHandle``  (query)

    Uses admin auth if CONVEX_DEPLOY_KEY is available.
    """
    url = f"{CONVEX_URL}/api/run/{fn_path}"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if CONVEX_DEPLOY_KEY:
        headers["Authorization"] = f"Convex {CONVEX_DEPLOY_KEY}"

    payload = json.dumps({"args": args}).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            data = json.loads(body)
            # Convex HTTP API returns {"status": "success", "value": ...} or {"status": "error", ...}
            if isinstance(data, dict) and data.get("status") == "error":
                raise RuntimeError(f"Convex error from {fn_path}: {data}")
            # value field holds the actual return, but raw response is fine for mutations
            return data.get("value") if isinstance(data, dict) and "value" in data else data
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {exc.code} calling {fn_path}: {body}") from exc


# Convenience aliases
def _mutate(fn: str, args: dict[str, Any]) -> Any:
    return _call(fn, args)

def _query(fn: str, args: dict[str, Any]) -> Any:
    return _call(fn, args)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _days_ago_ms(days: float) -> int:
    return int((_now_ms() - days * 86_400_000))


def _tomorrow_at(hour: int) -> int:
    """Return unix-ms for tomorrow at ``hour`` local time."""
    import datetime
    now = datetime.datetime.now()
    tomorrow = now + datetime.timedelta(days=1)
    target = tomorrow.replace(hour=hour, minute=0, second=0, microsecond=0)
    return int(target.timestamp() * 1000)


# ---------------------------------------------------------------------------
# Seed data definitions
# ---------------------------------------------------------------------------

DEMO_PEOPLE = [
    {
        "display_name": "Demo: Sarah Chen",
        "handles": [{"channel": "imessage", "value": "+15551110001", "verified": False, "primary": True}],
        "status": "lead",
        "whitelist_for_autoreply": False,
        "courtship_stage": "early_chat",
        "trust_score": 0.4,
        "vibe_classification": "dating",
        "vibe_confidence": 0.85,
        "interests": ["climbing", "coffee", "indie films"],
        "goals": ["find connection", "travel more"],
        "values": ["authenticity", "adventure"],
        "boundaries_stated": ["no late-night texts"],
        "disc_primary": "I",
        "disc_type": "I/S",
        "cadence_profile": "warm",
        "engagement_score": 0.55,
        "response_rate": 0.7,
        "conversation_temperature": "warm",
        "things_she_loves": ["witty banter", "spontaneous plans"],
        "green_flags": ["replies same day", "shares personal stories"],
        "red_flags": [],
        "context_notes": "Met on Hinge. Laughed at my pineapple-pizza take. Works in UX design.",
        "active_hours_local": {"tz": "America/Los_Angeles", "start_hour": 9, "end_hour": 22},
        # Demographics surfaced in Task A profile importer (not in schema yet — store in raw_profile)
        "_meta": {"age": 27, "location": "San Francisco", "zodiac_sign": "Libra"},
    },
    {
        "display_name": "Demo: Kate Morgan",
        "handles": [{"channel": "imessage", "value": "+15551110002", "verified": False, "primary": True}],
        "status": "lead",
        "whitelist_for_autoreply": False,
        "courtship_stage": "warming",
        "trust_score": 0.6,
        "vibe_classification": "dating",
        "vibe_confidence": 0.78,
        "interests": ["pottery", "running"],
        "goals": ["build something with my hands", "half marathon PR"],
        "values": ["consistency", "depth"],
        "boundaries_stated": ["I don't drink"],
        "disc_primary": "C",
        "disc_type": "C/S",
        "cadence_profile": "slow_burn",
        "engagement_score": 0.68,
        "response_rate": 0.82,
        "conversation_temperature": "warm",
        "things_she_loves": ["thoughtful questions", "follow-through"],
        "green_flags": ["asks follow-up questions", "initiates sometimes"],
        "red_flags": ["slow to open up"],
        "context_notes": "Bumble match. Nurse practitioner. Runs 5 days a week.",
        "active_hours_local": {"tz": "America/New_York", "start_hour": 7, "end_hour": 21},
        "_meta": {"age": 29, "location": "Brooklyn", "zodiac_sign": "Virgo"},
    },
    {
        "display_name": "Demo: Mia Rivera",
        "handles": [{"channel": "imessage", "value": "+15551110003", "verified": False, "primary": True}],
        "status": "lead",
        "whitelist_for_autoreply": False,
        "courtship_stage": "cooling",
        "trust_score": 0.3,
        "vibe_classification": "dating",
        "vibe_confidence": 0.61,
        "interests": ["DJ sets", "nightlife"],
        "goals": ["launch an events brand"],
        "values": ["freedom", "energy"],
        "boundaries_stated": [],
        "disc_primary": "D",
        "disc_type": "D/I",
        "cadence_profile": "dormant",
        "engagement_score": 0.25,
        "response_rate": 0.3,
        "conversation_temperature": "cool",
        "things_she_loves": ["bold moves", "live music"],
        "green_flags": ["high energy when she does reply"],
        "red_flags": ["erratic reply pattern", "goes silent for days"],
        "context_notes": "Tinder match. Event promoter in Austin. Replies in bursts.",
        "active_hours_local": {"tz": "America/Chicago", "start_hour": 14, "end_hour": 2},
        "_meta": {"age": 24, "location": "Austin", "zodiac_sign": "Sagittarius"},
    },
]

# Message threads: alternating inbound/outbound, spaced over last 10 days
DEMO_MESSAGES: list[dict[str, Any]] = [
    # Sarah Chen — 10 messages
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 10.0,
        "body": "Hey Sarah — that pineapple-pizza hill-dying energy you mentioned... was that a test?",
        "source": "user",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 9.8,
        "body": "Haha full test, you passed. Pineapple doesn't belong anywhere near a pizza.",
        "source": "import",
    },
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 9.5,
        "body": "Bold stance for someone who put avocado in their Taco Tuesday reel 😂 caught you.",
        "source": "ai_suggestion_approved",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 9.2,
        "body": "Okay okay FAIR. Avocado is different though. It's a lifestyle.",
        "source": "import",
    },
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 7.0,
        "body": "Tried that climbing gym on Valencia you mentioned. My forearms have retired.",
        "source": "ai_auto_send",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 6.8,
        "body": "Nooo which wall?? The 5.10s near the back destroy people the first time",
        "source": "import",
    },
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 6.5,
        "body": "Every single one. Walked out like a T-Rex. Worth it.",
        "source": "user",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 5.0,
        "body": "That's actually hilarious. I go Thursday mornings if you ever want a real guide 😄",
        "source": "import",
    },
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 4.0,
        "body": "Thursday mornings? I'll block my calendar. What's the T-Rex rehab protocol?",
        "source": "ai_suggestion_approved",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 3.5,
        "body": "Cold brew and ego death. See you there.",
        "source": "import",
    },

    # Kate Morgan — 10 messages
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 10.0,
        "body": "Running question: do you track heart rate or just go by feel?",
        "source": "user",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 9.9,
        "body": "Both — I use a Garmin but when I'm really in the zone I forget to check it.",
        "source": "import",
    },
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 9.5,
        "body": "That's the good stuff. Zone 2 vs zone 4 debate — where do you land?",
        "source": "ai_suggestion_approved",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 9.0,
        "body": "80% zone 2, 20% suffering. Science + masochism.",
        "source": "import",
    },
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 7.0,
        "body": "Just signed up for a half. You said you're training for one too?",
        "source": "user",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 6.5,
        "body": "Yes! Brooklyn Half in May. Are you doing one in California?",
        "source": "import",
    },
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 6.0,
        "body": "San Francisco Half — we should compare training notes.",
        "source": "ai_suggestion_approved",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 5.0,
        "body": "I'd actually love that. I'll send you my Garmin plan.",
        "source": "import",
    },
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 3.0,
        "body": "Just did a 10 miler. Your zone 2 advice: actually works.",
        "source": "user",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 2.5,
        "body": "Told you 😊 How did the last 2 miles feel?",
        "source": "import",
    },

    # Mia Rivera — 8 messages (sporadic, reflecting cooling stage)
    {
        "person_idx": 2, "direction": "outbound", "days_ago": 10.0,
        "body": "Saw Disclosure was in Austin last week — you make it?",
        "source": "user",
    },
    {
        "person_idx": 2, "direction": "inbound", "days_ago": 8.0,
        "body": "OBVIOUSLY. Front row. Was insane.",
        "source": "import",
    },
    {
        "person_idx": 2, "direction": "outbound", "days_ago": 7.5,
        "body": "Front row respect. Set list?",
        "source": "user",
    },
    {
        "person_idx": 2, "direction": "inbound", "days_ago": 5.0,
        "body": "Sorry been so busy with the event we're throwing next weekend",
        "source": "import",
    },
    {
        "person_idx": 2, "direction": "outbound", "days_ago": 4.5,
        "body": "What's the event? Austin or traveling?",
        "source": "ai_suggestion_approved",
    },
    {
        "person_idx": 2, "direction": "inbound", "days_ago": 3.0,
        "body": "Austin! East Side. I'm handling all the booking.",
        "source": "import",
    },
    {
        "person_idx": 2, "direction": "outbound", "days_ago": 2.5,
        "body": "That's a real thing you're building. Who's headlining?",
        "source": "user",
    },
    {
        "person_idx": 2, "direction": "inbound", "days_ago": 2.0,
        "body": "Can't say yet 🙈 will send you a link when it's live",
        "source": "import",
    },
]

# Scheduled touches
DEMO_TOUCHES = [
    {
        "person_idx": 0,
        "touch_type": "callback_reference",
        "scheduled_for_fn": lambda: _tomorrow_at(14),  # Sarah: 2pm tomorrow
        "draft_body": "Thursday climbing — still on? My T-Rex arms are at 60%.",
        "status": "scheduled",
    },
    {
        "person_idx": 1,
        "touch_type": "reengage_low_temp",
        "scheduled_for_fn": lambda: _tomorrow_at(11),  # Kate: 11am tomorrow
        "draft_body": "Quick check-in — how did the long run go this week?",
        "status": "scheduled",
    },
    {
        "person_idx": 2,
        "touch_type": "pattern_interrupt",
        "scheduled_for_fn": lambda: _tomorrow_at(19),  # Mia: 7pm tomorrow
        "draft_body": "Heads up — there's a rooftop thing Saturday if you want to scout post-event.",
        "status": "scheduled",
    },
    {
        "person_idx": 0,
        "touch_type": "nudge",
        # Already fired (in the past — 3 days ago)
        "scheduled_for_fn": lambda: _days_ago_ms(3),
        "draft_body": "Hey — just thinking of that UX rabbit hole you mentioned.",
        "status": "fired",
    },
]


# ---------------------------------------------------------------------------
# Seed / wipe logic
# ---------------------------------------------------------------------------

def _insert_person(p: dict[str, Any], user_id: str) -> str:
    """Insert one demo person and return the Convex _id."""
    meta = p.pop("_meta", {})
    now = _now_ms()
    row: dict[str, Any] = {
        **p,
        "user_id": user_id,
        "raw_profile": meta,  # store age, location, zodiac here (Task A adds schema fields)
        "created_at": now,
        "updated_at": now,
    }
    result = _mutate("people:insertDemoRow", row)
    return result


def _insert_conversation(person_id: str, handle: str, user_id: str) -> str:
    """Create a matching conversation row for the demo person."""
    now = _now_ms()
    row: dict[str, Any] = {
        "user_id": user_id,
        "platform": "imessage",
        "external_match_id": f"demo-{handle}",
        "match_name": None,
        "status": "active",
        "unread_count": 0,
        "imessage_handle": handle,
        "created_at": now,
        "updated_at": now,
    }
    result = _mutate("conversations:insertDemoRow", row)
    return result


def _insert_message(
    conversation_id: str,
    user_id: str,
    direction: str,
    body: str,
    days_ago: float,
    source: str,
) -> None:
    sent_at = _days_ago_ms(days_ago)
    _mutate("messages:append", {
        "conversation_id": conversation_id,
        "user_id": user_id,
        "direction": direction,
        "body": body,
        "sent_at": sent_at,
        "source": source,
    })


def _insert_touch(
    person_id: str,
    user_id: str,
    touch_type: str,
    scheduled_for: int,
    draft_body: str,
    status: str,
) -> None:
    _mutate("touches:insertDemoTouch", {
        "user_id": user_id,
        "person_id": person_id,
        "touch_type": touch_type,
        "scheduled_for": scheduled_for,
        "draft_body": draft_body,
        "status": status,
    })


def _insert_pending_link(conversation_id: str, person_ids: list[str], user_id: str) -> None:
    now = _now_ms()
    _mutate("pendingLinks:insertDemoRow", {
        "user_id": user_id,
        "conversation_id": conversation_id,
        "handle_channel": "imessage",
        "handle_value": "+15551112222",
        "candidate_person_ids": person_ids,
        "raw_context": "Hey it's me from the other night",
        "status": "open",
        "created_at": now,
        "updated_at": now,
    })


def seed(user_id: str) -> None:
    print(f"Seeding demo data into {CONVEX_URL} as user={user_id} ...")

    inserted_people: list[str] = []
    inserted_conversations: list[str] = []
    message_count = 0

    for person_data in DEMO_PEOPLE:
        p = dict(person_data)  # copy so we don't mutate the const
        handle = p["handles"][0]["value"]
        name = p["display_name"]

        print(f"  inserting person: {name} ({handle})")
        person_id = _insert_person(p, user_id)
        inserted_people.append(person_id)

        print(f"    -> person_id={person_id}  inserting conversation ...")
        conv_id = _insert_conversation(person_id, handle, user_id)
        inserted_conversations.append(conv_id)

    # Insert messages
    for msg in DEMO_MESSAGES:
        idx = msg["person_idx"]
        conv_id = inserted_conversations[idx]
        _insert_message(
            conversation_id=conv_id,
            user_id=user_id,
            direction=msg["direction"],
            body=msg["body"],
            days_ago=msg["days_ago"],
            source=msg["source"],
        )
        message_count += 1

    # Insert touches
    touch_count = 0
    for t in DEMO_TOUCHES:
        idx = t["person_idx"]
        person_id = inserted_people[idx]
        scheduled_for = t["scheduled_for_fn"]()
        _insert_touch(
            person_id=person_id,
            user_id=user_id,
            touch_type=t["touch_type"],
            scheduled_for=scheduled_for,
            draft_body=t["draft_body"],
            status=t["status"],
        )
        touch_count += 1

    # Insert 1 pending_link using the first two demo people as ambiguous candidates
    _insert_pending_link(
        conversation_id=inserted_conversations[0],
        person_ids=inserted_people[:2],
        user_id=user_id,
    )

    print()
    print(
        f"seeded: {len(inserted_people)} people, {message_count} messages, "
        f"{touch_count} touches, 1 pending_link."
    )
    print()
    print("To wipe:  python scripts/seed_demo_data.py --wipe")
    print("People:   /admin/clapcheeks-ops/network (look for 'Demo:' prefix)")
    print("Touches:  /admin/clapcheeks-ops/touches")
    print("Links:    /admin/clapcheeks-ops/pending-links")


def wipe(user_id: str) -> None:
    """Delete all rows where display_name starts with 'Demo:'.

    Avoids touching schema — uses the display_name prefix convention rather
    than a seed_demo field so no schema change is required.

    The Convex mutation people:deleteDemoRows handles the cascade:
    it deletes matching people rows AND their linked conversations,
    messages, touches, and pending_links.
    """
    print(f"Wiping demo rows from {CONVEX_URL} as user={user_id} ...")
    result = _mutate("people:deleteDemoRows", {
        "user_id": user_id,
        "display_name_prefix": "Demo: ",
    })
    print(f"Wiped: {result}")
    print("Done.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed (or wipe) Clapcheeks demo data in Convex dev.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Delete all rows with display_name starting with 'Demo: '.",
    )
    parser.add_argument(
        "--user-id",
        default=USER_ID,
        help=f"Convex user_id to stamp on rows (default: {USER_ID!r})",
    )
    parser.add_argument(
        "--convex-url",
        default=CONVEX_URL,
        help="Override Convex deployment URL.",
    )
    args = parser.parse_args()

    global CONVEX_URL
    CONVEX_URL = args.convex_url.rstrip("/")

    if args.wipe:
        wipe(args.user_id)
    else:
        seed(args.user_id)


if __name__ == "__main__":
    main()
