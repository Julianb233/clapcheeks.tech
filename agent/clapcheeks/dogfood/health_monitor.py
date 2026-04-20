"""Health monitor — tracks agent uptime, crashes, and consecutive-day streaks.

Writes a heartbeat file every check interval. The dogfooding dashboard reads
these to determine if the 7-consecutive-day success criterion is met.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

log = logging.getLogger("clapcheeks.dogfood.health")

HEALTH_DIR = Path.home() / ".clapcheeks" / "dogfood" / "health"
HEARTBEAT_FILE = HEALTH_DIR / "heartbeat.json"
DAILY_LOG_FILE = HEALTH_DIR / "daily_log.jsonl"
CRASH_LOG_FILE = HEALTH_DIR / "crashes.jsonl"


class HealthMonitor:
    """Monitor agent health for dogfooding criteria."""

    def __init__(self, health_dir: Optional[Path] = None):
        self.health_dir = health_dir or HEALTH_DIR
        self.health_dir.mkdir(parents=True, exist_ok=True)
        self.heartbeat_file = self.health_dir / "heartbeat.json"
        self.daily_log = self.health_dir / "daily_log.jsonl"
        self.crash_log = self.health_dir / "crashes.jsonl"

    def record_heartbeat(self, platforms_active: list[str] | None = None) -> dict:
        """Record a heartbeat — proves the agent is alive right now."""
        hb = {
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "epoch": int(time.time()),
            "date": date.today().isoformat(),
            "platforms_active": platforms_active or [],
            "pid": os.getpid(),
        }
        tmp = self.heartbeat_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(hb))
        tmp.rename(self.heartbeat_file)
        return hb

    def record_daily_status(
        self,
        platforms_ran: list[str],
        swipe_sessions: int = 0,
        conversations_handled: int = 0,
        ai_replies_generated: int = 0,
        crashes: int = 0,
        uptime_hours: float = 0.0,
    ) -> dict:
        """Record end-of-day status for the dogfooding log."""
        entry = {
            "date": date.today().isoformat(),
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "platforms_ran": platforms_ran,
            "swipe_sessions": swipe_sessions,
            "conversations_handled": conversations_handled,
            "ai_replies_generated": ai_replies_generated,
            "crashes": crashes,
            "uptime_hours": round(uptime_hours, 2),
            "passed": crashes == 0 and len(platforms_ran) > 0,
        }
        with self.daily_log.open("a") as f:
            f.write(json.dumps(entry) + "\n")
        return entry

    def record_crash(
        self,
        platform: str,
        error_type: str,
        error_message: str,
        traceback_snippet: Optional[str] = None,
    ) -> dict:
        """Record a crash event."""
        entry = {
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "date": date.today().isoformat(),
            "platform": platform,
            "error_type": error_type,
            "error_message": error_message,
            "traceback": traceback_snippet[:500] if traceback_snippet else None,
        }
        with self.crash_log.open("a") as f:
            f.write(json.dumps(entry) + "\n")
        return entry

    def get_consecutive_days(self) -> int:
        """Count consecutive days the agent ran without crashes, ending at today.

        This is the primary dogfooding success criterion:
        'Agent runs 7 consecutive days without crash'.
        """
        daily_entries = self._load_daily_log()
        if not daily_entries:
            return 0

        # Build a set of dates that passed
        passed_dates: set[str] = set()
        for entry in daily_entries:
            if entry.get("passed"):
                passed_dates.add(entry["date"])

        # Count backwards from today
        streak = 0
        check_date = date.today()
        while check_date.isoformat() in passed_dates:
            streak += 1
            check_date -= timedelta(days=1)

        return streak

    def get_weekly_summary(self) -> dict:
        """Generate a summary of the last 7 days for reporting."""
        daily_entries = self._load_daily_log()
        crashes = self._load_crash_log()

        week_start = date.today() - timedelta(days=6)
        week_str = week_start.isoformat()

        week_entries = [e for e in daily_entries if e["date"] >= week_str]
        week_crashes = [c for c in crashes if c["date"] >= week_str]

        total_swipe_sessions = sum(e.get("swipe_sessions", 0) for e in week_entries)
        total_conversations = sum(e.get("conversations_handled", 0) for e in week_entries)
        total_ai_replies = sum(e.get("ai_replies_generated", 0) for e in week_entries)
        total_uptime = sum(e.get("uptime_hours", 0) for e in week_entries)
        days_active = len(set(e["date"] for e in week_entries))
        days_passed = len(set(e["date"] for e in week_entries if e.get("passed")))

        platforms_used: set[str] = set()
        for e in week_entries:
            platforms_used.update(e.get("platforms_ran", []))

        return {
            "week_start": week_str,
            "week_end": date.today().isoformat(),
            "days_active": days_active,
            "days_passed": days_passed,
            "consecutive_streak": self.get_consecutive_days(),
            "total_swipe_sessions": total_swipe_sessions,
            "total_conversations": total_conversations,
            "total_ai_replies": total_ai_replies,
            "total_uptime_hours": round(total_uptime, 1),
            "total_crashes": len(week_crashes),
            "platforms_used": sorted(platforms_used),
            "crash_details": week_crashes[-5:],  # last 5 crashes
            "success_criteria": {
                "7_day_streak": self.get_consecutive_days() >= 7,
                "at_least_1_ai_conversation": total_ai_replies > 0,
            },
        }

    def is_agent_alive(self, max_age_seconds: int = 120) -> bool:
        """Check if the agent has sent a heartbeat recently."""
        if not self.heartbeat_file.exists():
            return False
        try:
            hb = json.loads(self.heartbeat_file.read_text())
            return (int(time.time()) - hb.get("epoch", 0)) < max_age_seconds
        except Exception:
            return False

    def get_last_heartbeat(self) -> Optional[dict]:
        """Return the last heartbeat data, or None."""
        if not self.heartbeat_file.exists():
            return None
        try:
            return json.loads(self.heartbeat_file.read_text())
        except Exception:
            return None

    def _load_daily_log(self) -> list[dict]:
        if not self.daily_log.exists():
            return []
        entries = []
        for line in self.daily_log.read_text().strip().split("\n"):
            if line.strip():
                entries.append(json.loads(line))
        return sorted(entries, key=lambda e: e["date"])

    def _load_crash_log(self) -> list[dict]:
        if not self.crash_log.exists():
            return []
        entries = []
        for line in self.crash_log.read_text().strip().split("\n"):
            if line.strip():
                entries.append(json.loads(line))
        return sorted(entries, key=lambda e: e["timestamp"])

    def sync_to_supabase(self) -> int:
        """Push health data to Supabase for the dashboard."""
        from clapcheeks.sync import _load_supabase_env

        try:
            from supabase import create_client
        except ImportError:
            return 0

        url, key = _load_supabase_env()
        if not url or not key:
            return 0

        user_id = os.environ.get("CLAPCHEEKS_USER_ID")
        if not user_id:
            from clapcheeks.sync import _get_user_id_from_token
            user_id = _get_user_id_from_token()
        if not user_id:
            return 0

        summary = self.get_weekly_summary()
        summary["user_id"] = user_id

        client = create_client(url, key)
        try:
            client.table("clapcheeks_dogfood_health").upsert(
                [{
                    "user_id": user_id,
                    "date": date.today().isoformat(),
                    "consecutive_streak": summary["consecutive_streak"],
                    "days_active": summary["days_active"],
                    "total_crashes": summary["total_crashes"],
                    "weekly_summary": summary,
                }],
                on_conflict="user_id,date",
            ).execute()
            return 1
        except Exception as exc:
            log.warning("Failed to sync health data: %s", exc)
            return 0
