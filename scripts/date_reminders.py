"""Calendar reminders cron — every 5 min, sweeps roster for dates within
the next 90 minutes and pings Julian via god mac send.

Reminder windows (each fires exactly once via match_intel.scheduled_date.reminders[]):
  - 24h before  ("Date with X tomorrow at 7pm")
  - 2h before   ("Date with X in 2 hours — at the bar on La Jolla")
  - 30m before  ("Date with X in 30 min")

Skips dates with status=cancelled.
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENV = {}
for line in Path("/opt/agency-workspace/clapcheeks.tech/web/.env.local").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        ENV[k.strip()] = v.strip().strip('"').strip("'")
URL = ENV["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
JULIAN_PHONE = "+16195090699"

LOG = Path("/opt/agency-workspace/clapcheeks.tech/.state/date-reminders.log")
LOG.parent.mkdir(exist_ok=True)

# (key, minutes_before, label)
WINDOWS = [
    ("d24h", 24 * 60, "tomorrow"),
    ("d2h", 120, "in 2 hours"),
    ("d30m", 30, "in 30 min"),
]

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
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def god_send(text: str) -> bool:
    try:
        p = subprocess.run(
            ["god", "mac", "send", JULIAN_PHONE, text],
            capture_output=True, text=True, timeout=15,
        )
        return p.returncode == 0
    except Exception as e:
        log(f"send failed: {e}")
        return False


def main() -> int:
    s, rows = supa(
        "GET",
        "/clapcheeks_matches?select=id,name,match_intel"
        "&match_intel->scheduled_date=not.is.null",
    )
    if s != 200 or not rows:
        return 0

    now = datetime.now(timezone.utc)
    fired = 0
    for m in rows:
        intel = m.get("match_intel") or {}
        sd = intel.get("scheduled_date") or {}
        if sd.get("status") == "cancelled":
            continue
        starts = sd.get("starts_at")
        if not starts:
            continue
        try:
            t = datetime.fromisoformat(starts.replace("Z", "+00:00"))
        except Exception:
            continue
        minutes_until = (t - now).total_seconds() / 60.0
        if minutes_until < 0:
            continue  # already happened

        already = set(sd.get("reminders_sent") or [])
        for key, mins, label in WINDOWS:
            if key in already:
                continue
            # Fire when we're within the window — 5 min after each threshold
            # is the latest we'd fire (cron is */5min).
            if mins - 5 <= minutes_until <= mins + 5:
                t_local = t.astimezone()
                when_str = t_local.strftime("%a %-I:%M %p")
                where = sd.get("location") or ""
                notes = (sd.get("notes") or "").strip()
                body = f"📅 Date with {m['name']} {label} ({when_str})"
                if where:
                    body += f"\n@ {where}"
                if notes:
                    body += f"\n\n{notes}"
                body += f"\n\nhttps://clapcheeks.tech/matches/{m['id']}"
                if god_send(body):
                    already.add(key)
                    fired += 1
                    log(f"reminder {key} → {m['name']} (+{minutes_until:.0f}m)")
        # Persist updated reminders_sent
        if set(sd.get("reminders_sent") or []) != already:
            sd["reminders_sent"] = sorted(already)
            intel["scheduled_date"] = sd
            supa(
                "PATCH",
                f"/clapcheeks_matches?id=eq.{m['id']}",
                {"match_intel": intel},
            )

    if fired:
        log(f"done — {fired} reminder(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
