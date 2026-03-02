"""Offline queue — persists failed syncs to disk, retries with backoff.

Queue file: ~/.clapcheeks/sync_queue.json
Each entry has platform, date, metric fields, and a retry_count.
Max 10 retries per entry. Deduplicates by (platform, date).
"""
from __future__ import annotations

import json
from pathlib import Path

QUEUE_FILE = Path.home() / ".clapcheeks" / "sync_queue.json"
MAX_RETRIES = 10


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
    """Try to POST each queued item. Remove successes, keep failures.

    Returns count of successfully flushed items.
    Skips items with retry_count > MAX_RETRIES.
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

    for item in queue:
        if item.get("retry_count", 0) > MAX_RETRIES:
            remaining.append(item)
            continue

        # Build clean payload without retry_count
        payload = {k: v for k, v in item.items() if k != "retry_count"}

        try:
            resp = requests.post(
                f"{api_url}/analytics/sync",
                json=payload,
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                flushed += 1
            else:
                item["retry_count"] = item.get("retry_count", 0) + 1
                remaining.append(item)
        except Exception:
            item["retry_count"] = item.get("retry_count", 0) + 1
            remaining.append(item)

    _save_queue(remaining)
    return flushed


def get_queue_size() -> int:
    """Return number of pending items in queue."""
    return len(_load_queue())
