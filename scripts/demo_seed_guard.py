"""Guardrail: every 5 min, sweep clapcheeks_matches for the demo seed
pattern and delete any rows that sneak back in. Pings Julian once if it
finds anything (so we eventually catch whatever is re-inserting them).

Demo pattern (identifiable from the dataset that kept returning):
- external_id matches r'^[hbtb]_\d{3}$'   (h_001, t_002, b_006, ...)
- her_phone matches r'^\+13105551\d{3}$'  (+13105551001, +13105551016)
- name in a known set of demo personas

Schedule: every 5 min via cron.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
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
JULIAN_PHONE = "+16195090699"

STATE_DIR = Path("/opt/agency-workspace/clapcheeks.tech/.state")
STATE_DIR.mkdir(exist_ok=True)
NOTIFIED_FILE = STATE_DIR / "demo-guard-last-notified.txt"
LOG = STATE_DIR / "demo-guard.log"

DEMO_NAMES = {
    "Sienna", "Mia", "Camila", "Ava", "Layla", "Zoe", "Harper", "Olivia",
    "Aria", "Nora", "Iris", "Eden", "Leah", "Sage", "Reese", "Quinn",
    "Stella", "Brooklyn", "Sofia", "Marisol",
}

H = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line)
    try:
        LOG.open("a").write(line + "\n")
    except Exception:
        pass


def call(method, path, body=None):
    req = urllib.request.Request(
        f"{URL}/rest/v1{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers=H,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def is_demo(row: dict) -> bool:
    eid = row.get("external_id") or ""
    if re.match(r"^[hbt]_\d{3}$", eid):
        return True
    phone = row.get("her_phone") or ""
    if re.match(r"^\+13105551\d{3}$", phone):
        return True
    name = (row.get("name") or "").strip()
    if name in DEMO_NAMES:
        return True
    return False


def notify(text: str) -> None:
    """Throttle to once per 6 hours."""
    now = time.time()
    if NOTIFIED_FILE.exists():
        try:
            last = float(NOTIFIED_FILE.read_text().strip())
            if now - last < 6 * 3600:
                return
        except Exception:
            pass
    try:
        subprocess.run(
            ["god", "mac", "send", JULIAN_PHONE, text],
            capture_output=True, timeout=15, check=False,
        )
        NOTIFIED_FILE.write_text(str(now))
    except Exception:
        pass


def main() -> int:
    s, rows = call(
        "GET",
        "/clapcheeks_matches?select=id,name,external_id,her_phone,user_id&limit=500",
    )
    if s != 200:
        log(f"fetch failed {s}")
        return 1
    rows = rows or []
    bad = [r for r in rows if is_demo(r)]
    if not bad:
        return 0

    ids = [r["id"] for r in bad]
    log(f"found {len(bad)} demo seed row(s): {[r['name'] for r in bad]}")

    # Delete in one go
    ids_csv = ",".join(ids)
    s, _ = call("DELETE", f"/clapcheeks_matches?id=in.({ids_csv})")
    log(f"deleted: HTTP {s}")

    notify(
        f"⚠ Clapcheeks demo-seed guard wiped {len(bad)} fake match row(s) "
        f"({', '.join(r['name'] for r in bad[:5])}{' …' if len(bad)>5 else ''}). "
        "Something keeps re-inserting them — investigate when you have time."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
