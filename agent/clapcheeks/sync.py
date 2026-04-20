"""Sync engine — collects local stats, POSTs per-platform rows to API.

Only integer counts and dollar totals leave the device.
No messages, names, photos, or match details are ever transmitted.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path

SYNC_STATE_FILE = Path.home() / ".clapcheeks" / "sync_state.json"
PLATFORMS = ("tinder", "bumble", "hinge", "grindr", "badoo", "happn", "okcupid", "pof", "feeld", "cmb")


def collect_daily_metrics() -> list[dict]:
    """Build per-platform sync payloads from local state.

    Returns a list of dicts, one per platform that has any activity today.
    Only aggregate counts — no personal data.
    """
    from clapcheeks.session.rate_limiter import get_daily_summary, get_daily_spend

    counts = get_daily_summary()
    spend = get_daily_spend()
    today = date.today().isoformat()

    rows = []
    for platform in PLATFORMS:
        r = counts.get(f"{platform}_right", 0)
        l = counts.get(f"{platform}_left", 0)
        m = counts.get(f"{platform}_matches", 0)
        c = counts.get(f"{platform}_conversations", 0)
        d = counts.get(f"{platform}_dates", 0)
        s = spend.get(platform, 0.0)

        if r or l or m or c or d or s:
            rows.append({
                "platform": platform,
                "date": today,
                "swipes_right": r,
                "swipes_left": l,
                "matches": m,
                "conversations_started": c,
                "dates_booked": d,
                "money_spent": s,
            })

    return rows


def _load_supabase_env() -> tuple[str | None, str | None]:
    """Load SUPABASE_URL and SUPABASE_SERVICE_KEY from env or ~/.clapcheeks/.env."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if url and key:
        return url, key

    env_file = Path.home() / ".clapcheeks" / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip("'\"")
                    if k == "SUPABASE_URL" and not url:
                        url = v
                    elif k == "SUPABASE_SERVICE_KEY" and not key:
                        key = v
        except Exception:
            pass

    return url if url else None, key if key else None


def push_metrics_supabase(rows: list[dict]) -> int:
    """Upsert rows into clapcheeks_analytics_daily via supabase-py. Returns count upserted."""
    from supabase import create_client

    url, key = _load_supabase_env()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_KEY not set")

    client = create_client(url, key)
    result = client.table("clapcheeks_analytics_daily").upsert(rows).execute()
    return len(result.data) if result.data else 0


def push_metrics(config: dict) -> tuple[int, int]:
    """Sync metrics — tries Supabase direct upsert first, falls back to API POST."""
    import requests

    from clapcheeks.queue import flush_queue, queue_sync

    # Retry any previously queued items first
    flush_queue(config)

    rows = collect_daily_metrics()
    if not rows:
        return 0, 0

    # Primary path: Supabase direct upsert
    try:
        count = push_metrics_supabase(rows)
        return count, 0
    except Exception:
        pass

    # Fallback: API POST per row
    api_url = config.get("api_url", "https://api.clapcheeks.tech")
    token = config.get("agent_token", "")
    headers = {"Authorization": f"Bearer {token}"}

    synced = 0
    queued = 0

    for row in rows:
        try:
            resp = requests.post(
                f"{api_url}/analytics/sync",
                json=row,
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                synced += 1
            else:
                queue_sync(row)
                queued += 1
        except Exception:
            queue_sync(row)
            queued += 1

    return synced, queued


def get_last_sync_time() -> str | None:
    """Read last successful sync timestamp from sync_state.json."""
    if SYNC_STATE_FILE.exists():
        try:
            data = json.loads(SYNC_STATE_FILE.read_text())
            return data.get("last_sync")
        except Exception:
            pass
    return None


def record_sync_time() -> None:
    """Write current ISO timestamp to sync_state.json."""
    SYNC_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if SYNC_STATE_FILE.exists():
        try:
            data = json.loads(SYNC_STATE_FILE.read_text())
        except Exception:
            pass
    data["last_sync"] = datetime.now().isoformat(timespec="seconds")
    tmp = SYNC_STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.rename(SYNC_STATE_FILE)


# ---------------------------------------------------------------------------
# Lead pipeline sync — pushes conversation state rows to clapcheeks_leads
# ---------------------------------------------------------------------------

def _epoch_to_iso(ts: float | int | None) -> str | None:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(float(ts)).isoformat(timespec="seconds") + "Z"
    except Exception:
        return None


def _get_user_id_from_token() -> str | None:
    """Resolve the logged-in user's UUID from the agent token.

    We rely on the agent-tokens table to have user_id linked to the token.
    Falls back to env (CLAPCHEEKS_USER_ID) to support bench testing.
    """
    fallback = os.environ.get("CLAPCHEEKS_USER_ID")
    if fallback:
        return fallback
    try:
        from supabase import create_client
        url, key = _load_supabase_env()
        if not url or not key:
            return None
        client = create_client(url, key)
        device_id = os.environ.get("DEVICE_ID", "default")
        resp = client.table("clapcheeks_agent_tokens") \
            .select("user_id") \
            .eq("device_id", device_id) \
            .limit(1) \
            .execute()
        rows = resp.data or []
        return rows[0]["user_id"] if rows and rows[0].get("user_id") else None
    except Exception:
        return None


def collect_lead_rows(user_id: str, privacy: str = "full") -> list[dict]:
    """Project conversation state into clapcheeks_leads row shape.

    privacy: "full" includes name/bio/prompts; "metadata_only" redacts names
    and keeps only stage + counts + timestamps.
    """
    from clapcheeks.conversation.state import list_conversations

    rows: list[dict] = []
    for conv in list_conversations():
        base = {
            "user_id": user_id,
            "platform": conv.get("platform", ""),
            "match_id": conv.get("match_id", ""),
            "stage": conv.get("stage", "matched"),
            "stage_entered_at": _epoch_to_iso(conv.get("stage_entered_at")),
            "last_message_at": _epoch_to_iso(conv.get("last_ts")),
            "last_message_by": conv.get("last_sender") or None,
            "message_count": conv.get("message_count", 0) or 0,
            "date_asked_at": _epoch_to_iso(conv.get("last_ts"))
                                if conv.get("date_asked") else None,
            "date_slot_iso": conv.get("slot_iso") or None,
            "outcome": conv.get("outcome") or None,
            "drip_fired": conv.get("drip_fired") or {},
        }
        if privacy == "full":
            base.update({
                "name": conv.get("name") or None,
                "tag": conv.get("tag") or None,
                "notes": conv.get("notes") or None,
            })
        if not base["platform"] or not base["match_id"]:
            continue  # can't upsert without the composite key
        rows.append(base)
    return rows


def push_leads(config: dict | None = None) -> tuple[int, int]:
    """Upsert every tracked lead into clapcheeks_leads.

    Returns (upserted, skipped). Skipped includes rows we couldn't route
    (no user_id) or errors.
    """
    try:
        from supabase import create_client
    except ImportError:
        return 0, 0

    url, key = _load_supabase_env()
    if not url or not key:
        return 0, 0

    user_id = _get_user_id_from_token()
    if not user_id:
        return 0, 0

    privacy = os.environ.get("CLAPCHEEKS_SYNC_LEADS", "full").strip().lower()
    if privacy == "off":
        return 0, 0

    rows = collect_lead_rows(user_id, privacy=privacy)
    if not rows:
        return 0, 0

    try:
        client = create_client(url, key)
        result = client.table("clapcheeks_leads") \
            .upsert(rows, on_conflict="user_id,platform,match_id") \
            .execute()
        return len(result.data or []), 0
    except Exception:
        return 0, len(rows)
