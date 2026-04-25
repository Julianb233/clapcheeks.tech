"""Watch the BlueBubbles inbox for incoming iMessages from any roster phone
and ping Julian via `god mac send` so he knows she replied.

Idempotent — keeps a state file of alerted GUIDs so the same message never
fires twice. Rate-limits per match (max 1 alert per match per 20 min) so
rapid-fire convos don't spam.

Schedule: every minute via cron.
  * * * * * /usr/bin/python3 /opt/agency-workspace/clapcheeks.tech/scripts/roster_reply_alerts.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
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

INBOX_DIR = Path("/opt/agency-workspace/fleet-shared/inbox/clapcheeks")
STATE_DIR = Path("/opt/agency-workspace/clapcheeks.tech/.state")
STATE_DIR.mkdir(exist_ok=True)
SEEN_FILE = STATE_DIR / "alerted-guids.txt"
LAST_ALERT_FILE = STATE_DIR / "last-alert-per-phone.json"
LOG = STATE_DIR / "alerts.log"

JULIAN_PHONE = "+16195090699"
ALERT_COOLDOWN_SECONDS = 20 * 60  # don't re-ping same match within 20 min
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line)
    try:
        with LOG.open("a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_seen() -> set[str]:
    if not SEEN_FILE.exists():
        return set()
    return {l.strip() for l in SEEN_FILE.read_text().splitlines() if l.strip()}


def save_seen(seen: set[str]) -> None:
    # Cap at 5000 entries to keep file small
    keep = list(seen)[-5000:]
    SEEN_FILE.write_text("\n".join(keep) + "\n")


def load_last_alert() -> dict[str, float]:
    if not LAST_ALERT_FILE.exists():
        return {}
    try:
        return json.loads(LAST_ALERT_FILE.read_text())
    except Exception:
        return {}


def save_last_alert(d: dict[str, float]) -> None:
    LAST_ALERT_FILE.write_text(json.dumps(d))


def fetch_roster() -> dict[str, dict]:
    """Map phone -> {id, name, julian_rank} for active roster."""
    req = urllib.request.Request(
        f"{URL}/rest/v1/clapcheeks_matches"
        "?select=id,name,her_phone,julian_rank,stage"
        "&her_phone=not.is.null"
        "&stage=not.in.(archived,archived_cluster_dupe)",
        headers=H,
    )
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read().decode())
    return {m["her_phone"]: m for m in data if m.get("her_phone")}


def is_real_message(text: str) -> bool:
    if not text or not text.strip():
        return False
    REACTIONS = (
        "Loved “", "Liked “", "Disliked “", "Laughed at “",
        "Emphasized “", "Questioned “", "Reacted ",
    )
    return not text.startswith(REACTIONS)


def normalize_phone(p: str) -> str:
    """Best-effort E.164 normalize — strip spaces, ensure leading +."""
    if not p:
        return ""
    p = p.strip()
    if p.startswith("+"):
        return p
    digits = "".join(c for c in p if c.isdigit())
    if not digits:
        return ""
    if len(digits) == 10:
        return "+1" + digits
    return "+" + digits


def send_alert(text: str) -> bool:
    try:
        p = subprocess.run(
            ["god", "mac", "send", JULIAN_PHONE, text],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if p.returncode != 0:
            log(f"send failed: rc={p.returncode} {p.stderr.strip()[:200]}")
            return False
        return True
    except FileNotFoundError:
        log("god CLI not installed")
        return False
    except subprocess.TimeoutExpired:
        log("send timed out")
        return False


def main() -> int:
    if not INBOX_DIR.exists():
        log(f"inbox dir missing: {INBOX_DIR}")
        return 0

    # Process today's + yesterday's NDJSON (covers UTC rollover)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    yesterday = datetime.fromtimestamp(time.time() - 86400, timezone.utc).strftime("%Y-%m-%d")
    files = [INBOX_DIR / f"{d}.ndjson" for d in (yesterday, today)]
    files = [f for f in files if f.exists()]
    if not files:
        return 0

    try:
        roster = fetch_roster()
    except Exception as e:
        log(f"roster fetch failed: {e}")
        return 1

    if not roster:
        return 0

    seen = load_seen()
    last_alert = load_last_alert()
    now = time.time()
    new_seen = set()
    sent = 0

    for f in files:
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
            except Exception:
                continue

            guid = evt.get("guid") or f"{evt.get('ts')}|{evt.get('from')}"
            if guid in seen:
                continue
            new_seen.add(guid)

            if evt.get("type") not in (None, "new-message"):
                continue
            from_phone = normalize_phone(evt.get("from", ""))
            if not from_phone:
                continue
            text = evt.get("text", "") or ""
            if not is_real_message(text):
                continue

            match = roster.get(from_phone)
            if not match:
                continue

            # Cooldown
            last = last_alert.get(from_phone, 0)
            if now - last < ALERT_COOLDOWN_SECONDS:
                continue

            preview = text.strip()
            if len(preview) > 110:
                preview = preview[:110] + "…"
            rank = match.get("julian_rank")
            badge = f"#{rank} " if isinstance(rank, int) else ""
            body = (
                f"💌 {badge}{match['name']} replied:\n"
                f"\"{preview}\"\n\n"
                f"Open: https://clapcheeks.tech/matches/{match['id']}"
            )

            if send_alert(body):
                last_alert[from_phone] = now
                sent += 1
                log(f"alert -> {match['name']} ({from_phone})")

    if new_seen:
        save_seen(seen | new_seen)
    if last_alert:
        save_last_alert(last_alert)
    if sent:
        log(f"done — {sent} alert(s) sent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
