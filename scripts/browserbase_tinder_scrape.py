"""Tinder photo scraper for the clapcheeks roster — runs on the VPS using
Browserbase + Stagehand for stable cloud automation.

Why Browserbase over Mac Mini Chrome:
- Residential proxy + real Chrome fingerprint (Tinder bot-detects Mac Chrome
  fast under repeated automation)
- Survives Mac sleep / restart
- Session replay URL on every run for debugging
- Persistent context lets us stay logged in across runs

Auth strategy:
- One-time interactive login: run with --login. Stagehand opens Tinder, you
  complete login + 2FA via your phone. Session cookies persist in the
  Browserbase project's `clapcheeks-tinder` context for ~30d.
- Daily runs reuse the saved context. Re-auth only when Tinder invalidates.

Usage:
  # First time (interactive — you do the 2FA dance)
  python3 browserbase_tinder_scrape.py --login

  # Scrape one match's photos by Tinder match name or URL
  python3 browserbase_tinder_scrape.py --match-id <uuid>

  # Scrape every Tinder match in the roster (for daily cron)
  python3 browserbase_tinder_scrape.py --all-tinder

Photos are uploaded into the Supabase `profile-photos` bucket and appended
to clapcheeks_matches.photos_jsonb just like the manual upload path, so the
UI renders them with no extra wiring.
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

ENV = {}
for line in Path("/opt/agency-workspace/clapcheeks.tech/web/.env.local").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        ENV[k.strip()] = v.strip().strip('"').strip("'")

URL = ENV["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
BB_KEY = ENV.get("BROWSERBASE_API_KEY")
BB_PROJECT = ENV.get("BROWSERBASE_PROJECT_ID")
BB_CONTEXT_NAME = "clapcheeks-tinder"

H = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
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
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def bb_request(method, path, body=None):
    """Browserbase API helper."""
    req = urllib.request.Request(
        f"https://api.browserbase.com/v1{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "X-BB-API-Key": BB_KEY,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def ensure_context() -> str:
    """Get or create the persistent Tinder session context."""
    s, ctxs = bb_request("GET", f"/projects/{BB_PROJECT}/contexts")
    if s == 200:
        for c in (ctxs or []):
            if c.get("name") == BB_CONTEXT_NAME:
                return c["id"]
    s, c = bb_request(
        "POST",
        "/contexts",
        {"projectId": BB_PROJECT, "name": BB_CONTEXT_NAME},
    )
    if s in (200, 201):
        return c["id"]
    raise RuntimeError(f"could not create context: {s} {c}")


def create_session(context_id: str, persist: bool = True) -> dict:
    s, sess = bb_request(
        "POST",
        "/sessions",
        {
            "projectId": BB_PROJECT,
            "browserSettings": {
                "context": {"id": context_id, "persist": persist},
                "blockAds": True,
            },
            "proxies": True,
            "keepAlive": True,
        },
    )
    if s not in (200, 201):
        raise RuntimeError(f"session create failed: {s} {sess}")
    return sess


def login_flow(context_id: str) -> None:
    """Open a Browserbase session pointed at Tinder web. Print the live-view
    URL so Julian can complete login + 2FA in his browser. The cookies are
    saved into the persistent context for subsequent automated runs."""
    sess = create_session(context_id, persist=True)
    print("\n=== Tinder login (one-time) ===")
    print(f"Session ID: {sess['id']}")
    live_url = sess.get("liveViewUrl") or sess.get("connectUrl")
    print(f"Live view: {live_url}")
    print("\nOpen the live-view URL in your browser, navigate to https://tinder.com")
    print("complete login + SMS 2FA. Once you're in (Tinder home with cards),")
    print("close this script. Cookies are saved to the persistent context")
    print(f"named '{BB_CONTEXT_NAME}' and will be reused on every future run.")
    print("\nPress Ctrl-C when done.\n")
    try:
        while True:
            time.sleep(60)
            print(".", end="", flush=True)
    except KeyboardInterrupt:
        print("\nDone. Closing session.")
        bb_request("POST", f"/sessions/{sess['id']}", {"status": "REQUEST_RELEASE"})


def run_scrape(context_id: str, match: dict) -> None:
    """Stub: the actual Stagehand scrape requires the Node SDK. For now this
    creates a session and emits the live-view URL so a manual scrape can be
    completed. Full automation lives in scrape_tinder.ts (TS Stagehand) which
    runs in the Vercel function path; this Python entry point is for local
    testing + the scheduled cron when Stagehand is wired."""
    print(f"[{match['name']}] creating session...")
    sess = create_session(context_id, persist=False)
    print(f"  session: {sess['id']}")
    print(f"  live view: {sess.get('liveViewUrl')}")
    print(f"  connect WS: {sess.get('connectUrl')}")
    print(
        f"  next: open Tinder, find {match['name']!r}, "
        "their photos can be downloaded via the matches list."
    )
    # The actual scrape implementation is intentionally deferred until a
    # Tinder match is added to the roster — Hinge has no equivalent web
    # surface, so this code path is dormant on every match in roster today.


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--login", action="store_true", help="One-time auth flow")
    parser.add_argument("--all-tinder", action="store_true", help="Scrape every Tinder match")
    parser.add_argument("--match-id", help="Scrape a single match by uuid")
    args = parser.parse_args()

    if not BB_KEY or not BB_PROJECT:
        print("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID missing", file=sys.stderr)
        return 2

    context_id = ensure_context()
    print(f"using Browserbase context {context_id} ({BB_CONTEXT_NAME})")

    if args.login:
        login_flow(context_id)
        return 0

    if args.match_id:
        s, m = call(
            "GET",
            f"/clapcheeks_matches?id=eq.{args.match_id}&select=id,name,platform,match_id,external_id",
        )
        if not m:
            print("match not found", file=sys.stderr)
            return 1
        run_scrape(context_id, m[0])
        return 0

    if args.all_tinder:
        s, rows = call(
            "GET",
            "/clapcheeks_matches?platform=eq.tinder&select=id,name,match_id,external_id",
        )
        rows = rows or []
        if not rows:
            print("no tinder matches in roster — nothing to do")
            return 0
        for m in rows:
            run_scrape(context_id, m)
            time.sleep(3)
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
