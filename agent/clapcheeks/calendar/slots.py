"""Date slot system — books dates into specific slots on a configured calendar.

Configuration (all overridable via env or ~/.clapcheeks/.env):

    DATE_CALENDAR_EMAIL       — which calendar to book on (default: primary)
    DATE_SLOTS                — comma-separated HH:MM times (default: "18:00,20:00,21:30")
    DATE_SLOT_DAYS_AHEAD      — how many days forward to search (default: 14)
    DATE_SLOT_DURATION_HOURS  — event length (default: 2)
    DATE_TIMEZONE             — IANA tz (default: America/Los_Angeles)
    DATE_SKIP_WEEKDAYS        — comma-separated ints 0-6 to skip (0=Mon). Default "" = allow all.

The slot engine pairs with Google Calendar OAuth — set GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in ~/.clapcheeks/.env, scoped to an
account that has read/write access to DATE_CALENDAR_EMAIL. Shared calendars
are supported.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("clapcheeks.calendar.slots")

DEFAULT_SLOTS = "18:00,20:00,21:30"
DEFAULT_DAYS_AHEAD = 14
DEFAULT_DURATION = 2.0
DEFAULT_TZ = "America/Los_Angeles"


@dataclass
class SlotConfig:
    calendar_email: str
    slot_times: list[time]
    days_ahead: int
    duration_hours: float
    tz_name: str
    skip_weekdays: set[int]


def _parse_hhmm(s: str) -> time | None:
    s = s.strip()
    if not s:
        return None
    try:
        h, m = s.split(":")
        return time(int(h), int(m))
    except Exception:
        logger.warning("Invalid slot time %r — skipping", s)
        return None


def _parse_int_csv(s: str) -> set[int]:
    out: set[int] = set()
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.add(int(part))
        except ValueError:
            continue
    return out


def get_slot_config() -> SlotConfig:
    email = os.environ.get("DATE_CALENDAR_EMAIL", "primary").strip() or "primary"
    slots_raw = os.environ.get("DATE_SLOTS", DEFAULT_SLOTS)
    slot_times = [t for t in (_parse_hhmm(x) for x in slots_raw.split(",")) if t]
    if not slot_times:
        slot_times = [t for t in (_parse_hhmm(x) for x in DEFAULT_SLOTS.split(",")) if t]

    try:
        days_ahead = int(os.environ.get("DATE_SLOT_DAYS_AHEAD", DEFAULT_DAYS_AHEAD))
    except ValueError:
        days_ahead = DEFAULT_DAYS_AHEAD

    try:
        duration = float(os.environ.get("DATE_SLOT_DURATION_HOURS", DEFAULT_DURATION))
    except ValueError:
        duration = DEFAULT_DURATION

    tz_name = os.environ.get("DATE_TIMEZONE", DEFAULT_TZ).strip() or DEFAULT_TZ
    skip_weekdays = _parse_int_csv(os.environ.get("DATE_SKIP_WEEKDAYS", ""))

    return SlotConfig(
        calendar_email=email,
        slot_times=slot_times,
        days_ahead=days_ahead,
        duration_hours=duration,
        tz_name=tz_name,
        skip_weekdays=skip_weekdays,
    )


# ---------------------------------------------------------------------------
# Google Calendar helpers
# ---------------------------------------------------------------------------

def _google_service():
    """Return a Google Calendar API service, or None if credentials missing."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        logger.warning("google-api-python-client not installed — slot booking disabled.")
        return None

    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN")
    if not (client_id and client_secret and refresh_token):
        logger.info("GOOGLE_* creds not set — slot booking disabled.")
        return None

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/calendar"],
    )
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _get_tz(tz_name: str):
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(tz_name)
    except Exception:
        return timezone.utc


# ---------------------------------------------------------------------------
# Slot enumeration
# ---------------------------------------------------------------------------

def _candidate_slot_datetimes(cfg: SlotConfig) -> list[datetime]:
    tz = _get_tz(cfg.tz_name)
    now = datetime.now(tz)
    out: list[datetime] = []
    for day_offset in range(cfg.days_ahead):
        d = (now + timedelta(days=day_offset)).date()
        if d.weekday() in cfg.skip_weekdays:
            continue
        for slot_t in cfg.slot_times:
            dt = datetime.combine(d, slot_t, tzinfo=tz)
            if dt <= now + timedelta(minutes=30):
                continue  # skip slots in the past / too-soon
            out.append(dt)
    return out


def _busy_intervals(
    service,
    calendar_email: str,
    window_start: datetime,
    window_end: datetime,
) -> list[tuple[datetime, datetime]]:
    """Hit FreeBusy on the configured calendar."""
    body = {
        "timeMin": window_start.astimezone(timezone.utc).isoformat(),
        "timeMax": window_end.astimezone(timezone.utc).isoformat(),
        "items": [{"id": calendar_email}],
    }
    try:
        resp = service.freebusy().query(body=body).execute()
    except Exception as exc:
        logger.error("FreeBusy query failed: %s", exc)
        return []
    cal = resp.get("calendars", {}).get(calendar_email, {})
    busy: list[tuple[datetime, datetime]] = []
    for b in cal.get("busy", []):
        try:
            s = datetime.fromisoformat(b["start"].replace("Z", "+00:00"))
            e = datetime.fromisoformat(b["end"].replace("Z", "+00:00"))
            busy.append((s, e))
        except Exception:
            continue
    return busy


def get_next_available_slots(n: int = 3) -> list[dict]:
    """Return up to *n* future slots on the configured calendar that have
    no conflicting busy events.

    Each entry: {start_iso, end_iso, label, weekday, calendar_email}.
    """
    cfg = get_slot_config()
    candidates = _candidate_slot_datetimes(cfg)
    if not candidates:
        return []

    service = _google_service()
    busy: list[tuple[datetime, datetime]] = []
    if service is not None:
        tz = _get_tz(cfg.tz_name)
        window_start = datetime.now(tz)
        window_end = candidates[-1] + timedelta(hours=cfg.duration_hours)
        busy = _busy_intervals(service, cfg.calendar_email, window_start, window_end)

    available: list[dict] = []
    dur = timedelta(hours=cfg.duration_hours)
    for slot_start in candidates:
        slot_end = slot_start + dur
        if _overlaps_any(slot_start, slot_end, busy):
            continue
        label = slot_start.strftime("%A %b %-d, %-I:%M%p").replace("AM", "am").replace("PM", "pm")
        available.append({
            "start_iso": slot_start.isoformat(),
            "end_iso": slot_end.isoformat(),
            "label": label,
            "weekday": slot_start.strftime("%A"),
            "calendar_email": cfg.calendar_email,
        })
        if len(available) >= n:
            break
    return available


def _overlaps_any(
    start: datetime,
    end: datetime,
    busy: list[tuple[datetime, datetime]],
) -> bool:
    for bs, be in busy:
        if start < be and end > bs:
            return True
    return False


# ---------------------------------------------------------------------------
# AI context helpers
# ---------------------------------------------------------------------------

def propose_slots_for_ai(n: int = 3) -> str | None:
    """Return a short string of slots suitable for prompt injection.

    Example: "I'm free Thursday 8pm, Saturday 6pm, or Monday 9:30pm — which works?"
    Returns None when no slots are available (AI will fall back to generic ask).
    """
    slots = get_next_available_slots(n=n)
    if not slots:
        return None
    labels = [s["label"] for s in slots]
    # Short, colloquial forms: drop month/day when the next-7-day weekday is enough
    return "Available: " + "; ".join(labels)


# ---------------------------------------------------------------------------
# Booking
# ---------------------------------------------------------------------------

def book_slot(
    match_name: str,
    start_iso: str,
    *,
    end_iso: str | None = None,
    match_email: str | None = None,
    location: str = "",
    notes: str = "",
    add_meet_link: bool = True,
) -> dict | None:
    """Create a calendar event on the configured calendar for the given slot.

    Returns the event dict (with htmlLink, hangoutLink) or None on failure.
    """
    cfg = get_slot_config()
    service = _google_service()
    if service is None:
        logger.error("Cannot book — Google credentials missing.")
        return None

    start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    if end_iso:
        end_dt = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    else:
        end_dt = start_dt + timedelta(hours=cfg.duration_hours)

    body: dict[str, Any] = {
        "summary": f"Date with {match_name}",
        "description": notes or "Booked via Clapcheeks",
        "location": location,
        "start": {"dateTime": start_dt.isoformat(), "timeZone": cfg.tz_name},
        "end": {"dateTime": end_dt.isoformat(), "timeZone": cfg.tz_name},
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "popup", "minutes": 24 * 60},
                {"method": "popup", "minutes": 60},
            ],
        },
    }
    if match_email:
        body["attendees"] = [{"email": match_email}]
    insert_kwargs: dict[str, Any] = {"calendarId": cfg.calendar_email, "body": body}
    if add_meet_link:
        import uuid
        body["conferenceData"] = {
            "createRequest": {
                "requestId": str(uuid.uuid4()),
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            },
        }
        insert_kwargs["conferenceDataVersion"] = 1
    if match_email:
        insert_kwargs["sendUpdates"] = "all"

    try:
        event = service.events().insert(**insert_kwargs).execute()
        logger.info(
            "Booked date with %s on %s at %s (%s)",
            match_name, cfg.calendar_email, start_dt.isoformat(),
            event.get("htmlLink", ""),
        )
        return event
    except Exception as exc:
        logger.error("Slot booking failed: %s", exc)
        return None
