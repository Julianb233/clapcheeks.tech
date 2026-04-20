"""JSON-backed conversation state store at ~/.clapcheeks/conversations.json.

Each match has a *stage* label that drives the drip engine, the Kanban UI,
and the date-booking workflow.
"""
from __future__ import annotations

import json
import logging
import time
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)

_STATE_FILE = Path.home() / ".clapcheeks" / "conversations.json"


class Stage(str, Enum):
    """Lifecycle stages for a match. Ordered loosely chronologically."""

    MATCHED = "matched"              # right-swipe mutual, no opener sent yet
    OPENED = "opened"                # we sent the first message
    REPLYING = "replying"            # back-and-forth in progress
    DATE_PROPOSED = "date_proposed"  # we've asked for a date
    DATE_BOOKED = "date_booked"      # calendar event created
    DATE_HAPPENED = "date_happened"  # event is in the past, outcome logged
    ONGOING = "ongoing"              # seeing each other past first date
    DEAD = "dead"                    # archived — reengagement exhausted

    @classmethod
    def order(cls) -> list["Stage"]:
        return [
            cls.MATCHED, cls.OPENED, cls.REPLYING, cls.DATE_PROPOSED,
            cls.DATE_BOOKED, cls.DATE_HAPPENED, cls.ONGOING, cls.DEAD,
        ]


# Stage transitions that ConversationManager / drip engine are allowed to
# trigger automatically. Everything else requires explicit user override.
_AUTO_TRANSITIONS: dict[str, set[str]] = {
    Stage.MATCHED.value: {Stage.OPENED.value, Stage.DEAD.value},
    Stage.OPENED.value: {Stage.REPLYING.value, Stage.DEAD.value},
    Stage.REPLYING.value: {Stage.DATE_PROPOSED.value, Stage.DEAD.value},
    Stage.DATE_PROPOSED.value: {Stage.DATE_BOOKED.value, Stage.REPLYING.value, Stage.DEAD.value},
    Stage.DATE_BOOKED.value: {Stage.DATE_HAPPENED.value, Stage.DEAD.value},
    Stage.DATE_HAPPENED.value: {Stage.ONGOING.value, Stage.DEAD.value},
    Stage.ONGOING.value: {Stage.DEAD.value},
    Stage.DEAD.value: set(),
}


_DEFAULT_ENTRY: dict = {
    "message_count": 0,
    "last_ts": 0.0,
    "last_sender": "",   # "us" | "them" | ""
    "date_asked": False,
    "platform": "",
    "stage": Stage.MATCHED.value,
    "stage_entered_at": 0.0,
    "name": "",
    "tag": "",           # user-editable free-text
    "notes": "",
    "slot_iso": "",      # proposed slot start, set when stage=DATE_PROPOSED
    "outcome": "",       # post-date self-rating: great | ok | ghosted | bailed
}


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

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


def _ensure_defaults(entry: dict) -> dict:
    """Backfill any missing fields (for state files from older versions)."""
    out = dict(_DEFAULT_ENTRY)
    out.update(entry)
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_conversation(match_id: str) -> dict:
    data = _load()
    return _ensure_defaults(data.get(match_id, {}))


def update_conversation(match_id: str, **kwargs) -> dict:
    data = _load()
    entry = _ensure_defaults(data.get(match_id, {}))
    entry.update(kwargs)
    data[match_id] = entry
    _save(data)
    return entry


def list_conversations() -> list[dict]:
    """Return every tracked conversation as a flat list with match_id included."""
    data = _load()
    return [{"match_id": mid, **_ensure_defaults(e)} for mid, e in data.items()]


def get_stale_conversations(hours: int = 48) -> list[dict]:
    """Return conversations silent for more than *hours* hours, not dead, not booked."""
    cutoff = time.time() - (hours * 3600)
    stale: list[dict] = []
    for conv in list_conversations():
        last = conv.get("last_ts", 0)
        if last <= 0 or last >= cutoff:
            continue
        if conv.get("stage") in (Stage.DEAD.value, Stage.DATE_BOOKED.value,
                                  Stage.DATE_HAPPENED.value, Stage.ONGOING.value):
            continue
        if conv.get("date_asked"):
            continue
        stale.append(conv)
    return stale


def get_by_stage(stage: "Stage | str") -> list[dict]:
    target = stage.value if isinstance(stage, Stage) else stage
    return [c for c in list_conversations() if c.get("stage") == target]


def set_stage(
    match_id: str,
    new_stage: "Stage | str",
    *,
    force: bool = False,
) -> dict:
    """Transition a match to a new stage.

    By default only legal auto-transitions are allowed. Pass force=True to
    override (e.g. from a user drag in the Kanban UI).
    """
    target = new_stage.value if isinstance(new_stage, Stage) else new_stage
    if target not in {s.value for s in Stage}:
        raise ValueError(f"Unknown stage: {target!r}")

    conv = get_conversation(match_id)
    current = conv.get("stage", Stage.MATCHED.value)

    if target == current:
        return conv
    if not force and target not in _AUTO_TRANSITIONS.get(current, set()):
        raise ValueError(
            f"Illegal auto-transition {current!r} -> {target!r}. "
            "Pass force=True for manual override."
        )

    return update_conversation(
        match_id,
        stage=target,
        stage_entered_at=time.time(),
    )


def advance_stage(match_id: str) -> dict:
    """Advance to the next stage in the canonical order, if legal."""
    conv = get_conversation(match_id)
    current = conv.get("stage", Stage.MATCHED.value)
    order = [s.value for s in Stage.order()]
    try:
        idx = order.index(current)
    except ValueError:
        idx = 0
    if idx + 1 >= len(order):
        return conv
    next_stage = order[idx + 1]
    if next_stage not in _AUTO_TRANSITIONS.get(current, set()):
        return conv  # no legal advance; caller should set_stage with force
    return set_stage(match_id, next_stage)
