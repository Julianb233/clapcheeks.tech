"""VPS cron — drains the two notification flag types written by the Vercel
crons:

  1. match_intel.hot_alert_pending  (set by /api/cron/hot-reply-notify)
     → fires `god mac send` URGENT alert for high-priority her-messages
     → marks sent_at on the same JSONB so it doesn't refire

  2. match_intel.daily_brief        (set by /api/cron/morning-brief)
     → fires the morning-brief iMessage to Julian once per day
     → flips daily_brief.sent = true

Schedule: every minute via cron (rides alongside roster_reply_alerts.py).
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

LOG = Path("/opt/agency-workspace/clapcheeks.tech/.state/notifications.log")
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


def call(method, path, body=None):
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
            capture_output=True, text=True, timeout=20,
        )
        if p.returncode == 0:
            return True
        log(f"send failed rc={p.returncode}: {(p.stderr or p.stdout)[:200]}")
        return False
    except FileNotFoundError:
        log("god CLI not installed")
        return False
    except Exception as e:
        log(f"send exception: {e}")
        return False


def drain_hot_alerts() -> int:
    """Pull every match with a pending hot_alert that hasn't been sent."""
    s, rows = call(
        "GET",
        "/clapcheeks_matches?select=id,name,match_intel"
        "&match_intel->hot_alert_pending=not.is.null",
    )
    if s != 200 or not rows:
        return 0
    fired = 0
    for m in rows:
        intel = m.get("match_intel") or {}
        hot = intel.get("hot_alert_pending") or {}
        if hot.get("sent_at"):
            continue  # already sent
        preview = (hot.get("preview") or "").strip()
        rank = hot.get("julian_rank") or "-"
        cp = hot.get("close_probability") or 0
        body = (
            f"🔥 PRIORITY: {m['name']} just texted (#{rank}, p={cp:.2f})"
            + (f"\n\"{preview}\"" if preview else "")
            + f"\n\nReply: https://clapcheeks.tech/matches/{m['id']}"
        )
        if god_send(body):
            hot["sent_at"] = datetime.now(timezone.utc).isoformat()
            intel["hot_alert_pending"] = hot
            call("PATCH", f"/clapcheeks_matches?id=eq.{m['id']}",
                 {"match_intel": intel})
            fired += 1
            log(f"hot alert → {m['name']}")
    return fired


def drain_morning_brief() -> int:
    """Send any unsent daily_brief once."""
    s, rows = call(
        "GET",
        "/clapcheeks_matches?select=id,name,match_intel"
        "&match_intel->daily_brief=not.is.null",
    )
    if s != 200 or not rows:
        return 0
    fired = 0
    for m in rows:
        intel = m.get("match_intel") or {}
        brief = intel.get("daily_brief") or {}
        if brief.get("sent"):
            continue
        text = brief.get("text") or ""
        if not text:
            continue
        if god_send(text):
            brief["sent"] = True
            brief["sent_at"] = datetime.now(timezone.utc).isoformat()
            intel["daily_brief"] = brief
            call("PATCH", f"/clapcheeks_matches?id=eq.{m['id']}",
                 {"match_intel": intel})
            fired += 1
            log(f"morning brief sent ({len(text)} chars)")
    return fired


def main() -> int:
    h = drain_hot_alerts()
    b = drain_morning_brief()
    if h or b:
        log(f"done — hot={h} brief={b}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
