"""Pull live matches + messages + photos from Hinge using the token the
chrome extension harvester writes into clapcheeks_user_settings.

Flow:
  1. Read hinge_auth_token from clapcheeks_user_settings
  2. HingeAPIClient.get_matches() — recent matches list
  3. For each: get_match_profile() (bio + photos) + get_messages()
  4. Merge into clapcheeks_matches by (platform='hinge', external_id) —
     upserts new ones, never overwrites Julian-curated fields like
     julian_rank, stage, match_intel.notes
  5. Sync messages into clapcheeks_conversations.messages
  6. Download Hinge profile photos to Supabase Storage so the cards render

Schedule via cron every 30 min on the VPS.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path("/opt/agency-workspace/clapcheeks.tech")
sys.path.insert(0, str(REPO / "agent"))

ENV = {}
for line in (REPO / "web/.env.local").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        ENV[k.strip()] = v.strip().strip('"').strip("'")
URL = ENV["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
JULIAN = "9c848c51-8996-4f1f-9dbf-50128e3408ea"

LOG = REPO / ".state/hinge-sync.log"
LOG.parent.mkdir(exist_ok=True)

H = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line)
    LOG.open("a").write(line + "\n")


def supa(method, path, body=None):
    req = urllib.request.Request(
        f"{URL}/rest/v1{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers=H,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def upload_image(url: str, key: str) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            body = r.read()
            ct = r.headers.get("Content-Type") or "image/jpeg"
    except Exception as e:
        log(f"  ! image fetch failed {url[:60]}: {e}")
        return None
    req = urllib.request.Request(
        f"{URL}/storage/v1/object/match-photos/{key}",
        method="POST",
        data=body,
        headers={
            "Content-Type": ct,
            "Authorization": f"Bearer {KEY}",
            "x-upsert": "true",
        },
    )
    try:
        urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        if e.code != 200:
            log(f"  ! storage upload failed {e.code}: {e.read().decode()[:120]}")
            return None
    return f"{URL}/storage/v1/object/public/match-photos/{urllib.parse.quote(key)}"


def main() -> int:
    s, settings = supa(
        "GET",
        f"/clapcheeks_user_settings?user_id=eq.{JULIAN}"
        "&select=hinge_auth_token,hinge_auth_token_updated_at",
    )
    if s != 200 or not settings or not settings[0].get("hinge_auth_token"):
        log("no hinge_auth_token in clapcheeks_user_settings — install the chrome extension")
        return 0
    token = settings[0]["hinge_auth_token"]
    age_h = None
    if settings[0].get("hinge_auth_token_updated_at"):
        age_h = (
            datetime.now(timezone.utc)
            - datetime.fromisoformat(settings[0]["hinge_auth_token_updated_at"])
        ).total_seconds() / 3600
    log(f"hinge token loaded ({age_h:.1f}h old)" if age_h is not None else "hinge token loaded")

    try:
        from clapcheeks.platforms.hinge_api import HingeAPIClient, HingeAuthError
    except Exception as e:
        log(f"import HingeAPIClient failed: {e}")
        return 1

    try:
        client = HingeAPIClient(token=token)
    except HingeAuthError as e:
        log(f"hinge client init failed: {e}")
        return 1

    try:
        matches = client.get_matches(count=30)
    except Exception as e:
        log(f"get_matches failed (token expired?): {e}")
        return 1
    log(f"hinge returned {len(matches)} match(es)")
    if not matches:
        return 0

    # Existing roster — fetch in one shot for upsert merge
    s, existing = supa(
        "GET",
        f"/clapcheeks_matches?user_id=eq.{JULIAN}"
        "&platform=eq.hinge&select=id,external_id,name,julian_rank,stage,match_intel,photos_jsonb",
    )
    by_external: dict[str, dict] = {
        m["external_id"]: m for m in (existing or []) if m.get("external_id")
    }
    by_name: dict[str, dict] = {
        (m.get("name") or "").lower(): m for m in (existing or []) if m.get("name")
    }

    upserted = 0
    for hm in matches:
        ext_id = hm.get("subject_id") or hm.get("id")
        name = hm.get("name") or hm.get("first_name") or "Hinge match"
        if not ext_id:
            continue

        # Resolve to existing match: prefer external_id, fall back to name match
        target = by_external.get(ext_id) or by_name.get(name.lower())

        # Pull profile + messages (best-effort — keep going on errors)
        try:
            profile = client.get_match_profile(ext_id) or {}
        except Exception as e:
            log(f"  ! profile fail for {name}: {e}")
            profile = {}
        try:
            msgs = client.get_messages(ext_id, limit=50)
        except Exception as e:
            log(f"  ! messages fail for {name}: {e}")
            msgs = []

        bio = profile.get("bio") or hm.get("bio") or ""
        age = profile.get("age") or hm.get("age")
        photos_in = profile.get("photos") or hm.get("photos") or []

        # Upload up to 6 photos to Supabase Storage so the UI doesn't 401 on
        # raw Hinge CDN URLs (Hinge requires auth for direct fetches).
        photos_jsonb: list[dict] = []
        for i, p in enumerate(photos_in[:6]):
            src = p if isinstance(p, str) else (p.get("url") or p.get("source") or "")
            if not src:
                continue
            key = f"{JULIAN}/hinge:{ext_id}/{i}.jpg"
            uploaded = upload_image(src, key)
            if uploaded:
                photos_jsonb.append({"url": uploaded, "supabase_path": key})
        # If we already have photos and the new pull failed, keep the old ones
        if not photos_jsonb and target and target.get("photos_jsonb"):
            photos_jsonb = target["photos_jsonb"]

        # Build the upsert payload — only fields that should refresh from Hinge
        payload: dict = {
            "user_id": JULIAN,
            "platform": "hinge",
            "source": "hinge",
            "external_id": ext_id,
            "match_id": f"hinge:{ext_id}",
            "name": name,
            "match_name": name,
            "bio": bio,
            "age": age,
            "photos_jsonb": photos_jsonb,
            "instagram_handle": profile.get("instagram_handle"),
            "job": profile.get("job"),
            "school": profile.get("school"),
        }
        # Don't clobber Julian-curated fields if the row exists.
        if target:
            preserve = (
                "julian_rank", "stage", "status", "her_phone", "primary_channel",
                "first_impression", "match_intel",
            )
            payload["id"] = target["id"]
        else:
            payload["stage"] = "new_match"
            payload["status"] = "new"

        # Upsert: PATCH if existing, POST otherwise
        if target:
            s, _ = supa(
                "PATCH",
                f"/clapcheeks_matches?id=eq.{target['id']}&user_id=eq.{JULIAN}",
                {k: v for k, v in payload.items() if k != "id" and v is not None},
            )
        else:
            s, _ = supa("POST", "/clapcheeks_matches", payload)
        if s in (200, 201):
            upserted += 1

        # Sync messages into clapcheeks_conversations
        if msgs:
            conv_msgs = []
            for x in msgs:
                conv_msgs.append({
                    "ts": x.get("created_at") or x.get("timestamp") or "",
                    "from": "him" if x.get("is_from_me") or x.get("sender_id") == "self" else "her",
                    "text": x.get("body") or x.get("text") or "",
                })
            mid = f"hinge:{ext_id}"
            # Upsert conversation
            s, existing_conv = supa(
                "GET",
                f"/clapcheeks_conversations?user_id=eq.{JULIAN}"
                f"&match_id=eq.{urllib.parse.quote(mid)}&select=match_id",
            )
            last_ts = conv_msgs[-1]["ts"] if conv_msgs and conv_msgs[-1]["ts"] else None
            if existing_conv:
                supa(
                    "PATCH",
                    f"/clapcheeks_conversations?user_id=eq.{JULIAN}"
                    f"&match_id=eq.{urllib.parse.quote(mid)}",
                    {"messages": conv_msgs[-100:], "last_message_at": last_ts},
                )
            else:
                supa("POST", "/clapcheeks_conversations", {
                    "user_id": JULIAN, "platform": "hinge", "channel": "platform",
                    "match_id": mid, "messages": conv_msgs[-100:],
                    "last_message_at": last_ts, "stage": "opened",
                })

    log(f"done — upserted {upserted}/{len(matches)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
