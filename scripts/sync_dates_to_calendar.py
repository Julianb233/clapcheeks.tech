"""Run on VPS. Polls Supabase for matches with
match_intel.scheduled_date.status == 'pending_calendar', creates the Google
Calendar event on Julian's Dating calendar via gws, and stamps the row with
the resulting event_id so we don't double-book.

Schedule with cron, e.g.:
  */5 * * * * /opt/agency-workspace/clapcheeks.tech/scripts/sync_dates_to_calendar.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
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
GWS_PROFILE = "/opt/agency-workspace/.fleet-config/google-cloud/gws/profiles/workspace"
DATING_CAL_ID = (
    "c_3084e8452ab4cd8bad2d7a18411144ebb54765a5462d3a8c79375b3041e35bf2"
    "@group.calendar.google.com"
)

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
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def gws_create_event(payload: dict) -> dict | None:
    """Create event on Dating calendar via gws CLI."""
    env = os.environ.copy()
    env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = GWS_PROFILE
    p = subprocess.run(
        [
            "gws", "calendar", "events", "insert",
            "--calendar-id", DATING_CAL_ID,
            "--json", json.dumps(payload),
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if p.returncode != 0:
        print(f"  gws error: {p.stderr.strip() or p.stdout.strip()}", file=sys.stderr)
        return None
    try:
        return json.loads(p.stdout)
    except Exception:
        print(f"  gws unparseable output: {p.stdout[:300]}", file=sys.stderr)
        return None


def main() -> int:
    # Pull all matches that have a pending_calendar date.
    s, rows = call(
        "GET",
        "/clapcheeks_matches?select=id,name,match_intel,user_id&match_intel->scheduled_date->>status=eq.pending_calendar",
    )
    if s != 200:
        print(f"supabase fetch failed: {s} {rows}", file=sys.stderr)
        return 1

    rows = rows or []
    if not rows:
        print("no pending dates")
        return 0

    print(f"found {len(rows)} pending date(s)")
    for m in rows:
        intel = m.get("match_intel") or {}
        sched = intel.get("scheduled_date") or {}
        starts = sched.get("starts_at")
        ends = sched.get("ends_at")
        if not starts:
            print(f"  ! {m['name']}: missing starts_at, skipping")
            continue

        title = f"Date — {m['name']}"
        description_parts = [
            f"Auto-created by Clapcheeks for match: {m['name']}",
        ]
        if sched.get("notes"):
            description_parts.append("")
            description_parts.append(str(sched["notes"]))
        payload = {
            "summary": title,
            "description": "\n".join(description_parts),
            "start": {"dateTime": starts, "timeZone": "America/Los_Angeles"},
            "end": {"dateTime": ends, "timeZone": "America/Los_Angeles"},
        }
        if sched.get("location"):
            payload["location"] = str(sched["location"])

        event = gws_create_event(payload)
        if not event or not event.get("id"):
            # Mark error so we don't keep retrying forever.
            new_intel = {
                **intel,
                "scheduled_date": {**sched, "status": "calendar_error"},
            }
            call(
                "PATCH",
                f"/clapcheeks_matches?id=eq.{m['id']}",
                {"match_intel": new_intel},
            )
            print(f"  ✗ {m['name']}: calendar create failed")
            continue

        new_intel = {
            **intel,
            "scheduled_date": {
                **sched,
                "status": "created",
                "calendar_event_id": event["id"],
                "calendar_event_link": event.get("htmlLink"),
            },
        }
        call(
            "PATCH",
            f"/clapcheeks_matches?id=eq.{m['id']}",
            {"match_intel": new_intel},
        )
        print(f"  ✓ {m['name']}: {event.get('htmlLink')}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
