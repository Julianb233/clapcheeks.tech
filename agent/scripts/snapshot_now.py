#!/usr/bin/env python3
"""Snapshot CLI — pull Hinge matches+messages, IG DMs, and Tinder matches.

Enqueues Chrome-extension jobs (Phase M pattern from AI-8345), waits,
and dumps everything to stdout as JSON plus a timestamped file under
~/.clapcheeks/snapshots/.

Does NOT hit dating-app APIs from the VPS directly. Requires the
Chrome token-harvester extension to be installed and Chrome to be open
on Julian's Mac. If no extension drains the jobs inside the timeout,
each job flips to stale_no_extension and this script reports "no
extension online — open Chrome on your Mac".

Usage:
    python3 agent/scripts/snapshot_now.py
    python3 agent/scripts/snapshot_now.py --only hinge
    python3 agent/scripts/snapshot_now.py --only instagram --timeout 120
    python3 agent/scripts/snapshot_now.py --top-messages 5
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_TIMEOUT_SECONDS = 300
DEFAULT_TOP_MESSAGES = 5


def _snapshot_dir() -> Path:
    d = Path.home() / ".clapcheeks" / "snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_env_from_local() -> None:
    """Pick up SUPABASE_URL / SUPABASE_SERVICE_KEY from clapcheeks.tech/.env.local.

    The .env.local file is authoritative — it points at the clapcheeks
    Supabase project (oouuoepmkeqdyzsxrnjh). A shell-wide SUPABASE_URL
    pre-set to something else (e.g. Dashboard Daddy) would otherwise
    win, so we overwrite it when .env.local is present.
    """
    candidates = [
        Path.cwd() / ".env.local",
        Path(__file__).resolve().parent.parent.parent / ".env.local",
        Path.home() / ".clapcheeks" / ".env",
    ]
    for p in candidates:
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            # Map Next.js names to backend names. .env.local overrides
            # anything pre-set in the shell — it is the source of truth
            # for *which* Supabase project we're talking to.
            if k == "NEXT_PUBLIC_SUPABASE_URL":
                os.environ["SUPABASE_URL"] = v
            elif k == "SUPABASE_SERVICE_ROLE_KEY":
                os.environ["SUPABASE_SERVICE_KEY"] = v
            elif k == "SUPABASE_URL":
                os.environ["SUPABASE_URL"] = v
            elif k == "SUPABASE_SERVICE_KEY":
                os.environ["SUPABASE_SERVICE_KEY"] = v
        break  # first match wins


def _client():
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY not set. "
              "Put them in .env.local or ~/.clapcheeks/.env.", file=sys.stderr)
        sys.exit(2)
    return create_client(url, key)


def _resolve_user(c, email: str | None) -> tuple[str, dict]:
    """Resolve the user_id + user_settings row. Julian-by-default."""
    # Pull the most recently-updated settings row with any token present.
    q = (
        c.table("clapcheeks_user_settings")
        .select(
            "user_id, tinder_auth_token, hinge_auth_token, instagram_auth_token, "
            "tinder_auth_token_updated_at, hinge_auth_token_updated_at, "
            "instagram_auth_token_updated_at"
        )
    )
    if email:
        # If caller passed an email, look up the auth user first.
        auth_resp = c.auth.admin.list_users()
        users = getattr(auth_resp, "users", None) or auth_resp
        matched = None
        for u in users:
            u_email = getattr(u, "email", None) or (u.get("email") if isinstance(u, dict) else None)
            if u_email and u_email.lower() == email.lower():
                matched = getattr(u, "id", None) or u.get("id")
                break
        if not matched:
            print(f"ERROR: no auth user for {email}", file=sys.stderr)
            sys.exit(2)
        q = q.eq("user_id", matched)

    resp = q.limit(1).execute()
    rows = resp.data or []
    if not rows:
        print("ERROR: no clapcheeks_user_settings row found.", file=sys.stderr)
        sys.exit(2)
    row = rows[0]
    return row["user_id"], row


def _extension_online(c, user_id: str, fresh_seconds: int = 300) -> tuple[bool, str | None]:
    """Heuristic: any clapcheeks_agent_tokens row seen in the last 5 min?"""
    try:
        resp = (
            c.table("clapcheeks_agent_tokens")
            .select("device_name, last_seen_at")
            .eq("user_id", user_id)
            .order("last_seen_at", desc=True, nullsfirst=False)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        return False, f"probe failed: {exc}"
    rows = resp.data or []
    if not rows:
        return False, "no device tokens registered"
    last_seen = rows[0].get("last_seen_at")
    if not last_seen:
        return False, f"device '{rows[0].get('device_name')}' never contacted"
    try:
        from datetime import datetime, timezone
        ts = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - ts).total_seconds()
    except Exception:
        return False, f"unparseable last_seen_at: {last_seen}"
    if age > fresh_seconds:
        mins = int(age / 60)
        return False, f"device '{rows[0].get('device_name')}' last seen {mins} min ago"
    return True, f"device '{rows[0].get('device_name')}' active"


# ---------------------------------------------------------------------------
# Per-platform pullers
# ---------------------------------------------------------------------------


def snapshot_hinge(user_id: str, token: str | None, top_messages: int, timeout: int) -> dict:
    if not token:
        return {"ok": False, "reason": "no_hinge_token"}
    from clapcheeks.job_queue import enqueue_job, wait_for_completion

    out: dict = {"ok": True, "matches": [], "threads": []}

    # 1) List matches via /match/v1 (what match_sync uses)
    list_url = "https://prod-api.hingeaws.net/match/v1"
    jid = enqueue_job(
        user_id=user_id,
        job_type="list_matches",
        platform="hinge",
        url=list_url,
        method="GET",
        headers={"X-Auth-Token": token},
    )
    if not jid:
        return {"ok": False, "reason": "enqueue_failed"}

    result = wait_for_completion(jid, timeout_seconds=timeout)
    if result is None:
        return {"ok": False, "reason": "extension_offline_or_timeout"}
    sc = result.get("status_code") if isinstance(result, dict) else None
    if sc is not None and not (200 <= sc < 300):
        return {"ok": False, "reason": f"hinge_http_{sc}", "body": result.get("body")}

    body = result.get("body") if isinstance(result, dict) else result
    if isinstance(body, dict):
        matches = body.get("matches") or body.get("data") or body.get("results") or []
    elif isinstance(body, list):
        matches = body
    else:
        matches = []
    out["matches_count"] = len(matches)
    # Keep a summary, not the raw blobs — cheaper, easier to eyeball.
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
    out["matches"] = summary

    # 2) For top N matches that have messages, enqueue message-thread jobs
    from clapcheeks.platforms.hinge_api import HingeAPIClient

    active = [s for s in summary if s["has_messages"] and s["match_id"]][:top_messages]
    for s in active:
        mid = s["match_id"]
        url = HingeAPIClient.message_thread_url(mid, limit=50)
        tjid = enqueue_job(
            user_id=user_id,
            job_type="get_messages",
            platform="hinge",
            url=url,
            method="GET",
            headers={"X-Auth-Token": token},
        )
        if not tjid:
            out["threads"].append({"match_id": mid, "ok": False, "reason": "enqueue_failed"})
            continue
        tr = wait_for_completion(tjid, timeout_seconds=timeout)
        if tr is None:
            out["threads"].append({"match_id": mid, "ok": False, "reason": "extension_offline"})
            continue
        tb = tr.get("body") if isinstance(tr, dict) else tr
        msgs_raw = (tb.get("messages") if isinstance(tb, dict) else tb) or []
        msgs = []
        for mm in msgs_raw:
            msgs.append({
                "message_id": mm.get("messageId") or mm.get("id"),
                "from_self": bool(mm.get("fromSelf") or mm.get("isSelf")),
                "body": mm.get("body") or mm.get("text"),
                "sent_at": mm.get("createdAt") or mm.get("sentAt"),
            })
        out["threads"].append({
            "match_id": mid,
            "name": s.get("name"),
            "ok": True,
            "message_count": len(msgs),
            "messages": msgs,
        })
    return out


def snapshot_instagram(user_id: str, token: str | None, top_threads: int, timeout: int) -> dict:
    if not token:
        return {"ok": False, "reason": "no_instagram_token"}
    from clapcheeks.platforms import instagram_dm

    threads = instagram_dm.fetch_inbox_sync(
        user_id=user_id, stored_token=token, timeout_seconds=timeout,
    )
    if not threads:
        return {"ok": False, "reason": "no_inbox_result_or_empty", "threads": []}

    out: dict = {
        "ok": True,
        "inbox_count": len(threads),
        "inbox": threads,
        "threads": [],
    }
    # Fetch full message history for top N threads
    for t in threads[:top_threads]:
        tid = t.get("thread_id")
        if not tid:
            continue
        detail = instagram_dm.fetch_thread_sync(
            user_id=user_id,
            thread_id=tid,
            stored_token=token,
            timeout_seconds=timeout,
        )
        out["threads"].append({
            "thread_id": tid,
            "thread_title": t.get("thread_title"),
            "usernames": t.get("usernames"),
            "message_count": len(detail.get("messages", [])),
            "messages": detail.get("messages", []),
        })
    return out


def snapshot_tinder(user_id: str, token: str | None, timeout: int) -> dict:
    if not token:
        return {"ok": False, "reason": "no_tinder_token"}
    from clapcheeks.job_queue import enqueue_job, wait_for_completion

    # Tinder's /v2/matches supports message=1 to bundle recent messages
    url = "https://api.gotinder.com/v2/matches?count=60&message=1&is_tinder_u=0&locale=en"
    jid = enqueue_job(
        user_id=user_id,
        job_type="list_matches",
        platform="tinder",
        url=url,
        method="GET",
        headers={"X-Auth-Token": token},
    )
    if not jid:
        return {"ok": False, "reason": "enqueue_failed"}
    result = wait_for_completion(jid, timeout_seconds=timeout)
    if result is None:
        return {"ok": False, "reason": "extension_offline_or_timeout"}
    sc = result.get("status_code") if isinstance(result, dict) else None
    if sc is not None and not (200 <= sc < 300):
        return {"ok": False, "reason": f"tinder_http_{sc}", "body": result.get("body")}

    body = result.get("body") if isinstance(result, dict) else result
    data = (body.get("data") if isinstance(body, dict) else None) or {}
    matches = data.get("matches") or []
    summary: list[dict] = []
    for m in matches:
        person = m.get("person") or {}
        msgs = m.get("messages") or []
        summary.append({
            "match_id": m.get("id"),
            "name": person.get("name"),
            "person_id": person.get("_id"),
            "message_count": m.get("message_count") or len(msgs),
            "last_activity_at": m.get("last_activity_date"),
            "messages": [
                {
                    "id": x.get("_id"),
                    "from_self": x.get("from") != person.get("_id"),
                    "body": x.get("message"),
                    "sent_at": x.get("sent_date"),
                }
                for x in msgs
            ],
        })
    return {"ok": True, "matches_count": len(summary), "matches": summary}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Snapshot Hinge/Instagram/Tinder data via Chrome-extension queue.")
    parser.add_argument("--only", action="append", choices=["hinge", "instagram", "tinder"],
                        help="Limit to one or more platforms (default: all with tokens).")
    parser.add_argument("--email", help="Auth email (default: whichever row has tokens).")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS,
                        help=f"Per-job timeout (default: {DEFAULT_TIMEOUT_SECONDS}s).")
    parser.add_argument("--top-messages", type=int, default=DEFAULT_TOP_MESSAGES,
                        help=f"Pull message threads for top N matches per platform (default: {DEFAULT_TOP_MESSAGES}).")
    parser.add_argument("--no-write", action="store_true", help="Don't save output file.")
    args = parser.parse_args()

    _load_env_from_local()
    c = _client()
    user_id, settings = _resolve_user(c, args.email)

    online, online_reason = _extension_online(c, user_id)
    snapshot: dict = {
        "user_id": user_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "extension_online": online,
        "extension_status": online_reason,
        "platforms": {},
    }
    print(f"Chrome extension: {'ACTIVE' if online else 'OFFLINE'} ({online_reason})")
    if not online:
        print("→ Jobs will be enqueued but will go stale unless you open Chrome "
              "on your Mac with the clapcheeks extension loaded.")

    want = set(args.only) if args.only else {"hinge", "instagram", "tinder"}

    if "hinge" in want:
        print(f"\n[hinge] pulling matches + top {args.top_messages} threads…")
        started = time.time()
        snapshot["platforms"]["hinge"] = snapshot_hinge(
            user_id=user_id,
            token=settings.get("hinge_auth_token"),
            top_messages=args.top_messages,
            timeout=args.timeout,
        )
        dur = time.time() - started
        res = snapshot["platforms"]["hinge"]
        if res.get("ok"):
            print(f"  ✓ {res.get('matches_count', 0)} matches, "
                  f"{len([t for t in res.get('threads', []) if t.get('ok')])} threads ({dur:.1f}s)")
        else:
            print(f"  ✗ {res.get('reason')} ({dur:.1f}s)")

    if "instagram" in want:
        print(f"\n[instagram] pulling DM inbox + top {args.top_messages} threads…")
        started = time.time()
        snapshot["platforms"]["instagram"] = snapshot_instagram(
            user_id=user_id,
            token=settings.get("instagram_auth_token"),
            top_threads=args.top_messages,
            timeout=args.timeout,
        )
        dur = time.time() - started
        res = snapshot["platforms"]["instagram"]
        if res.get("ok"):
            print(f"  ✓ {res.get('inbox_count', 0)} threads in inbox, "
                  f"{len(res.get('threads', []))} fully pulled ({dur:.1f}s)")
        else:
            print(f"  ✗ {res.get('reason')} ({dur:.1f}s)")

    if "tinder" in want:
        print(f"\n[tinder] pulling matches + bundled messages…")
        started = time.time()
        snapshot["platforms"]["tinder"] = snapshot_tinder(
            user_id=user_id,
            token=settings.get("tinder_auth_token"),
            timeout=args.timeout,
        )
        dur = time.time() - started
        res = snapshot["platforms"]["tinder"]
        if res.get("ok"):
            print(f"  ✓ {res.get('matches_count', 0)} matches ({dur:.1f}s)")
        else:
            reason = res.get('reason')
            hint = " — log into tinder.com with the extension installed" if reason == "no_tinder_token" else ""
            print(f"  ✗ {reason}{hint} ({dur:.1f}s)")

    snapshot["finished_at"] = datetime.now(timezone.utc).isoformat()

    if not args.no_write:
        out_file = _snapshot_dir() / f"snapshot-{int(time.time())}.json"
        out_file.write_text(json.dumps(snapshot, indent=2, default=str))
        print(f"\nSaved: {out_file}")
    print(f"\n{json.dumps({k: v.get('ok') for k, v in snapshot['platforms'].items()}, indent=2)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
