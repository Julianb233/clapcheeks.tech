#!/usr/bin/env python3
"""Hourly cron — enqueues data-refresh jobs into clapcheeks_agent_jobs.

The cctech Chrome on Mac Mini (token harvester extension) polls the queue
every ~10s and executes each job using the user's logged-in browser session
(residential IP, real cookies, no anti-bot block).

Replaces the old direct_snapshot.py cron, which tried to fetch from the
VPS datacenter IP and got blocked by IG (30-redirect loop) and Hinge
(stale token).

Schedule via cron every hour on the VPS.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# ---- env ----
ENV: dict[str, str] = {}
for p in (Path("/opt/agency-workspace/clapcheeks.tech/web/.env.local"),
          Path("/opt/agency-workspace/clapcheeks.tech/.env.local")):
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                ENV[k.strip()] = v.strip().strip('"').strip("'")

URL = ENV.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")
USER_ID = "9c848c51-8996-4f1f-9dbf-50128e3408ea"

if not (URL and KEY):
    print("FATAL: missing SUPABASE env vars", file=sys.stderr)
    sys.exit(1)

H = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

JOBS = [
    ("instagram", "ig_dm_inbox", {
        "url": "https://www.instagram.com/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&persistentBadging=true&limit=20",
        "method": "GET",
        "headers": {
            "Accept": "*/*",
            "Referer": "https://www.instagram.com/direct/inbox/",
            "X-CSRFToken": "csrftest",
            "X-IG-App-ID": "936619743392459",
            "X-Requested-With": "XMLHttpRequest",
        },
        "body": None,
    }),
    ("hinge", "list_matches", {
        "url": "https://prod.hingeaws.net/match/v1?last_activity_id=",
        "method": "GET",
        "headers": {"Accept": "application/json", "Referer": "https://hinge.co/"},
        "body": None,
    }),
    ("tinder", "list_matches", {
        "url": "https://api.gotinder.com/v2/matches?count=60&message=1&is_tinder_u=false",
        "method": "GET",
        "headers": {"Accept": "application/json", "Referer": "https://tinder.com/", "platform": "web"},
        "body": None,
    }),
]


def already_pending(platform: str, job_type: str) -> bool:
    """Skip enqueue if there's already a pending job of the same kind (don't pile up)."""
    q = f"{URL}/rest/v1/clapcheeks_agent_jobs?user_id=eq.{USER_ID}&platform=eq.{platform}&job_type=eq.{job_type}&status=eq.pending&limit=1"
    req = urllib.request.Request(q, headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return len(json.loads(r.read())) > 0
    except Exception:
        return False


def enqueue(platform: str, job_type: str, params: dict) -> None:
    if already_pending(platform, job_type):
        print(f"  skip {platform}/{job_type} (already pending)")
        return
    body = {
        "user_id": USER_ID,
        "platform": platform,
        "job_type": job_type,
        "job_params": params,
        "status": "pending",
    }
    req = urllib.request.Request(
        f"{URL}/rest/v1/clapcheeks_agent_jobs",
        method="POST",
        data=json.dumps(body).encode(),
        headers=H,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.loads(r.read())
            print(f"  enqueued {platform}/{job_type} -> id={res[0]['id'][:8]}")
    except urllib.error.HTTPError as e:
        print(f"  FAIL {platform}/{job_type}: {e.code} {e.read()[:200].decode()}")


if __name__ == "__main__":
    print(f"=== enqueue_harvester_jobs ({len(JOBS)} jobs) ===")
    for platform, job_type, params in JOBS:
        enqueue(platform, job_type, params)
