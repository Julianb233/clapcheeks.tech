"""Offline queue — persists failed syncs to disk, retries with backoff.

Queue file: ~/.clapcheeks/sync_queue.json
Each entry has platform, date, metric fields, and a retry_count.
Max 50 retries per entry with exponential backoff. Deduplicates by (platform, date).
"""
from __future__ import annotations

import json
import logging
import random
import time
from pathlib import Path

QUEUE_FILE = Path.home() / ".clapcheeks" / "sync_queue.json"
MAX_RETRIES = 50
INITIAL_BACKOFF = 5       # seconds
MAX_BACKOFF = 300         # 5 minutes max wait

log = logging.getLogger(__name__)


def _load_queue() -> list[dict]:
    """Load queue from disk."""
    if QUEUE_FILE.exists():
        try:
            data = json.loads(QUEUE_FILE.read_text())
            if isinstance(data, list):
                return data
        except Exception:
            pass
    return []


def _save_queue(queue: list[dict]) -> None:
    """Atomic write queue to disk."""
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = QUEUE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(queue, indent=2))
    tmp.rename(QUEUE_FILE)


def queue_sync(payload: dict) -> None:
    """Append payload to queue. Deduplicates by (platform, date)."""
    queue = _load_queue()
    key = (payload.get("platform"), payload.get("date"))

    # Replace existing entry for same platform+date
    queue = [
        item for item in queue
        if (item.get("platform"), item.get("date")) != key
    ]

    entry = {**payload, "retry_count": 0}
    queue.append(entry)
    _save_queue(queue)


def flush_queue(config: dict) -> int:
    """Try to POST each queued item with exponential backoff on failures.

    Returns count of successfully flushed items.
    Items exceeding MAX_RETRIES are dropped with a warning pushed to dashboard.
    """
    import requests

    queue = _load_queue()
    if not queue:
        return 0

    api_url = config.get("api_url", "https://api.clapcheeks.tech")
    token = config.get("agent_token", "")
    headers = {"Authorization": f"Bearer {token}"}

    remaining = []
    flushed = 0
    dropped = 0

    for item in queue:
        retry_count = item.get("retry_count", 0)

        if retry_count >= MAX_RETRIES:
            log.error(
                "[QUEUE] Dropping item after %d retries: %s/%s",
                MAX_RETRIES,
                item.get("platform", "?"),
                item.get("date", "?"),
            )
            dropped += 1
            continue

        # Build clean payload without retry metadata
        payload = {k: v for k, v in item.items() if k not in ("retry_count", "last_backoff")}

        try:
            resp = requests.post(
                f"{api_url}/analytics/sync",
                json=payload,
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                flushed += 1
                if retry_count > 0:
                    log.info("[QUEUE] Item recovered after %d retries", retry_count)
            else:
                item["retry_count"] = retry_count + 1
                # Calculate backoff for logging
                current_backoff = min(INITIAL_BACKOFF * (2 ** retry_count), MAX_BACKOFF)
                jitter = random.uniform(0, current_backoff * 0.1)
                item["last_backoff"] = current_backoff + jitter
                log.warning(
                    "[QUEUE] Flush failed (attempt %d/%d, HTTP %d). Next backoff: %.1fs",
                    retry_count + 1, MAX_RETRIES, resp.status_code, item["last_backoff"],
                )
                remaining.append(item)
        except Exception as exc:
            item["retry_count"] = retry_count + 1
            current_backoff = min(INITIAL_BACKOFF * (2 ** retry_count), MAX_BACKOFF)
            jitter = random.uniform(0, current_backoff * 0.1)
            item["last_backoff"] = current_backoff + jitter
            log.warning(
                "[QUEUE] Flush failed (attempt %d/%d): %s. Next backoff: %.1fs",
                retry_count + 1, MAX_RETRIES, exc, item["last_backoff"],
            )
            remaining.append(item)

    if dropped > 0:
        _push_dropped_messages_warning(dropped)

    _save_queue(remaining)
    return flushed


def _push_dropped_messages_warning(count: int) -> None:
    """Notify Supabase that messages were dropped due to persistent failures."""
    try:
        import os
        from clapcheeks.sync import _load_supabase_env
        from supabase import create_client

        url, key = _load_supabase_env()
        if not url or not key:
            return

        client = create_client(url, key)
        client.table("clapcheeks_agent_tokens").update({
            "status": "degraded",
            "degraded_reason": f"Message queue dropped {count} item(s) — persistent send failures",
        }).eq("device_id", os.environ.get("DEVICE_ID", "default")).execute()
    except Exception:
        pass  # Don't let notification failure cascade


def get_queue_size() -> int:
    """Return number of pending items in queue."""
    return len(_load_queue())
