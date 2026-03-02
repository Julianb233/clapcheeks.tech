"""macOS Calendar integration — reads and writes Calendar.app via AppleScript.

No OAuth, no credentials required. Uses osascript to talk directly to Calendar.app.
macOS will prompt for Calendar permission on first run (one-time).

Falls back to Google OAuth if GOOGLE_REFRESH_TOKEN is set (for non-Mac environments).
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

PREFERRED_DATE_HOURS = {
    "weekday": {"start": 17, "end": 22},   # evenings
    "weekend": {"start": 11, "end": 22},   # all day
}


# ── macOS Calendar via AppleScript ─────────────────────────────────────────

def _run_osascript(script: str) -> str | None:
    """Run an AppleScript and return stdout, or None on failure."""
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        logger.debug("osascript error: %s", result.stderr.strip())
        return None
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logger.debug("osascript not available: %s", exc)
        return None


def _is_macos() -> bool:
    return os.uname().sysname == "Darwin" if hasattr(os, "uname") else False


def get_free_slots(days: int = 7, min_duration_hours: float = 2.0) -> list[dict]:
    """Find free time slots suitable for dates.

    On macOS: reads Calendar.app directly via AppleScript (no auth needed).
    Fallback: Google Calendar OAuth (if GOOGLE_REFRESH_TOKEN is set).
    """
    if _is_macos():
        slots = _get_free_slots_macos(days, min_duration_hours)
        if slots is not None:
            return slots

    # Fallback to Google Calendar OAuth
    return _get_free_slots_google(days, min_duration_hours)


def _get_free_slots_macos(days: int, min_duration_hours: float) -> list[dict] | None:
    """Read Calendar.app events via AppleScript and find free windows."""
    # AppleScript to get all events in the next N days as JSON-ish text
    script = f"""
set output to ""
set startDate to current date
set endDate to startDate + ({days} * days * 1)
tell application "Calendar"
    repeat with aCal in calendars
        set calEvents to (every event of aCal whose start date >= startDate and start date <= endDate)
        repeat with anEvent in calEvents
            set evStart to start date of anEvent
            set evEnd to end date of anEvent
            set evSummary to summary of anEvent
            set output to output & (evStart as string) & "|" & (evEnd as string) & "|" & evSummary & "\\n"
        end repeat
    end repeat
end tell
return output
"""
    raw = _run_osascript(script)
    if raw is None:
        return None

    # Parse busy intervals
    busy: list[tuple[datetime, datetime]] = []
    for line in raw.splitlines():
        if "|" not in line:
            continue
        parts = line.split("|")
        if len(parts) < 2:
            continue
        try:
            # AppleScript date format: "Sunday, 1 March 2026 at 17:00:00"
            fmt = "%A, %d %B %Y at %H:%M:%S"
            s = datetime.strptime(parts[0].strip(), fmt).replace(tzinfo=timezone.utc)
            e = datetime.strptime(parts[1].strip(), fmt).replace(tzinfo=timezone.utc)
            busy.append((s, e))
        except ValueError:
            continue

    return _find_free_slots(busy, days, min_duration_hours)


def _get_free_slots_google(days: int, min_duration_hours: float) -> list[dict]:
    """Google Calendar OAuth fallback."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
        refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN", "")

        if not all([client_id, client_secret, refresh_token]):
            return []

        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=["https://www.googleapis.com/auth/calendar.readonly"],
        )
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        now = datetime.now(timezone.utc)
        events_result = service.events().list(
            calendarId="primary",
            timeMin=now.isoformat(),
            timeMax=(now + timedelta(days=days)).isoformat(),
            singleEvents=True,
            orderBy="startTime",
            maxResults=100,
        ).execute()

        busy = []
        for event in events_result.get("items", []):
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

        return _find_free_slots(busy, days, min_duration_hours)
    except Exception as exc:
        logger.debug("Google Calendar fallback failed: %s", exc)
        return []


def _find_free_slots(
    busy: list[tuple[datetime, datetime]],
    days: int,
    min_duration_hours: float,
) -> list[dict]:
    """Given a list of busy intervals, return free date-friendly time slots."""
    now = datetime.now(timezone.utc)
    free_slots = []

    for day_offset in range(days):
        day = (now + timedelta(days=day_offset)).date()
        is_weekend = day.weekday() >= 5
        hours = PREFERRED_DATE_HOURS["weekend" if is_weekend else "weekday"]

        window_start = datetime(day.year, day.month, day.day, hours["start"], 0, tzinfo=timezone.utc)
        window_end = datetime(day.year, day.month, day.day, hours["end"], 0, tzinfo=timezone.utc)

        if window_end < now:
            continue
        if window_start < now:
            window_start = now

        day_busy = sorted(
            [(s, e) for s, e in busy if s < window_end and e > window_start],
            key=lambda x: x[0],
        )

        gaps = []
        cursor = window_start
        for bs, be in day_busy:
            if bs > cursor:
                gaps.append((cursor, bs))
            cursor = max(cursor, be)
        if cursor < window_end:
            gaps.append((cursor, window_end))

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


def book_date(
    match_name: str,
    start_iso: str,
    duration_hours: float = 2.0,
    location: str = "",
    description: str = "",
) -> dict | None:
    """Book a date on Calendar.app (macOS) or Google Calendar (fallback)."""
    if _is_macos():
        result = _book_date_macos(match_name, start_iso, duration_hours, location)
        if result:
            return result

    return _book_date_google(match_name, start_iso, duration_hours, location, description)


def _book_date_macos(
    match_name: str,
    start_iso: str,
    duration_hours: float,
    location: str,
) -> dict | None:
    """Create a Calendar.app event via AppleScript."""
    try:
        start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        end_dt = start_dt + timedelta(hours=duration_hours)

        # AppleScript date string format
        def _fmt(dt: datetime) -> str:
            return dt.strftime("%B %d, %Y %I:%M:%S %p")

        summary = f"Date with {match_name}"
        loc_line = f'set location of newEvent to "{location}"' if location else ""

        script = f"""
tell application "Calendar"
    set targetCal to first calendar whose name is "Home"
    if targetCal is missing value then
        set targetCal to first calendar
    end if
    tell targetCal
        set newEvent to make new event with properties {{summary:"{summary}", start date:date "{_fmt(start_dt)}", end date:date "{_fmt(end_dt)}"}}
        {loc_line}
        -- Add reminder 60 minutes before
        make new alarm at newEvent with properties {{trigger interval:-60}}
    end tell
    save
end tell
return "booked"
"""
        result = _run_osascript(script)
        if result and "booked" in result:
            logger.info("Date booked in Calendar.app: %s at %s", summary, _fmt(start_dt))
            return {"summary": summary, "start": start_iso, "provider": "macos_calendar"}
        return None
    except Exception as exc:
        logger.error("macOS calendar booking failed: %s", exc)
        return None


def _book_date_google(
    match_name: str,
    start_iso: str,
    duration_hours: float,
    location: str,
    description: str,
) -> dict | None:
    """Create a Google Calendar event (OAuth fallback)."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
        refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN", "")

        if not all([client_id, client_secret, refresh_token]):
            return None

        creds = Credentials(
            token=None, refresh_token=refresh_token, client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=["https://www.googleapis.com/auth/calendar.events"],
        )
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        end_dt = start_dt + timedelta(hours=duration_hours)
        event = {
            "summary": f"Date with {match_name}",
            "location": location,
            "description": description or "Booked via Clap Cheeks",
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"},
            "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 60}]},
        }
        created = service.events().insert(calendarId="primary", body=event).execute()
        return created
    except Exception as exc:
        logger.error("Google Calendar booking failed: %s", exc)
        return None


def get_upcoming_dates(days: int = 30) -> list[dict]:
    """Return upcoming 'Date with' events from Calendar.app or Google Calendar."""
    if _is_macos():
        dates = _get_upcoming_dates_macos(days)
        if dates is not None:
            return dates
    return _get_upcoming_dates_google(days)


def _get_upcoming_dates_macos(days: int) -> list[dict] | None:
    script = f"""
set output to ""
set startDate to current date
set endDate to startDate + ({days} * days * 1)
tell application "Calendar"
    repeat with aCal in calendars
        set calEvents to (every event of aCal whose start date >= startDate and start date <= endDate and summary starts with "Date with")
        repeat with anEvent in calEvents
            set evStart to start date of anEvent
            set evSummary to summary of anEvent
            set evLocation to location of anEvent
            set output to output & (evStart as string) & "|" & evSummary & "|" & evLocation & "\\n"
        end repeat
    end repeat
end tell
return output
"""
    raw = _run_osascript(script)
    if raw is None:
        return None

    events = []
    for line in raw.splitlines():
        if "|" not in line:
            continue
        parts = line.split("|")
        if len(parts) >= 2:
            events.append({
                "start": {"dateTime": parts[0].strip()},
                "summary": parts[1].strip() if len(parts) > 1 else "",
                "location": parts[2].strip() if len(parts) > 2 else "",
            })
    return events


def _get_upcoming_dates_google(days: int) -> list[dict]:
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
        refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN", "")
        if not all([client_id, client_secret, refresh_token]):
            return []
        creds = Credentials(token=None, refresh_token=refresh_token, client_id=client_id,
                            client_secret=client_secret, token_uri="https://oauth2.googleapis.com/token",
                            scopes=["https://www.googleapis.com/auth/calendar.readonly"])
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        now = datetime.now(timezone.utc)
        result = service.events().list(
            calendarId="primary", timeMin=now.isoformat(),
            timeMax=(now + timedelta(days=days)).isoformat(),
            q="Date with", singleEvents=True, orderBy="startTime",
        ).execute()
        return result.get("items", [])
    except Exception:
        return []
