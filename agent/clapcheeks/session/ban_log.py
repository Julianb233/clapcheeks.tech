"""Ban event log — persistent JSONL log tracking all ban-related events.

Provides:
- Append-only event logging for ban signals, session results, rate limits
- Platform-filtered queries
- Ban-free day counting (for the 7-day success metric)
- Test report generation for verification
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

BAN_LOG_FILE = Path.home() / ".clapcheeks" / "ban_events.jsonl"


def log_ban_event(
    platform: str,
    event_type: str,
    details: str = "",
    severity: str = "info",
) -> None:
    """Append a ban event to the persistent log.

    Args:
        platform: Platform name (tinder, hinge, etc.)
        event_type: Type of event (signal, rate_limit, session_end, ban, etc.)
        details: Human-readable description
        severity: info, warning, critical
    """
    entry = {
        "timestamp": datetime.now().isoformat(),
        "platform": platform,
        "event_type": event_type,
        "details": details,
        "severity": severity,
    }
    BAN_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(BAN_LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def log_session_result(
    platform: str,
    swipes: int = 0,
    matches: int = 0,
    errors: int = 0,
    duration_seconds: float = 0.0,
) -> None:
    """Log the result of a completed swipe session."""
    match_rate = matches / max(swipes, 1)
    log_ban_event(
        platform=platform,
        event_type="session_result",
        details=json.dumps({
            "swipes": swipes,
            "matches": matches,
            "errors": errors,
            "duration_seconds": round(duration_seconds, 1),
            "match_rate": round(match_rate, 4),
        }),
        severity="info",
    )


def get_event_log(
    platform: str | None = None,
    since: datetime | None = None,
    event_type: str | None = None,
) -> list[dict[str, Any]]:
    """Read events from the log with optional filters.

    Args:
        platform: Filter by platform name
        since: Only events after this timestamp
        event_type: Filter by event type
    """
    if not BAN_LOG_FILE.exists():
        return []

    events = []
    for line in BAN_LOG_FILE.read_text().strip().split("\n"):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        if platform and entry.get("platform") != platform:
            continue
        if event_type and entry.get("event_type") != event_type:
            continue
        if since:
            try:
                ts = datetime.fromisoformat(entry["timestamp"])
                if ts < since:
                    continue
            except (ValueError, KeyError):
                continue

        events.append(entry)

    return events


def get_ban_free_days(platform: str | None = None) -> int:
    """Count consecutive days without ban signals.

    Counts backwards from today. A 'ban' event is any event with
    severity='critical' or event_type containing 'ban'.
    """
    events = get_event_log(platform=platform)

    # Find the most recent ban event
    last_ban: datetime | None = None
    for event in events:
        severity = event.get("severity", "info")
        event_type = event.get("event_type", "")
        if severity == "critical" or "ban" in event_type.lower():
            try:
                ts = datetime.fromisoformat(event["timestamp"])
                if last_ban is None or ts > last_ban:
                    last_ban = ts
            except (ValueError, KeyError):
                continue

    if last_ban is None:
        # No bans ever recorded — count from first event or return 7+
        if events:
            try:
                first = datetime.fromisoformat(events[0]["timestamp"])
                return (datetime.now() - first).days
            except (ValueError, KeyError):
                pass
        return 7  # No events at all = clean

    return (datetime.now() - last_ban).days


def get_ban_test_report() -> dict[str, Any]:
    """Generate a ban test report for verification.

    Returns per-platform pass/fail based on 7-day ban-free criteria.
    """
    platforms = [
        "tinder", "hinge", "bumble", "grindr", "badoo",
        "happn", "okcupid", "pof", "feeld", "cmb",
    ]

    report: dict[str, Any] = {
        "generated_at": datetime.now().isoformat(),
        "target_days": 7,
        "platforms": {},
    }

    all_pass = True
    for platform in platforms:
        ban_free = get_ban_free_days(platform)
        passed = ban_free >= 7
        if not passed:
            all_pass = False
        report["platforms"][platform] = {
            "ban_free_days": ban_free,
            "passed": passed,
            "events_last_7d": len(get_event_log(
                platform=platform,
                since=datetime.now() - timedelta(days=7),
            )),
        }

    report["overall_pass"] = all_pass
    return report
