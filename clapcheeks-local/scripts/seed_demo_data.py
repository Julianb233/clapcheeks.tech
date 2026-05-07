#!/usr/bin/env python3
"""Seed demo data into Convex dev (valiant-oriole-651).

Creates 3 fake people, ~28 messages, 3 scheduled_messages rows, 3
scheduled_touches rows, and 1 pending_links row so every Clapcheeks
dashboard page has content during dev / demo sessions.

Usage
-----
    cd /opt/agency-workspace/clapcheeks.tech
    python clapcheeks-local/scripts/seed_demo_data.py            # seed
    python clapcheeks-local/scripts/seed_demo_data.py --dry-run  # preview, no writes
    python clapcheeks-local/scripts/seed_demo_data.py --wipe     # delete all Demo-seed rows

Env vars (loaded from .env files in order — first match wins)
-------------------------------------------------------------
    CONVEX_URL / NEXT_PUBLIC_CONVEX_URL — Convex deployment URL
    CONVEX_DEPLOY_KEY                   — admin auth key (optional but recommended)
    CONVEX_FLEET_USER_ID                — user_id stamped on rows (default: fleet-julian)

Get the deploy key:
    op item get "CONVEX-clapcheeks-dev-admin-key" --vault API-Keys \\
        --fields credential --reveal

SAFETY BRAKES
-------------
  - whitelist_for_autoreply = False on ALL demo people.
    The AI will NEVER auto-send to demo handles.
  - All demo handles use the +1555111xxxx range (fictitious, reserved).
  - All demo external_guid values start with "seed-demo-" for easy wipe.
  - All demo obsidian_path values start with "Synthetic/Demo" (never a real file).

Wipe strategy
-------------
Wipe mode iterates all people rows where obsidian_path starts with
"Synthetic/Demo-" and deletes them via people:deleteByObsidianPath.
Conversations, messages, scheduled_messages, and scheduled_touches
are NOT cascade-deleted by any existing mutation — they will become
orphaned rows. That's acceptable for dev: wipe the dev deployment
entirely if you need a clean slate (npx convex reset).

Linear: AI-9500-H (AI-9510)
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Environment bootstrap
# ---------------------------------------------------------------------------

_ENV: dict[str, str] = {}
for _p in (
    Path("/opt/agency-workspace/clapcheeks.tech/web/.env.local"),
    Path("/opt/agency-workspace/clapcheeks.tech/.env.local"),
    Path.home() / ".clapcheeks" / ".env",
):
    if _p.exists():
        for _line in _p.read_text().splitlines():
            _line = _line.strip()
            if _line and "=" in _line and not _line.startswith("#"):
                _k, _, _v = _line.partition("=")
                _ENV.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

CONVEX_URL: str = (
    _ENV.get("CONVEX_URL")
    or _ENV.get("NEXT_PUBLIC_CONVEX_URL")
    or os.environ.get("CONVEX_URL", "")
    or os.environ.get("NEXT_PUBLIC_CONVEX_URL", "")
).rstrip("/")

CONVEX_DEPLOY_KEY: str = _ENV.get("CONVEX_DEPLOY_KEY") or os.environ.get("CONVEX_DEPLOY_KEY", "")
USER_ID: str = _ENV.get("CONVEX_FLEET_USER_ID") or os.environ.get("CONVEX_FLEET_USER_ID", "fleet-julian")

# ---------------------------------------------------------------------------
# Low-level Convex HTTP API client (no SDK dependency)
# ---------------------------------------------------------------------------

_DRY_RUN = False  # set by CLI arg


def _convex_call(fn_path: str, args: dict[str, Any]) -> Any:
    """Call a Convex public mutation or query via the REST HTTP API.

    fn_path: e.g. "people:upsertFromObsidian", "messages:append"

    Returns the ``value`` field from the Convex response envelope.
    Raises RuntimeError on Convex-level or HTTP errors.
    """
    if not CONVEX_URL:
        raise RuntimeError(
            "CONVEX_URL / NEXT_PUBLIC_CONVEX_URL not set.\n"
            "Set it in web/.env.local or pass CONVEX_URL=... before the script."
        )
    if _DRY_RUN:
        print(f"    [DRY-RUN] would call {fn_path} with args={json.dumps(args, indent=2)[:200]}...")
        return "__dry_run_id__"

    url = f"{CONVEX_URL}/api/run/{fn_path}"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if CONVEX_DEPLOY_KEY:
        headers["Authorization"] = f"Convex {CONVEX_DEPLOY_KEY}"

    payload = json.dumps({"args": args}).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            if isinstance(data, dict) and data.get("status") == "error":
                raise RuntimeError(f"Convex error in {fn_path}: {data.get('errorMessage', data)}")
            return data.get("value") if isinstance(data, dict) and "value" in data else data
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {exc.code} calling {fn_path}: {body}") from exc


# Aliases
def _mutate(fn: str, args: dict[str, Any]) -> Any:
    return _convex_call(fn, args)


def _query(fn: str, args: dict[str, Any]) -> Any:
    return _convex_call(fn, args)


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def _now_ms() -> int:
    return int(time.time() * 1000)


def _days_ago_ms(days: float) -> int:
    return int(_now_ms() - days * 86_400_000)


def _hours_from_now_ms(hours: float) -> int:
    return int(_now_ms() + hours * 3_600_000)


def _tomorrow_at_hour(hour: int, tz_offset_hours: int = 0) -> int:
    """Return unix-ms for tomorrow at ``hour`` in a fixed UTC offset."""
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=tz_offset_hours)
    tomorrow = (now + datetime.timedelta(days=1)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    utc_back = tomorrow - datetime.timedelta(hours=tz_offset_hours)
    return int(utc_back.timestamp() * 1000)


# ---------------------------------------------------------------------------
# Demo person definitions
# All display_name values start with "Demo " so wipe can find them.
# All obsidian_path values start with "Synthetic/Demo-" for safe deletion.
# All handles use +1555111000x range (fictitious, reserved by NANP).
# whitelist_for_autoreply is ALWAYS False.
# ---------------------------------------------------------------------------

DEMO_PEOPLE: list[dict[str, Any]] = [
    {
        "display_name": "Demo Sarah",
        "obsidian_path": "Synthetic/Demo-Sarah.md",   # synthetic path, never a real file
        "handles": [
            {"channel": "imessage", "value": "+15551110001", "verified": False, "primary": True}
        ],
        "status": "lead",
        "whitelist_for_autoreply": False,
        "courtship_stage": "early_chat",
        "trust_score": 0.4,
        "vibe_classification": "dating",
        "vibe_confidence": 0.85,
        "interests": ["climbing", "coffee", "indie films", "UX design"],
        "goals": ["find real connection", "travel Southeast Asia"],
        "values": ["authenticity", "adventure", "wit"],
        "disc_primary": "I",
        "disc_type": "I/S",
        "cadence_profile": "warm",
        "engagement_score": 0.55,
        "response_rate": 0.70,
        "conversation_temperature": "warm",
        "things_she_loves": ["witty banter", "spontaneous plans", "cold brew"],
        "boundaries_stated": ["no late-night texts"],
        "green_flags": ["replies same day", "shares personal stories", "asked follow-ups"],
        "red_flags": [],
        "compliments_that_landed": ["That pineapple-pizza take was hilarious"],
        "references_to_callback": ["Valencia St climbing gym", "T-Rex forearm day"],
        "next_best_move": "Confirm Thursday climbing — she offered to guide you.",
        "next_best_move_confidence": 0.82,
        "context_notes": (
            "Met on Hinge. Works in UX design, SF. Laughed at my pineapple-pizza take. "
            "Invited me to Thursday morning climbing session."
        ),
        "active_hours_local": {"tz": "America/Los_Angeles", "start_hour": 9, "end_hour": 22},
    },
    {
        "display_name": "Demo Kate",
        "obsidian_path": "Synthetic/Demo-Kate.md",
        "handles": [
            {"channel": "imessage", "value": "+15551110002", "verified": False, "primary": True}
        ],
        "status": "lead",
        "whitelist_for_autoreply": False,
        "courtship_stage": "phone_swap",
        "trust_score": 0.62,
        "vibe_classification": "dating",
        "vibe_confidence": 0.78,
        "interests": ["pottery", "distance running", "nursing", "nutrition"],
        "goals": ["half-marathon PR under 1:55", "build something with her hands"],
        "values": ["consistency", "depth", "discipline"],
        "disc_primary": "D",
        "disc_type": "D/C",
        "cadence_profile": "slow_burn",
        "engagement_score": 0.68,
        "response_rate": 0.82,
        "conversation_temperature": "warm",
        "things_she_loves": ["thoughtful questions", "follow-through", "zone-2 science"],
        "boundaries_stated": ["I don't drink"],
        "green_flags": ["asks follow-up questions", "initiates sometimes", "shared her Garmin plan"],
        "red_flags": ["slow to open up initially"],
        "compliments_that_landed": ["Zone 2 training structure is working"],
        "references_to_callback": ["Brooklyn Half in May", "Garmin training plan"],
        "next_best_move": "Check in on this week's long run — she mentioned targeting 16 miles.",
        "next_best_move_confidence": 0.75,
        "context_notes": (
            "Bumble match. Nurse practitioner in Brooklyn. Runs 5 days/week. "
            "Serious about training — offered to share her Garmin plan."
        ),
        "active_hours_local": {"tz": "America/New_York", "start_hour": 7, "end_hour": 21},
    },
    {
        "display_name": "Demo Maya",
        "obsidian_path": "Synthetic/Demo-Maya.md",
        "handles": [
            {"channel": "imessage", "value": "+15551110003", "verified": False, "primary": True}
        ],
        "status": "lead",
        "whitelist_for_autoreply": False,
        "courtship_stage": "matched",
        "trust_score": 0.28,
        "vibe_classification": "unclear",
        "vibe_confidence": 0.55,
        "interests": ["DJ sets", "nightlife production", "event branding"],
        "goals": ["launch a recurring event brand in Austin"],
        "values": ["freedom", "energy", "creative risk"],
        "disc_primary": "S",
        "disc_type": "S/I",
        "cadence_profile": "dormant",
        "engagement_score": 0.25,
        "response_rate": 0.30,
        "conversation_temperature": "cool",
        "things_she_loves": ["bold moves", "live music", "surprises"],
        "boundaries_stated": [],
        "green_flags": ["high energy when she does reply"],
        "red_flags": ["erratic reply pattern", "goes silent for days"],
        "compliments_that_landed": [],
        "references_to_callback": ["Disclosure show at Austin", "East Side event"],
        "next_best_move": "Pattern interrupt — reference her event launch, ask one specific question.",
        "next_best_move_confidence": 0.51,
        "context_notes": (
            "Tinder match. Event promoter, Austin. Replied to Disclosure concert reference "
            "but went silent again. High potential, low consistency."
        ),
        "active_hours_local": {"tz": "America/Chicago", "start_hour": 14, "end_hour": 2},
    },
]

# Message threads — realistic back-and-forth for each person.
# Timestamps set relative to now so dashboard always shows recent activity.
# external_guid starts with "seed-demo-" for easy wipe identification.
DEMO_MESSAGES: list[dict[str, Any]] = [
    # ---- Demo Sarah — 10 messages ----
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 10.0, "seq": 0,
        "body": "Hey Sarah — that pineapple-pizza hill-dying energy... was that a test?",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 9.8, "seq": 1,
        "body": "Haha full test, you passed. Pineapple doesn't belong anywhere near a pizza.",
    },
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 9.5, "seq": 2,
        "body": "Bold stance for someone with avocado in their Taco Tuesday reel 😂 caught you.",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 9.2, "seq": 3,
        "body": "Okay okay FAIR. Avocado is different though. It's a lifestyle.",
    },
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 7.0, "seq": 4,
        "body": "Tried that climbing gym on Valencia you mentioned. My forearms have retired.",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 6.8, "seq": 5,
        "body": "Nooo which wall?? The 5.10s near the back destroy people the first time",
    },
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 6.5, "seq": 6,
        "body": "Every single one. Walked out like a T-Rex. 100% worth it.",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 5.0, "seq": 7,
        "body": "That's hilarious 😂 I go Thursday mornings if you ever want a real guide.",
    },
    {
        "person_idx": 0, "direction": "outbound", "days_ago": 4.0, "seq": 8,
        "body": "Thursday mornings? I'll block my calendar. What's the T-Rex rehab protocol?",
    },
    {
        "person_idx": 0, "direction": "inbound", "days_ago": 3.5, "seq": 9,
        "body": "Cold brew and ego death. See you there.",
    },

    # ---- Demo Kate — 10 messages ----
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 10.0, "seq": 0,
        "body": "Running question: do you track heart rate or just go by feel?",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 9.9, "seq": 1,
        "body": "Both — I use a Garmin but when I'm in the zone I forget to check it.",
    },
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 9.5, "seq": 2,
        "body": "That's the good stuff. Zone 2 vs zone 4 debate — where do you land?",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 9.0, "seq": 3,
        "body": "80% zone 2, 20% suffering. Science + masochism.",
    },
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 7.0, "seq": 4,
        "body": "Just signed up for a half. You said you're training for one too?",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 6.5, "seq": 5,
        "body": "Yes! Brooklyn Half in May. Are you doing one in California?",
    },
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 6.0, "seq": 6,
        "body": "SF Half — we should compare training notes.",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 5.0, "seq": 7,
        "body": "I'd actually love that. I'll send you my Garmin plan.",
    },
    {
        "person_idx": 1, "direction": "outbound", "days_ago": 3.0, "seq": 8,
        "body": "Just did a 10 miler. Your zone 2 advice: actually works.",
    },
    {
        "person_idx": 1, "direction": "inbound", "days_ago": 2.5, "seq": 9,
        "body": "Told you 😊 How did the last 2 miles feel?",
    },

    # ---- Demo Maya — 8 messages (sporadic, matching 'cool' temperature) ----
    {
        "person_idx": 2, "direction": "outbound", "days_ago": 10.0, "seq": 0,
        "body": "Saw Disclosure was in Austin last week — you make it?",
    },
    {
        "person_idx": 2, "direction": "inbound", "days_ago": 8.0, "seq": 1,
        "body": "OBVIOUSLY. Front row. Was insane.",
    },
    {
        "person_idx": 2, "direction": "outbound", "days_ago": 7.5, "seq": 2,
        "body": "Front row respect. Set list?",
    },
    {
        "person_idx": 2, "direction": "inbound", "days_ago": 5.0, "seq": 3,
        "body": "Sorry been so slammed with this event we're throwing next weekend",
    },
    {
        "person_idx": 2, "direction": "outbound", "days_ago": 4.5, "seq": 4,
        "body": "What's the event? Austin or traveling?",
    },
    {
        "person_idx": 2, "direction": "inbound", "days_ago": 3.0, "seq": 5,
        "body": "Austin! East Side. I'm handling all the booking.",
    },
    {
        "person_idx": 2, "direction": "outbound", "days_ago": 2.5, "seq": 6,
        "body": "That's a real thing you're building. Who's headlining?",
    },
    {
        "person_idx": 2, "direction": "inbound", "days_ago": 2.0, "seq": 7,
        "body": "Can't say yet 🙈 will send you a link when it's live",
    },
]

# scheduled_messages: future sends that will appear on the /touches page.
# scheduled_for is expressed as hours_from_now to stay fresh across runs.
DEMO_SCHEDULED_MESSAGES: list[dict[str, Any]] = [
    {
        "person_idx": 0,
        "body": "Thursday climbing — still on? My T-Rex arms are at 60%.",
        "hours_from_now": 1.0,
        "schedule_reason": "callback_reference",
    },
    {
        "person_idx": 1,
        "body": "Quick check-in — how did the long run go this week?",
        "hours_from_now": 6.0,
        "schedule_reason": "reengage_low_temp",
    },
    {
        "person_idx": 2,
        "body": "There's a rooftop thing Saturday — perfect post-event scouting.",
        "hours_from_now": 24.0,
        "schedule_reason": "pattern_interrupt",
    },
]

# scheduled_touches: appear on /admin/clapcheeks-ops/touches
DEMO_TOUCHES: list[dict[str, Any]] = [
    {
        "person_idx": 0,
        "type": "callback_reference",
        "hours_from_now": 1.5,
        "draft_body": "Thursday climbing — still on? My T-Rex arms are at 60%.",
        "urgency": "warm",
    },
    {
        "person_idx": 1,
        "type": "reengage_low_temp",
        "hours_from_now": 7.0,
        "draft_body": "Quick check-in — how did the long run go this week?",
        "urgency": "cool",
    },
    {
        "person_idx": 2,
        "type": "pattern_interrupt",
        "hours_from_now": 25.0,
        "draft_body": "There's a rooftop thing Saturday — you should come scope it post-event.",
        "urgency": "cool",
    },
]


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

def _upsert_person(p: dict[str, Any], user_id: str) -> str:
    """Upsert one demo person using people:upsertFromObsidian.

    Returns the Convex _id string.
    Note: obsidian_md_hash is set to a fixed "demo-hash" so reruns are
    idempotent — the same obsidian_path gets updated, not duplicated.
    """
    args: dict[str, Any] = {
        "user_id": user_id,
        "obsidian_path": p["obsidian_path"],
        "obsidian_md_hash": "demo-seed-v1",
        "display_name": p["display_name"],
        "handles": p["handles"],
        "interests": p.get("interests", []),
        "goals": p.get("goals", []),
        "values": p.get("values", []),
        "context_notes": p.get("context_notes"),
        "disc_primary": p.get("disc_primary"),
        "cadence_profile": p.get("cadence_profile", "warm"),
        "active_hours_local": p.get("active_hours_local"),
        "status": p.get("status", "lead"),
        "whitelist_for_autoreply": False,  # CRITICAL — never autoreply to demo people
    }
    result = _mutate("people:upsertFromObsidian", args)
    if _DRY_RUN:
        return "__dry_run_id__"
    if isinstance(result, dict):
        return result.get("person_id", str(result))
    return str(result)


def _patch_person_enrichment(person_id: str, p: dict[str, Any]) -> None:
    """Patch trust/courtship/engagement fields via dedicated enrichment mutations.

    upsertFromObsidian doesn't accept courtship or vibe fields — those are
    owned by the enrichment layer. We call the dedicated public mutations.
    """
    if _DRY_RUN:
        print(f"    [DRY-RUN] would patch courtship/vibe for person_id={person_id}")
        return

    # updateCourtship — sets trust_score, courtship_stage, things_she_loves, etc.
    _mutate("people:updateCourtship", {
        "person_id": person_id,
        "trust_score": p.get("trust_score"),
        "courtship_stage": p.get("courtship_stage"),
        "trust_signals_observed": p.get("green_flags", []),
        "trust_signals_missing": p.get("red_flags", []),
        "things_she_loves": p.get("things_she_loves", []),
        "boundaries_stated": p.get("boundaries_stated"),
        "green_flags": p.get("green_flags"),
        "red_flags": p.get("red_flags"),
        "compliments_that_landed": p.get("compliments_that_landed"),
        "references_to_callback": p.get("references_to_callback"),
        "next_best_move": p.get("next_best_move"),
        "next_best_move_confidence": p.get("next_best_move_confidence"),
    })

    # updateVibe — sets vibe_classification and confidence.
    _mutate("people:updateVibe", {
        "person_id": person_id,
        "vibe_classification": p.get("vibe_classification", "unclear"),
        "vibe_confidence": p.get("vibe_confidence", 0.5),
        "vibe_evidence": p.get("context_notes", "Demo seed data."),
    })

    # patchEnrichment — sets engagement/cadence/disc fields.
    _mutate("people:patchEnrichment", {
        "person_id": person_id,
        "engagement_score": p.get("engagement_score"),
        "response_rate": p.get("response_rate"),
        "conversation_temperature": p.get("conversation_temperature"),
        "disc_type": p.get("disc_type"),
    })


def _upsert_conversation(person_id: str, handle: str, name: str, user_id: str) -> str:
    """Create or update a conversation for the demo person.

    Uses conversations:upsert (keyed on user_id + platform + external_match_id).
    """
    args: dict[str, Any] = {
        "user_id": user_id,
        "platform": "imessage",
        "external_match_id": f"demo-{handle}",
        "match_name": name,
    }
    conv_id = _mutate("conversations:upsert", args)
    if _DRY_RUN:
        return "__dry_run_conv_id__"
    return str(conv_id)


def _append_message(
    conversation_id: str,
    user_id: str,
    direction: str,
    body: str,
    sent_at: int,
    external_guid: str,
) -> None:
    """Append one message via messages:append."""
    _mutate("messages:append", {
        "conversation_id": conversation_id,
        "user_id": user_id,
        "direction": direction,
        "body": body,
        "sent_at": sent_at,
        "source": "import",
        "transport": "imessage_native",
        "external_guid": external_guid,
    })


def _create_scheduled_message(
    conversation_id: str,
    user_id: str,
    body: str,
    scheduled_for: int,
    schedule_reason: str,
) -> None:
    """Create a pending scheduled_message via scheduled_messages:create."""
    _mutate("scheduled_messages:create", {
        "conversation_id": conversation_id,
        "user_id": user_id,
        "body": body,
        "scheduled_for": scheduled_for,
        "schedule_reason": schedule_reason,
    })


def _schedule_touch(
    person_id: str,
    conversation_id: str,
    user_id: str,
    touch_type: str,
    scheduled_for: int,
    draft_body: str,
    urgency: str,
) -> None:
    """Schedule one touch via touches:scheduleOne.

    NOTE: scheduleOne calls ctx.scheduler.runAfter internally, so if
    scheduled_for is in the past the touch will fire almost immediately.
    We always set future times (hours_from_now > 0) to prevent accidental
    auto-sends (which would also be blocked by whitelist_for_autoreply=False).
    """
    _mutate("touches:scheduleOne", {
        "user_id": user_id,
        "person_id": person_id,
        "conversation_id": conversation_id,
        "type": touch_type,
        "scheduled_for": scheduled_for,
        "draft_body": draft_body,
        "generate_at_fire_time": False,
        "urgency": urgency,
    })


def _record_pending_link(
    conversation_id: str,
    candidate_person_ids: list[str],
    user_id: str,
) -> None:
    """Create one open pending_link row via people:recordPendingLink.

    Uses a separate ambiguous handle (+15551112222) not tied to any person,
    with two candidate matches — exactly the scenario /pending-links is for.
    """
    _mutate("people:recordPendingLink", {
        "user_id": user_id,
        "conversation_id": conversation_id,
        "handle_channel": "imessage",
        "handle_value": "+15551112222",
        "candidate_person_ids": candidate_person_ids,
        "raw_context": "Hey it's me from the other night 👋",
    })


# ---------------------------------------------------------------------------
# Main seed / wipe logic
# ---------------------------------------------------------------------------

def seed(user_id: str) -> None:  # noqa: C901
    print(f"\nSeeding demo data into {CONVEX_URL or '(dry-run)'}")
    print(f"  user_id : {user_id}")
    print(f"  dry-run : {_DRY_RUN}\n")

    person_ids: list[str] = []
    conv_ids: list[str] = []

    # 1. People
    for p in DEMO_PEOPLE:
        name = p["display_name"]
        handle = p["handles"][0]["value"]
        print(f"  upsert person: {name} ({handle})")
        pid = _upsert_person(p, user_id)
        print(f"    -> person_id={pid}")
        person_ids.append(pid)

        # Patch enrichment fields (courtship, vibe, engagement)
        _patch_person_enrichment(pid, p)
        if not _DRY_RUN:
            print(f"    -> courtship + vibe + enrichment patched")

    # 2. Conversations (one per person)
    for i, p in enumerate(DEMO_PEOPLE):
        handle = p["handles"][0]["value"]
        name = p["display_name"]
        cid = _upsert_conversation(person_ids[i], handle, name, user_id)
        print(f"  upsert conversation: {name} -> conv_id={cid}")
        conv_ids.append(cid)

    # 3. Messages
    msg_count = 0
    for msg in DEMO_MESSAGES:
        idx = msg["person_idx"]
        sent_at = _days_ago_ms(msg["days_ago"])
        guid = f"seed-demo-{idx}-{msg['seq']}"
        _append_message(
            conversation_id=conv_ids[idx],
            user_id=user_id,
            direction=msg["direction"],
            body=msg["body"],
            sent_at=sent_at,
            external_guid=guid,
        )
        msg_count += 1
    print(f"  appended {msg_count} messages (28 total, spread over last 10 days)")

    # 4. Scheduled messages (power /touches page)
    sm_count = 0
    for sm in DEMO_SCHEDULED_MESSAGES:
        idx = sm["person_idx"]
        scheduled_for = _hours_from_now_ms(sm["hours_from_now"])
        _create_scheduled_message(
            conversation_id=conv_ids[idx],
            user_id=user_id,
            body=sm["body"],
            scheduled_for=scheduled_for,
            schedule_reason=sm["schedule_reason"],
        )
        sm_count += 1
    print(f"  created {sm_count} scheduled_messages")

    # 5. Scheduled touches (power /admin/clapcheeks-ops/touches)
    touch_count = 0
    for t in DEMO_TOUCHES:
        idx = t["person_idx"]
        scheduled_for = _hours_from_now_ms(t["hours_from_now"])
        _schedule_touch(
            person_id=person_ids[idx],
            conversation_id=conv_ids[idx],
            user_id=user_id,
            touch_type=t["type"],
            scheduled_for=scheduled_for,
            draft_body=t["draft_body"],
            urgency=t["urgency"],
        )
        touch_count += 1
    print(f"  scheduled {touch_count} touches")

    # 6. Pending link — ambiguous handle, two candidate people
    _record_pending_link(
        conversation_id=conv_ids[0],
        candidate_person_ids=person_ids[:2],
        user_id=user_id,
    )
    print("  inserted 1 pending_link (handle +15551112222, 2 candidates)")

    print()
    print("Done! Check these dashboard pages:")
    print("  /admin/clapcheeks-ops/network        -> 3 people (Demo Sarah, Demo Kate, Demo Maya)")
    print("  /admin/clapcheeks-ops/touches         -> 3 upcoming touches + 3 scheduled_messages")
    print("  /admin/clapcheeks-ops/pending-links   -> 1 open ambiguous link")
    print()
    print("To wipe: python clapcheeks-local/scripts/seed_demo_data.py --wipe")


def wipe(user_id: str) -> None:
    """Delete demo people using people:deleteByObsidianPath.

    Hard-deletes the people row and nulls person_id on linked
    conversations + messages (handled by the mutation). Orphaned
    scheduled_messages and scheduled_touches are left in place — they
    become inert once the person row is gone.

    For a full clean slate: npx convex reset (dev deployment only).
    """
    print(f"\nWiping demo rows from {CONVEX_URL or '(dry-run)'} ...")
    print(f"  user_id : {user_id}")
    print(f"  dry-run : {_DRY_RUN}\n")

    demo_paths = [p["obsidian_path"] for p in DEMO_PEOPLE]
    wiped = 0
    for path in demo_paths:
        print(f"  deleting obsidian_path={path!r} ...")
        if not _DRY_RUN:
            try:
                result = _mutate("people:deleteByObsidianPath", {
                    "user_id": user_id,
                    "obsidian_path": path,
                })
                if isinstance(result, dict) and result.get("deleted") is False:
                    print(f"    -> not found (already wiped?): {result.get('reason')}")
                else:
                    wiped += 1
                    print(f"    -> deleted: {result}")
            except RuntimeError as e:
                print(f"    -> error: {e}")
        else:
            print(f"    [DRY-RUN] would delete")

    print(f"\nWiped {wiped}/{len(demo_paths)} demo people rows.")
    print("Orphaned conversations / messages / touches remain (inert without person rows).")
    print("Full reset: npx convex reset (dev deployment only — never production)")


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def main() -> None:
    global CONVEX_URL, _DRY_RUN  # noqa: PLW0603 — intentional module-level override

    parser = argparse.ArgumentParser(
        description="Seed (or wipe) Clapcheeks demo data in Convex dev.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Delete all Demo people rows via people:deleteByObsidianPath.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be called without writing anything to Convex.",
    )
    parser.add_argument(
        "--user-id",
        default=USER_ID,
        help=f"Convex user_id stamped on rows (default: {USER_ID!r}).",
    )
    parser.add_argument(
        "--convex-url",
        default=CONVEX_URL,
        help="Override CONVEX_URL (e.g. https://valiant-oriole-651.convex.cloud).",
    )
    cli_args = parser.parse_args()

    CONVEX_URL = cli_args.convex_url.rstrip("/") if cli_args.convex_url else ""
    _DRY_RUN = cli_args.dry_run

    if not CONVEX_URL and not _DRY_RUN:
        sys.exit(
            "FATAL: CONVEX_URL / NEXT_PUBLIC_CONVEX_URL not set.\n"
            "Set it in web/.env.local, or use:\n"
            "  --convex-url https://valiant-oriole-651.convex.cloud\n"
            "  --dry-run (to preview without connecting)"
        )

    if cli_args.wipe:
        wipe(cli_args.user_id)
    else:
        seed(cli_args.user_id)


if __name__ == "__main__":
    main()
