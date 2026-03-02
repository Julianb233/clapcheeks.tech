"""Google Calendar client — finds free slots and books dates."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
]

PREFERRED_DATE_HOURS = {
    "weekday": {"start": 17, "end": 22},
    "weekend": {"start": 11, "end": 22},
}


def _build_service():
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
        refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN", "")

        if not all([client_id, client_secret, refresh_token]):
            return None

        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=_SCOPES,
        )
        return build("calendar", "v3", credentials=creds, cache_discovery=False)
    except Exception as exc:
        logger.warning("Could not build Google Calendar service: %s", exc)
        return None


def get_free_slots(days: int = 7, min_duration_hours: float = 2.0) -> list[dict]:
    """Find available time slots for a date in the next N days."""
    service = _build_service()
    if not service:
        return []

    now = datetime.now(timezone.utc)
    end = now + timedelta(days=days)

    try:
        events_result = service.events().list(
            calendarId="primary",
            timeMin=now.isoformat(),
            timeMax=end.isoformat(),
            singleEvents=True,
            orderBy="startTime",
            maxResults=100,
        ).execute()
        events = events_result.get("items", [])
    except Exception as exc:
        logger.error("Failed to fetch calendar events: %s", exc)
        return []

    busy: list[tuple[datetime, datetime]] = []
    for event in events:
        start_str = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
        end_str = event.get("end", {}).get("dateTime") or event.get("end", {}).get("date")
        if not start_str or not end_str:
            continue
        try:
            s = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            e = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            busy.append((s, e))
        except Exception:
            continue

    free_slots = []
    for day_offset in range(days):
        day = (now + timedelta(days=day_offset)).date()
        is_weekend = day.weekday() >= 5
        hours = PREFERRED_DATE_HOURS["weekend" if is_weekend else "weekday"]

        slot_start = datetime(day.year, day.month, day.day, hours["start"], 0, tzinfo=timezone.utc)
        slot_end = datetime(day.year, day.month, day.day, hours["end"], 0, tzinfo=timezone.utc)

        if slot_end < now:
            continue
        if slot_start < now:
            slot_start = now

        day_busy = sorted([(s, e) for s, e in busy if s < slot_end and e > slot_start], key=lambda x: x[0])

        gaps = []
        cursor = slot_start
        for busy_start, busy_end in day_busy:
            if busy_start > cursor:
                gaps.append((cursor, busy_start))
            cursor = max(cursor, busy_end)
        if cursor < slot_end:
            gaps.append((cursor, slot_end))

        for gap_start, gap_end in gaps:
            duration = (gap_end - gap_start).total_seconds() / 3600
            if duration >= min_duration_hours:
                label = f"{gap_start.strftime('%A')} {gap_start.strftime('%-I%p').lower()}"
                free_slots.append({
                    "start": gap_start.isoformat(),
                    "end": gap_end.isoformat(),
                    "label": label,
                    "duration_hours": round(duration, 1),
                    "is_weekend": is_weekend,
                })

    return free_slots[:8]


def book_date(match_name: str, start_iso: str, duration_hours: float = 2.0, location: str = "", description: str = "") -> dict | None:
    """Create a Google Calendar event for a date."""
    service = _build_service()
    if not service:
        logger.warning("Google Calendar not configured — cannot book date.")
        return None

    try:
        start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        end_dt = start_dt + timedelta(hours=duration_hours)

        event = {
            "summary": f"Date with {match_name}",
            "location": location,
            "description": description or f"Date booked via Clap Cheeks",
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"},
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "popup", "minutes": 60},
                    {"method": "popup", "minutes": 15},
                ],
            },
        }
        created = service.events().insert(calendarId="primary", body=event).execute()
        logger.info("Date booked: %s", created.get("htmlLink"))
        return created
    except Exception as exc:
        logger.error("Failed to book date: %s", exc)
        return None


def get_upcoming_dates(days: int = 30) -> list[dict]:
    """Return upcoming calendar events that look like dates."""
    service = _build_service()
    if not service:
        return []

    now = datetime.now(timezone.utc)
    try:
        result = service.events().list(
            calendarId="primary",
            timeMin=now.isoformat(),
            timeMax=(now + timedelta(days=days)).isoformat(),
            q="Date with",
            singleEvents=True,
            orderBy="startTime",
        ).execute()
        return result.get("items", [])
    except Exception:
        return []
