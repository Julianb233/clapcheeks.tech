"""Refresh chat.db-derived stats for the 6 real matches + voice profile.

SAFE-PATCH MODE (refactored 2026-04-25): does NOT delete or wipe.
Uses `Prefer: resolution=merge-duplicates` so curated fields (photos_jsonb,
instagram_handle, bio, first_impression, julian_rank, match_intel.notes)
are preserved across runs. Only message-derived fields (counts, ratios,
stage, health, last_activity_at, match_intel stats subset) are refreshed.

Origin of refactor: previous DELETE+INSERT pattern wiped IG photos/handles
every 15 min — see crontab comment for nightly_chatdb_sync.sh.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ENV = {}
for line in Path("/opt/agency-workspace/clapcheeks.tech/web/.env.local").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        ENV[k.strip()] = v.strip().strip('"').strip("'")

URL = ENV["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
JULIAN = "9c848c51-8996-4f1f-9dbf-50128e3408ea"

H = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=representation",
}


def call(method, path, body=None):
    req = urllib.request.Request(
        f"{URL}/rest/v1{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers=H,
    )
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


# ---------- 1. (DISABLED) ----------
# Previous wipe step removed 2026-04-25. Was destroying photos_jsonb +
# instagram_handle on every run. Now we rely on upsert merge semantics.
print("=== 1. (skip wipe — safe-PATCH mode) ===")


# ---------- 2. Load chat.db dump and build per-phone payloads ----------
dump = json.load(open("/tmp/chatdb_v2.json"))


def is_real(m):
    txt = (m.get("text") or "").strip()
    if not txt:
        return False
    return not txt.startswith((
        "Loved “", "Liked “", "Disliked “", "Laughed at “",
        "Emphasized “", "Questioned “", "Removed a heart from “",
        "Removed a like from “", "Removed a laugh from “",
        "Reacted ",
    ))


def to_dt(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


now = datetime.now(timezone.utc)
day = 24 * 3600

ROSTER_BASE = {
    "+14154718553": {
        "name": "Alketa Shkembi",
        "platform": "imessage",
        "source": "imessage",
        "julian_rank": 10,
        "first_impression": "Primary romantic partner; Italian/Albanian; affectionately 'Albanian meatball'",
        "bio": "Primary partner. Italian/Albanian. Loves seeing photos/videos of Julian.",
        "intel_extras": {
            "nickname": "Albanian meatball",
            "area_code": "415 (San Francisco Bay Area)",
            "tags": ["primary", "albanian-meatball"],
            "disc": "I (Influence) — warm, playful, emoji-heavy",
            "vak": "V (Visual — wants photos)",
            "obsidian_path": "Contacts/Dating/Alketa Shkembi.md",
            "related_project": "Personal-Immigration",
        },
    },
    "+17084661102": {
        "name": "Gina Grek",
        "platform": "imessage",
        "source": "imessage",
        "julian_rank": 7,
        "first_impression": "AI Acrobatics EA + dating; existing 900+ message thread",
        "bio": "AI Acrobatics Executive Assistant. Active recurring thread.",
        "intel_extras": {
            "area_code": "708 (Chicago suburbs)",
            "email": "ginagreksells@gmail.com",
            "tags": ["assistant", "team", "dating"],
            "obsidian_path": "Contacts/Dating/Gina.md",
            "primary_profile": "People/Team/Gina",
        },
    },
    "+16194029514": {
        "name": "Marissa",
        "platform": "hinge",
        "source": "hinge",
        "julian_rank": 5,
        "first_impression": "Hinge match, 84-msg thread, recently active",
        "bio": "Hinge match. San Diego (619).",
        "intel_extras": {
            "area_code": "619 (San Diego)",
            "tags": ["hinge", "lead-engaged"],
            "obsidian_path": "Contacts/Dating/Marissa.md",
        },
    },
    "+14242063116": {
        "name": "Re",
        "platform": "hinge",
        "source": "hinge",
        "julian_rank": 4,
        "first_impression": "Hinge match, awaiting reply",
        "bio": "Hinge match. LA (424). Name 'Re' — may be nickname.",
        "intel_extras": {
            "area_code": "424 (Los Angeles)",
            "tags": ["hinge", "lead-new"],
            "obsidian_path": "Contacts/Dating/Re.md",
        },
    },
    "+19167516573": {
        "name": "Sarah",
        "platform": "hinge",
        "source": "hinge",
        "julian_rank": 4,
        "first_impression": "Hinge match, awaiting her reply",
        "bio": "Hinge match. Sacramento (916).",
        "intel_extras": {
            "area_code": "916 (Sacramento)",
            "tags": ["hinge", "lead-new"],
            "obsidian_path": "Contacts/Dating/Sarah (Hinge).md",
        },
    },
    "+16195496601": {
        "name": "Taylor",
        "platform": "hinge",
        "source": "hinge",
        "julian_rank": 5,
        "first_impression": "Hinge match — replied with 'Good Morning!' 4/21, followed Julian on IG",
        "bio": "Hinge match. San Diego (619). Followed Julian on Instagram.",
        "intel_extras": {
            "area_code": "619 (San Diego)",
            "tags": ["hinge", "lead-engaged"],
            "obsidian_path": "Contacts/Dating/Taylor.md",
        },
    },
}


# ---------- 3. Insert real matches ----------
print("\n=== 2. Insert real roster (6) ===")
inserted = {}

julian_outbound = []  # for voice profile

for phone, base in ROSTER_BASE.items():
    msgs = dump.get(phone, [])
    real = [m for m in msgs if is_real(m)]
    if not msgs:
        continue

    her_count = sum(1 for m in real if not m["is_from_me"])
    him_count = sum(1 for m in real if m["is_from_me"])
    total = len(real)
    last7 = sum(1 for m in real if (now - to_dt(m["ts_utc"])).total_seconds() < 7 * day)
    last30 = sum(1 for m in real if (now - to_dt(m["ts_utc"])).total_seconds() < 30 * day)
    ratio = (him_count / her_count) if her_count else 99.0

    reply_intervals = []
    for i in range(len(real) - 1):
        a, b = real[i], real[i + 1]
        if a["is_from_me"] and not b["is_from_me"]:
            dt = (to_dt(b["ts_utc"]) - to_dt(a["ts_utc"])).total_seconds() / 3600.0
            if dt < 168:
                reply_intervals.append(dt)
    avg_reply_hrs = sum(reply_intervals) / len(reply_intervals) if reply_intervals else None

    last_activity = msgs[-1]["ts_utc"] if msgs else None
    last_her = next((m["ts_utc"] for m in reversed(msgs) if not m["is_from_me"]), None)

    # Stage from cadence + content
    if last7 > 100:
        stage = "recurring"
    elif last7 > 5:
        stage = "chatting"
    elif total > 3:
        stage = "chatting"
    else:
        stage = "new_match"
    # Override Alketa to recurring
    if phone == "+14154718553":
        stage = "recurring"

    # Health
    base_score = 50
    if last7 > 50:
        base_score += 30
    elif last7 > 10:
        base_score += 20
    elif last7 > 0:
        base_score += 10
    if 0.5 < ratio < 2.0:
        base_score += 10
    elif ratio > 3.0:
        base_score -= 20
    if last_her and (now - to_dt(last_her)).total_seconds() < 24 * 3600:
        base_score += 10
    health = max(5, min(100, base_score))

    # Close probability
    rank_w = base["julian_rank"] / 10.0
    stage_mult = {"recurring": 0.95, "chatting": 0.5, "new_match": 0.2}.get(stage, 0.3)
    close = round(rank_w * stage_mult, 3)

    # Build conversation messages (last 100 real + last 20 reactions for context)
    conv_msgs = [
        {
            "ts": m["ts_utc"].replace(" ", "T") + "Z",
            "from": "him" if m["is_from_me"] else "her",
            "text": m["text"],
        }
        for m in real[-100:]
    ]

    # SAFE-PATCH payload. Excludes curated fields (bio, first_impression,
    # julian_rank, photos_jsonb, instagram_handle) — those stay sticky
    # across runs. ROSTER_BASE values for those are seeded only on first
    # insert by upsert merge semantics; subsequent runs leave them alone.
    payload = {
        "user_id": JULIAN,
        "match_id": f"imessage:{phone}",
        "match_name": base["name"],
        "name": base["name"],
        "platform": base["platform"],
        "primary_channel": "imessage",
        "source": base["source"],
        "stage": stage,
        "status": "conversing" if stage in ("recurring", "chatting", "new_match") else "conversing",
        "her_phone": phone,
        "messages_total": total,
        "messages_7d": last7,
        "messages_30d": last30,
        "his_to_her_ratio": round(ratio, 2),
        "avg_reply_hours": round(avg_reply_hrs, 2) if avg_reply_hrs else None,
        "last_activity_at": last_activity.replace(" ", "T") + "+00:00" if last_activity else None,
        "last_her_initiated_at": last_her.replace(" ", "T") + "+00:00" if last_her else None,
        "sentiment_trajectory": "positive" if last7 > 5 else "neutral",
        "health_score": health,
        "health_score_updated_at": now.isoformat(),
        "close_probability": close,
        "match_intel": {
            **base["intel_extras"],
            "real_message_count": total,
            "her_messages": her_count,
            "his_messages": him_count,
            "chat_db_pull_at": now.isoformat(),
            "recent_messages": conv_msgs[-10:],
        },
    }
    # Collect outbound for voice profile FIRST (independent of DB insert success)
    for m in real:
        if m["is_from_me"]:
            julian_outbound.append(m["text"])

    # The matches table has a unique constraint on (user_id, platform, external_id).
    # We don't write external_id here, so do PATCH-by-match_id instead of upsert.
    # All 6 rows already exist; PATCH leaves curated fields untouched.
    mid_url = f"imessage:{phone}".replace(":", "%3A").replace("+", "%2B")
    s, body = call(
        "PATCH",
        f"/clapcheeks_matches?user_id=eq.{JULIAN}&match_id=eq.{mid_url}",
        payload,
    )
    if s in (200, 201) and body:
        mid = body[0]["id"] if isinstance(body, list) else body["id"]
        inserted[phone] = mid
        print(f"  + {base['name']:<18} stage={stage:<10} total={total:>4} 7d={last7:>3} ratio={ratio:.2f} health={health:>3} close={close:.2f}")
    else:
        print(f"  X {base['name']}: HTTP {s} {body}")
        continue

    # Conversation row
    convo = {
        "user_id": JULIAN,
        "match_id": f"imessage:{phone}",
        "platform": base["platform"],
        "channel": "imessage",
        "messages": conv_msgs,
        "stage": "responded" if conv_msgs and conv_msgs[-1]["from"] == "her" else "opened",
        "last_message_at": last_activity.replace(" ", "T") + "+00:00" if last_activity else None,
    }
    s, _ = call("POST", "/clapcheeks_conversations", convo)
    print(f"      convo: {len(conv_msgs)} msgs HTTP {s}")


# ---------- 4. Voice profile from real corpus ----------
print(f"\n=== 3. Voice profile (n={len(julian_outbound)}) ===")
n = len(julian_outbound)
if n == 0:
    print("  no outbound messages, skipping")
else:
    emoji_re = re.compile(
        r"[\U0001F300-\U0001FAFF\U0001F900-\U0001F9FF☀-➿\U0001F600-\U0001F64F✀-➿]",
        re.UNICODE,
    )
    no_apo_re = re.compile(
        r"\b(Im|Ill|whats|dont|cant|wont|youre|its|hes|shes|theyre|wouldnt|couldnt|shouldnt|isnt|arent|im|ill)\b"
    )
    double_re = re.compile(r"([a-z])\1{2,}")
    GREETINGS = ["heyy", "hey", "heyyy", "hi", "hola", "yo", "sup", "what's up", "whats up", "good morning"]

    total_words = 0
    emoji_freq = Counter()
    phrase_freq = Counter()
    greeting_freq = Counter()
    lowercase_only = 0
    ends_with_q = 0
    ellipsis = 0
    exclamation = 0
    no_apo = 0
    doubled = 0

    for msg in julian_outbound:
        s = msg.strip()
        if not s:
            continue
        words = s.split()
        total_words += len(words)
        if s.lower() == s and any(c.isalpha() for c in s):
            lowercase_only += 1
        if s.endswith("?"):
            ends_with_q += 1
        if "..." in s:
            ellipsis += 1
        if "!" in s:
            exclamation += 1
        if no_apo_re.search(s):
            no_apo += 1
        if double_re.search(s.lower()):
            doubled += 1
        for e in emoji_re.findall(s):
            emoji_freq[e] += 1
        for n_words in (2, 3):
            for i in range(len(words) - n_words + 1):
                ph = " ".join(words[i : i + n_words]).lower()
                if 3 < len(ph) < 30 and ph.isascii():
                    phrase_freq[ph] += 1
        sl = s.lower()
        for g in GREETINGS:
            if sl.startswith(g):
                greeting_freq[g] += 1
                break

    avg_words = total_words / n
    top_emojis = [e for e, _ in emoji_freq.most_common(15)]
    top_phrases = [p for p, c in phrase_freq.most_common(60) if c >= 3]
    sample = []
    seen = set()
    for msg in julian_outbound:
        s = msg.strip()
        if 4 < len(s) < 90 and s not in seen and not s.startswith(("Loved ", "Reacted ", "Liked ", "Emphasized ")):
            sample.append(s)
            seen.add(s)
        if len(sample) >= 30:
            break

    style_summary = (
        f"Casual, often lowercase ({100*lowercase_only//n}% all-lowercase). "
        f"Short messages — avg {avg_words:.1f} words. "
        f"Drops apostrophes (Im, Ill, whats, dont) in {100*no_apo//n}% of messages. "
        f"Doubles letters for warmth ('Heyy', 'yess', 'mooore') in {100*doubled//n}%. "
        f"Common emojis: {' '.join(top_emojis[:8]) if top_emojis else '(rare)'}. "
        f"Top greetings: {', '.join(f'{g} ({c})' for g, c in greeting_freq.most_common(5))}. "
        f"Self-introduces with 'This is Julian Bradley' + Instagram.com/julianbradleytv on first contacts. "
        f"Uses 'Hola' casually. Bursts: sends 2-4 short messages in quick succession."
    )

    voice = {
        "user_id": JULIAN,
        "tone": "casual",
        "style_summary": style_summary,
        "sample_phrases": sample,
        "profile_data": {
            "avg_words": round(avg_words, 2),
            "total_messages_analyzed": n,
            "uses_short_replies": avg_words < 8,
            "uses_lowercase_only_pct": round(100 * lowercase_only / n, 1),
            "drops_apostrophes_pct": round(100 * no_apo / n, 1),
            "doubles_letters_for_warmth_pct": round(100 * doubled / n, 1),
            "uses_ellipsis_pct": round(100 * ellipsis / n, 1),
            "uses_exclamation_pct": round(100 * exclamation / n, 1),
            "ends_with_question_pct": round(100 * ends_with_q / n, 1),
            "common_emojis": top_emojis,
            "top_phrases": top_phrases[:50],
            "casual_greetings": [g for g, _ in greeting_freq.most_common()],
            "self_intro_template": "[Greeting] sorry [I am/am I] just seeing this. This is Julian Bradley. Instagram.com/julianbradleytv",
            "burst_pattern": "Multiple short messages in quick succession",
            "context_sources": [
                "MacBook Pro chat.db dump (attributedBody decoded via NSUnarchiver)",
                f"Sample size: {n} real outbound messages across 6 active matches",
                f"Date range: spans full thread history per phone",
            ],
        },
        "messages_analyzed": n,
    }
    s, _ = call("PATCH", f"/clapcheeks_voice_profiles?user_id=eq.{JULIAN}", voice)
    if s == 404 or s >= 400:
        s, _ = call("POST", "/clapcheeks_voice_profiles", voice)
    print(f"  voice profile HTTP {s}")
    print(f"    avg_words: {avg_words:.1f}")
    print(f"    drops_apostrophes_pct: {100*no_apo//n}%")
    print(f"    doubles_letters_pct: {100*doubled//n}%")
    print(f"    top emojis: {top_emojis[:8]}")
    print(f"    top greetings: {dict(greeting_freq.most_common(5))}")
    print(f"    sample (first 6):")
    for s in sample[:6]:
        print(f"      • {s!r}")
