"""JSON-backed conversation state store at ~/.clapcheeks/conversations.json."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_STATE_FILE = Path.home() / ".clapcheeks" / "conversations.json"


def _load() -> dict:
    if _STATE_FILE.exists():
        try:
            return json.loads(_STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to read conversation state: %s", exc)
    return {}


def _save(data: dict) -> None:
    _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _STATE_FILE.write_text(json.dumps(data, indent=2))


def get_conversation(match_id: str) -> dict:
    """Return state dict for a match, or defaults if not tracked yet."""
    data = _load()
    return data.get(match_id, {
        "message_count": 0,
        "last_ts": 0.0,
        "date_asked": False,
        "platform": "",
    })


def update_conversation(match_id: str, **kwargs) -> dict:
    """Update fields for a match and persist."""
    data = _load()
    entry = data.get(match_id, {
        "message_count": 0,
        "last_ts": 0.0,
        "date_asked": False,
        "platform": "",
    })
    entry.update(kwargs)
    data[match_id] = entry
    _save(data)
    return entry


def get_stale_conversations(hours: int = 48) -> list[dict]:
    """Return conversations silent for more than *hours* hours."""
    data = _load()
    cutoff = time.time() - (hours * 3600)
    stale = []
    for match_id, entry in data.items():
        last_ts = entry.get("last_ts", 0)
        if 0 < last_ts < cutoff and not entry.get("date_asked"):
            stale.append({"match_id": match_id, **entry})
    return stale
