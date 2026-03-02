"""Sync engine — collects local stats, POSTs per-platform rows to API.

Only integer counts and dollar totals leave the device.
No messages, names, photos, or match details are ever transmitted.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

SYNC_STATE_FILE = Path.home() / ".outward" / "sync_state.json"
PLATFORMS = ("tinder", "bumble", "hinge")


def collect_daily_metrics() -> list[dict]:
    """Build per-platform sync payloads from local state.

    Returns a list of dicts, one per platform that has any activity today.
    Only aggregate counts — no personal data.
    """
    from outward.session.rate_limiter import get_daily_summary, get_daily_spend

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


def push_metrics(config: dict) -> tuple[int, int]:
    """POST each platform row to API. Returns (synced_count, queued_count)."""
    import requests

    from outward.queue import flush_queue, queue_sync

    api_url = config.get("api_url", "https://api.clapcheeks.tech")
    token = config.get("agent_token", "")
    headers = {"Authorization": f"Bearer {token}"}

    # Retry any previously queued items first
    flush_queue(config)

    rows = collect_daily_metrics()
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
