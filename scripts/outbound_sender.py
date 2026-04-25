"""VPS cron — picks up pending outbound messages from match_intel.outbound_queue
and sends them via `god mac send`. Runs every minute.

Flow:
  1. Pull all matches where match_intel.outbound_queue contains items with
     status='pending'
  2. For each pending item: god mac send <her_phone> <text>
  3. On success: mark status='sent' + sent_at; on failure: 'failed' + reason
  4. Patch the row back

Idempotent — re-runs skip already-sent items.
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
JULIAN = "9c848c51-8996-4f1f-9dbf-50128e3408ea"

LOG = Path("/opt/agency-workspace/clapcheeks.tech/.state/outbound.log")
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


def god_send(phone: str, text: str) -> tuple[bool, str]:
    try:
        p = subprocess.run(
            ["god", "mac", "send", phone, text],
            capture_output=True, text=True, timeout=30,
        )
        if p.returncode == 0:
            return True, ""
        return False, (p.stderr or p.stdout).strip()[:300]
    except FileNotFoundError:
        return False, "god CLI not installed"
    except subprocess.TimeoutExpired:
        return False, "send timed out"
    except Exception as e:
        return False, str(e)[:300]


def main() -> int:
    s, rows = call(
        "GET",
        f"/clapcheeks_matches?user_id=eq.{JULIAN}"
        "&select=id,name,her_phone,match_intel"
        "&match_intel->outbound_queue=not.is.null",
    )
    if s != 200 or not rows:
        return 0

    sent_count = 0
    for m in rows:
        intel = m.get("match_intel") or {}
        queue = intel.get("outbound_queue") or []
        if not queue:
            continue
        changed = False
        for item in queue:
            # Skip anything that isn't actively pending (sent, cancelled,
            # failed all stay as-is).
            if item.get("status") != "pending":
                continue
            phone = item.get("her_phone") or m.get("her_phone")
            text = item.get("text", "")
            if not phone or not text:
                item["status"] = "failed"
                item["failure_reason"] = "missing phone or text"
                changed = True
                continue
            ok, err = god_send(phone, text)
            now = datetime.now(timezone.utc).isoformat()
            if ok:
                item["status"] = "sent"
                item["sent_at"] = now
                sent_count += 1
                log(f"sent → {m['name']} ({phone}): {text[:60]!r}")
            else:
                item["status"] = "failed"
                item["failure_reason"] = err
                item["failed_at"] = now
                log(f"FAIL → {m['name']}: {err}")
            changed = True

        if changed:
            # Cap queue history at last 50 items per match
            intel["outbound_queue"] = queue[-50:]
            call("PATCH", f"/clapcheeks_matches?id=eq.{m['id']}",
                 {"match_intel": intel})

    if sent_count:
        log(f"done — {sent_count} sent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
