"""Friction point tracker — logs UX issues, bugs, and pain points during dogfooding.

Every friction event is written to a local JSONL file and synced to Supabase
so the dashboard can visualize them. Events are immutable once written.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional


class FrictionSeverity(str, Enum):
    """How painful the friction point is."""
    BLOCKER = "blocker"      # Can't proceed at all
    MAJOR = "major"          # Significant pain, workaround needed
    MINOR = "minor"          # Annoying but workable
    COSMETIC = "cosmetic"    # Polish issue, not functional


class FrictionCategory(str, Enum):
    """What area of the product is affected."""
    SWIPING = "swiping"
    CONVERSATION = "conversation"
    AGENT_SETUP = "agent_setup"
    AUTH = "auth"
    STRIPE = "stripe"
    DASHBOARD = "dashboard"
    REPORTS = "reports"
    PERFORMANCE = "performance"
    CRASH = "crash"
    UX = "ux"
    OTHER = "other"


FRICTION_LOG = Path.home() / ".clapcheeks" / "dogfood" / "friction.jsonl"


class FrictionTracker:
    """Track friction points during dogfooding sessions."""

    def __init__(self, log_path: Optional[Path] = None):
        self.log_path = log_path or FRICTION_LOG
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(
        self,
        title: str,
        description: str,
        severity: FrictionSeverity = FrictionSeverity.MINOR,
        category: FrictionCategory = FrictionCategory.OTHER,
        platform: Optional[str] = None,
        screenshot_path: Optional[str] = None,
        auto_detected: bool = False,
        context: Optional[dict] = None,
    ) -> dict:
        """Log a friction point. Returns the event dict."""
        event = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "title": title,
            "description": description,
            "severity": severity.value,
            "category": category.value,
            "platform": platform,
            "screenshot_path": screenshot_path,
            "auto_detected": auto_detected,
            "context": context or {},
            "resolved": False,
            "resolution": None,
        }

        with self.log_path.open("a") as f:
            f.write(json.dumps(event) + "\n")

        return event

    def resolve(self, event_id: str, resolution: str) -> bool:
        """Mark a friction event as resolved. Returns True if found and updated."""
        if not self.log_path.exists():
            return False

        lines = self.log_path.read_text().strip().split("\n")
        updated = False
        new_lines = []

        for line in lines:
            if not line.strip():
                continue
            event = json.loads(line)
            if event["id"] == event_id:
                event["resolved"] = True
                event["resolution"] = resolution
                event["resolved_at"] = datetime.now().isoformat(timespec="seconds")
                updated = True
            new_lines.append(json.dumps(event))

        if updated:
            self.log_path.write_text("\n".join(new_lines) + "\n")
        return updated

    def get_all(self, unresolved_only: bool = False) -> list[dict]:
        """Return all friction events, optionally filtered to unresolved only."""
        if not self.log_path.exists():
            return []

        events = []
        for line in self.log_path.read_text().strip().split("\n"):
            if not line.strip():
                continue
            event = json.loads(line)
            if unresolved_only and event.get("resolved"):
                continue
            events.append(event)

        return sorted(events, key=lambda e: e["timestamp"], reverse=True)

    def get_summary(self) -> dict:
        """Return a summary of friction points by severity and category."""
        events = self.get_all()
        total = len(events)
        unresolved = sum(1 for e in events if not e.get("resolved"))

        by_severity: dict[str, int] = {}
        by_category: dict[str, int] = {}

        for e in events:
            sev = e.get("severity", "minor")
            cat = e.get("category", "other")
            by_severity[sev] = by_severity.get(sev, 0) + 1
            by_category[cat] = by_category.get(cat, 0) + 1

        return {
            "total": total,
            "unresolved": unresolved,
            "resolved": total - unresolved,
            "by_severity": by_severity,
            "by_category": by_category,
        }

    def sync_to_supabase(self) -> int:
        """Push unsynced friction events to Supabase. Returns count synced."""
        from clapcheeks.sync import _load_supabase_env

        try:
            from supabase import create_client
        except ImportError:
            return 0

        url, key = _load_supabase_env()
        if not url or not key:
            return 0

        events = self.get_all()
        if not events:
            return 0

        user_id = os.environ.get("CLAPCHEEKS_USER_ID")
        if not user_id:
            from clapcheeks.sync import _get_user_id_from_token
            user_id = _get_user_id_from_token()
        if not user_id:
            return 0

        client = create_client(url, key)
        rows = []
        for e in events:
            rows.append({
                "id": e["id"],
                "user_id": user_id,
                "title": e["title"],
                "description": e["description"],
                "severity": e["severity"],
                "category": e["category"],
                "platform": e.get("platform"),
                "auto_detected": e.get("auto_detected", False),
                "context": e.get("context", {}),
                "resolved": e.get("resolved", False),
                "resolution": e.get("resolution"),
                "created_at": e["timestamp"],
            })

        try:
            result = client.table("clapcheeks_friction_points").upsert(rows).execute()
            return len(result.data) if result.data else 0
        except Exception:
            return 0
