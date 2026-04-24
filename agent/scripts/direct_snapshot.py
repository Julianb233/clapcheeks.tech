#!/usr/bin/env python3
"""Direct snapshot — pulls Hinge matches+messages and Instagram DMs from the VPS.

Bypasses the Chrome-extension job queue. Uses stored tokens/cookies from
``clapcheeks_user_settings`` directly. Used when the extension path is
unavailable (e.g. Chrome dropped support for `--load-extension` post M137).

Cadence: safe for 1/hour. IG and Hinge are not as anti-bot-aggressive as
Tinder; a low-frequency read-only poll from a residential-ish IP is fine.

Writes to ``~/.clapcheeks/snapshots/direct-<ts>.json`` and to the
``portal_feed`` table for Julian to eyeball in the dashboard (optional).

Usage:
    python3 agent/scripts/direct_snapshot.py
    python3 agent/scripts/direct_snapshot.py --only instagram
    python3 agent/scripts/direct_snapshot.py --top-messages 5
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests


# ---------------------------------------------------------------------------
# env loading (reuse the pattern from snapshot_now.py)
# ---------------------------------------------------------------------------

def _load_env() -> None:
    candidates = [
        Path.cwd() / ".env.local",
        Path(__file__).resolve().parent.parent.parent / ".env.local",
    ]
    for p in candidates:
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            if k == "NEXT_PUBLIC_SUPABASE_URL":
                os.environ["SUPABASE_URL"] = v
            elif k == "SUPABASE_SERVICE_ROLE_KEY":
                os.environ["SUPABASE_SERVICE_KEY"] = v
        break


def _client():
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing.", file=sys.stderr)
        sys.exit(2)
    return create_client(url, key)


# ---------------------------------------------------------------------------
# Instagram (session-cookie-based, web endpoints)
# ---------------------------------------------------------------------------

IG_WEB_BASE = "https://www.instagram.com"
IG_APP_ID = "936619743392459"


def _parse_ig_cookies(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict):
                return {k: str(v) for k, v in obj.items() if v}
        except ValueError:
            return {}
    out: dict[str, str] = {}
    for part in raw.split(";"):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def snapshot_instagram(token: str | None, top_threads: int) -> dict:
    if not token:
        return {"ok": False, "reason": "no_instagram_token"}
    cookies = _parse_ig_cookies(token)
    required = ["sessionid", "ds_user_id", "csrftoken"]
    missing = [k for k in required if not cookies.get(k)]
    if missing:
        return {"ok": False, "reason": f"missing_cookies:{','.join(missing)}"}

    session = requests.Session()
    session.cookies.update(cookies)
    # Browser-lookalike headers — essential for IG to accept the request
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                      "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-IG-App-ID": IG_APP_ID,
        "X-CSRFToken": cookies.get("csrftoken", ""),
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"{IG_WEB_BASE}/direct/inbox/",
    })

    # 1) Inbox
    inbox_url = f"{IG_WEB_BASE}/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&persistentBadging=true&limit=20"
    try:
        r = session.get(inbox_url, timeout=20)
    except requests.RequestException as exc:
        return {"ok": False, "reason": f"inbox_network:{exc}"}
    if r.status_code == 401 or r.status_code == 403:
        return {"ok": False, "reason": f"ig_auth_expired_http_{r.status_code}"}
    if r.status_code >= 400:
        return {"ok": False, "reason": f"inbox_http_{r.status_code}",
                "preview": r.text[:200]}
    try:
        body = r.json()
    except ValueError:
        return {"ok": False, "reason": "inbox_not_json", "preview": r.text[:200]}

    inbox = body.get("inbox") or {}
    threads_raw = inbox.get("threads") or []
    threads: list[dict] = []
    for t in threads_raw:
        users = t.get("users") or []
        last_msg = t.get("last_permanent_item") or {}
        threads.append({
            "thread_id": t.get("thread_id") or t.get("thread_v2_id"),
            "thread_title": t.get("thread_title") or ", ".join(
                u.get("full_name") or u.get("username") or "" for u in users
            ),
            "usernames": [u.get("username") for u in users if u.get("username")],
            "unread_count": t.get("read_state", 0),
            "last_activity_at": t.get("last_activity_at"),
            "last_message_text": last_msg.get("text"),
            "last_message_type": last_msg.get("item_type"),
        })

    # 2) Thread details for top N
    detailed: list[dict] = []
    for t in threads[:top_threads]:
        tid = t.get("thread_id")
        if not tid:
            continue
        try:
            tr = session.get(f"{IG_WEB_BASE}/api/v1/direct_v2/threads/{tid}/?limit=50", timeout=20)
        except requests.RequestException as exc:
            detailed.append({"thread_id": tid, "ok": False, "reason": str(exc)})
            continue
        if tr.status_code >= 400:
            detailed.append({"thread_id": tid, "ok": False,
                            "reason": f"http_{tr.status_code}"})
            continue
        try:
            tbody = tr.json()
        except ValueError:
            continue
        thread = tbody.get("thread") or {}
        items = thread.get("items") or []
        msgs = []
        for it in items:
            msgs.append({
                "item_id": it.get("item_id"),
                "user_id": str(it.get("user_id") or ""),
                "type": it.get("item_type"),
                "text": it.get("text"),
                "timestamp_us": it.get("timestamp"),
            })
        detailed.append({
            "thread_id": tid,
            "thread_title": t.get("thread_title"),
            "usernames": t.get("usernames"),
            "message_count": len(msgs),
            "messages": list(reversed(msgs)),  # oldest first
            "ok": True,
        })
        # Gentle pacing between thread fetches
        time.sleep(1.5)

    return {
        "ok": True,
        "inbox_count": len(threads),
        "inbox": threads,
        "threads": detailed,
    }


# ---------------------------------------------------------------------------
# Hinge (bearer-token, iOS-API direct)
# ---------------------------------------------------------------------------

HINGE_API_BASE = "https://prod-api.hingeaws.net"


def _hinge_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Hinge/9.68.0 (iPhone; iOS 17.4; Scale/3.00)",
        "X-App-Version": "9.68.0",
        "X-Build-Number": "9680",
        "X-OS-Version": "17.4",
        "X-Device-Platform": "ios",
    }


def snapshot_hinge(token: str | None, top_messages: int) -> dict:
    if not token:
        return {"ok": False, "reason": "no_hinge_token"}
    s = requests.Session()
    s.headers.update(_hinge_headers(token))

    try:
        r = s.get(f"{HINGE_API_BASE}/match/v1", timeout=20)
    except requests.RequestException as exc:
        return {"ok": False, "reason": f"match_network:{exc}"}
    if r.status_code == 401:
        return {"ok": False, "reason": "hinge_auth_expired"}
    if r.status_code >= 400:
        return {"ok": False, "reason": f"match_http_{r.status_code}",
                "preview": r.text[:200]}
    try:
        body = r.json()
    except ValueError:
        return {"ok": False, "reason": "match_not_json"}

    if isinstance(body, dict):
        matches = body.get("matches") or body.get("data") or body.get("results") or []
    elif isinstance(body, list):
        matches = body
    else:
        matches = []

    summary: list[dict] = []
    for m in matches:
        subj = m.get("subject") or {}
        summary.append({
            "match_id": m.get("matchId") or m.get("id"),
            "subject_id": subj.get("subjectId") or subj.get("id"),
            "name": subj.get("firstName") or m.get("name"),
            "has_messages": bool(m.get("hasMessages")),
            "last_activity_at": m.get("lastActivityAt"),
        })

    threads: list[dict] = []
    active = [x for x in summary if x["has_messages"] and x["match_id"]][:top_messages]
    for a in active:
        mid = a["match_id"]
        try:
            tr = s.get(f"{HINGE_API_BASE}/message/match/v1/{mid}?limit=50", timeout=20)
        except requests.RequestException as exc:
            threads.append({"match_id": mid, "ok": False, "reason": str(exc)})
            continue
        if tr.status_code >= 400:
            threads.append({"match_id": mid, "ok": False,
                           "reason": f"http_{tr.status_code}"})
            continue
        try:
            tbody = tr.json()
        except ValueError:
            continue
        msgs_raw = (tbody.get("messages") if isinstance(tbody, dict) else tbody) or []
        msgs = []
        for mm in msgs_raw:
            msgs.append({
                "message_id": mm.get("messageId") or mm.get("id"),
                "from_self": bool(mm.get("fromSelf") or mm.get("isSelf")),
                "body": mm.get("body") or mm.get("text"),
                "sent_at": mm.get("createdAt") or mm.get("sentAt"),
            })
        threads.append({
            "match_id": mid,
            "name": a.get("name"),
            "ok": True,
            "message_count": len(msgs),
            "messages": msgs,
        })
        time.sleep(1.5)

    return {
        "ok": True,
        "matches_count": len(summary),
        "matches": summary,
        "threads": threads,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _snapshot_dir() -> Path:
    d = Path.home() / ".clapcheeks" / "snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append", choices=["hinge", "instagram"],
                    help="Limit platforms (default: both).")
    ap.add_argument("--top-messages", type=int, default=5,
                    help="Pull message threads for top N matches/threads (default: 5).")
    ap.add_argument("--no-write", action="store_true", help="Skip snapshot file.")
    ap.add_argument("--notify", action="store_true",
                    help="Send iMessage summary to Julian.")
    args = ap.parse_args()

    _load_env()
    c = _client()

    resp = (
        c.table("clapcheeks_user_settings")
        .select("user_id, hinge_auth_token, instagram_auth_token")
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        print("ERROR: no clapcheeks_user_settings row.", file=sys.stderr)
        return 2
    row = rows[0]
    user_id = row["user_id"]

    want = set(args.only) if args.only else {"hinge", "instagram"}
    snapshot: dict = {
        "user_id": user_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "architecture": "direct",
        "platforms": {},
    }

    if "hinge" in want:
        print(f"[hinge] pulling matches + top {args.top_messages} threads …")
        started = time.time()
        r = snapshot_hinge(row.get("hinge_auth_token"), args.top_messages)
        dur = time.time() - started
        snapshot["platforms"]["hinge"] = r
        if r.get("ok"):
            print(f"  OK — {r.get('matches_count', 0)} matches, "
                  f"{len([t for t in r.get('threads', []) if t.get('ok')])} threads ({dur:.1f}s)")
        else:
            print(f"  FAIL — {r.get('reason')} ({dur:.1f}s)")

    if "instagram" in want:
        print(f"[instagram] pulling DM inbox + top {args.top_messages} threads …")
        started = time.time()
        r = snapshot_instagram(row.get("instagram_auth_token"), args.top_messages)
        dur = time.time() - started
        snapshot["platforms"]["instagram"] = r
        if r.get("ok"):
            print(f"  OK — {r.get('inbox_count', 0)} threads in inbox, "
                  f"{len([t for t in r.get('threads', []) if t.get('ok')])} fully pulled ({dur:.1f}s)")
        else:
            print(f"  FAIL — {r.get('reason')} ({dur:.1f}s)")

    snapshot["finished_at"] = datetime.now(timezone.utc).isoformat()

    if not args.no_write:
        out_file = _snapshot_dir() / f"direct-{int(time.time())}.json"
        out_file.write_text(json.dumps(snapshot, indent=2, default=str))
        print(f"\nSaved: {out_file}")

    if args.notify:
        import subprocess
        p = snapshot["platforms"]
        lines = [f"clapcheeks hourly snapshot {datetime.now().strftime('%H:%M')}:"]
        for plat in ("hinge", "instagram"):
            r = p.get(plat, {})
            if r.get("ok"):
                if plat == "hinge":
                    lines.append(f"Hinge: OK - {r.get('matches_count',0)} matches, "
                                 f"{len([t for t in r.get('threads',[]) if t.get('ok')])} threads")
                else:
                    lines.append(f"Instagram: OK - {r.get('inbox_count',0)} DMs, "
                                 f"{len([t for t in r.get('threads',[]) if t.get('ok')])} threads")
            else:
                lines.append(f"{plat.capitalize()}: FAIL {r.get('reason','')}")
        msg = "\n".join(lines)
        try:
            subprocess.run(["god", "mac", "send", "+16195090699", msg],
                           timeout=30, check=False)
        except Exception as exc:
            print(f"notify failed: {exc}", file=sys.stderr)

    print(f"\n{json.dumps({k: v.get('ok') for k,v in snapshot['platforms'].items()}, indent=2)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
