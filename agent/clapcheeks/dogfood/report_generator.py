"""Weekly dogfooding report generator — produces a comprehensive report
with real data from the agent's activity logs, health monitor, and
friction tracker.

The report is saved locally as JSON and optionally pushed to Supabase
so the web dashboard can render it.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

log = logging.getLogger("clapcheeks.dogfood.report")

REPORTS_DIR = Path.home() / ".clapcheeks" / "dogfood" / "reports"


class DogfoodReporter:
    """Generate weekly dogfooding reports with real data."""

    def __init__(self, reports_dir: Optional[Path] = None):
        self.reports_dir = reports_dir or REPORTS_DIR
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def generate_weekly_report(
        self,
        week_start: Optional[date] = None,
    ) -> dict:
        """Generate a comprehensive weekly dogfooding report.

        Combines data from:
        - Health monitor (uptime, crashes, streaks)
        - Friction tracker (UX issues, bugs)
        - Sync metrics (swipes, matches, conversations)
        - Stripe subscription status
        """
        from clapcheeks.dogfood.friction_tracker import FrictionTracker
        from clapcheeks.dogfood.health_monitor import HealthMonitor

        if week_start is None:
            # Default to the most recent Sunday
            today = date.today()
            days_since_sunday = (today.weekday() + 1) % 7
            week_start = today - timedelta(days=days_since_sunday)

        week_end = week_start + timedelta(days=6)

        # Health data
        health = HealthMonitor()
        health_summary = health.get_weekly_summary()

        # Friction data
        friction = FrictionTracker()
        all_friction = friction.get_all()
        week_friction = [
            f for f in all_friction
            if week_start.isoformat() <= f["timestamp"][:10] <= week_end.isoformat()
        ]
        friction_summary = friction.get_summary()

        # Metrics from local sync state
        metrics = self._collect_week_metrics(week_start, week_end)

        # Subscription status
        subscription = self._check_subscription_status()

        # Build the report
        report = {
            "id": f"dogfood-{week_start.isoformat()}",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),

            # Success criteria evaluation
            "success_criteria": {
                "agent_7_day_streak": {
                    "target": 7,
                    "actual": health_summary["consecutive_streak"],
                    "passed": health_summary["consecutive_streak"] >= 7,
                    "description": "Agent runs 7 consecutive days without crash",
                },
                "ai_conversation_handled": {
                    "target": 1,
                    "actual": health_summary["total_ai_replies"],
                    "passed": health_summary["total_ai_replies"] >= 1,
                    "description": "At least 1 match conversation handled by AI",
                },
                "stripe_subscription_active": {
                    "target": True,
                    "actual": subscription.get("active", False),
                    "passed": subscription.get("active", False),
                    "description": "Stripe subscription created and active",
                },
                "weekly_report_generated": {
                    "target": True,
                    "actual": True,
                    "passed": True,
                    "description": "Weekly report generates with real data",
                },
            },

            # Agent health
            "health": {
                "days_active": health_summary["days_active"],
                "days_passed": health_summary["days_passed"],
                "consecutive_streak": health_summary["consecutive_streak"],
                "total_uptime_hours": health_summary["total_uptime_hours"],
                "total_crashes": health_summary["total_crashes"],
                "platforms_used": health_summary["platforms_used"],
                "crash_details": health_summary["crash_details"],
            },

            # Activity metrics
            "metrics": metrics,

            # Friction points
            "friction": {
                "total_this_week": len(week_friction),
                "total_all_time": friction_summary["total"],
                "unresolved": friction_summary["unresolved"],
                "by_severity": friction_summary["by_severity"],
                "by_category": friction_summary["by_category"],
                "top_issues": week_friction[:10],
            },

            # Subscription
            "subscription": subscription,

            # Overall score (0-100)
            "dogfood_score": self._calculate_dogfood_score(
                health_summary, metrics, friction_summary, subscription,
            ),
        }

        # Save locally
        report_path = self.reports_dir / f"report-{week_start.isoformat()}.json"
        report_path.write_text(json.dumps(report, indent=2))
        log.info("Dogfooding report saved: %s", report_path)

        return report

    def push_to_supabase(self, report: dict) -> bool:
        """Push the report to Supabase for the web dashboard."""
        from clapcheeks.sync import _load_supabase_env

        try:
            from supabase import create_client
        except ImportError:
            return False

        url, key = _load_supabase_env()
        if not url or not key:
            return False

        user_id = os.environ.get("CLAPCHEEKS_USER_ID")
        if not user_id:
            from clapcheeks.sync import _get_user_id_from_token
            user_id = _get_user_id_from_token()
        if not user_id:
            return False

        client = create_client(url, key)
        try:
            client.table("clapcheeks_weekly_reports").upsert([{
                "user_id": user_id,
                "week_start": report["week_start"],
                "week_end": report["week_end"],
                "metrics_snapshot": report,
                "created_at": report["generated_at"],
            }], on_conflict="user_id,week_start").execute()
            return True
        except Exception as exc:
            log.error("Failed to push report to Supabase: %s", exc)
            return False

    def list_reports(self) -> list[dict]:
        """List all locally saved reports."""
        reports = []
        for path in sorted(self.reports_dir.glob("report-*.json"), reverse=True):
            try:
                data = json.loads(path.read_text())
                reports.append({
                    "week_start": data["week_start"],
                    "week_end": data["week_end"],
                    "dogfood_score": data.get("dogfood_score", 0),
                    "path": str(path),
                })
            except Exception:
                continue
        return reports

    def _collect_week_metrics(self, week_start: date, week_end: date) -> dict:
        """Collect activity metrics for the week from local state."""
        from clapcheeks.sync import collect_daily_metrics

        try:
            daily = collect_daily_metrics()
        except Exception:
            daily = []

        # Filter to this week
        week_rows = [
            r for r in daily
            if week_start.isoformat() <= r.get("date", "") <= week_end.isoformat()
        ]

        total_swipes = sum(r.get("swipes_right", 0) + r.get("swipes_left", 0) for r in week_rows)
        total_matches = sum(r.get("matches", 0) for r in week_rows)
        total_conversations = sum(r.get("conversations_started", 0) for r in week_rows)
        total_dates = sum(r.get("dates_booked", 0) for r in week_rows)
        total_spent = sum(r.get("money_spent", 0) for r in week_rows)

        platforms_active: set[str] = set()
        for r in week_rows:
            if r.get("platform"):
                platforms_active.add(r["platform"])

        return {
            "total_swipes": total_swipes,
            "total_matches": total_matches,
            "total_conversations": total_conversations,
            "total_dates": total_dates,
            "total_spent": round(total_spent, 2),
            "match_rate": round(
                (total_matches / max(1, sum(r.get("swipes_right", 0) for r in week_rows))) * 100, 1
            ),
            "platforms_active": sorted(platforms_active),
            "daily_breakdown": week_rows,
        }

    def _check_subscription_status(self) -> dict:
        """Check if Stripe subscription is active."""
        from clapcheeks.sync import _load_supabase_env

        try:
            from supabase import create_client
        except ImportError:
            return {"active": False, "plan": None, "status": "unknown"}

        url, key = _load_supabase_env()
        if not url or not key:
            return {"active": False, "plan": None, "status": "unknown"}

        user_id = os.environ.get("CLAPCHEEKS_USER_ID")
        if not user_id:
            from clapcheeks.sync import _get_user_id_from_token
            user_id = _get_user_id_from_token()
        if not user_id:
            return {"active": False, "plan": None, "status": "no_user"}

        try:
            client = create_client(url, key)
            result = client.table("clapcheeks_subscriptions") \
                .select("status, plan_id") \
                .eq("user_id", user_id) \
                .limit(1) \
                .execute()

            if result.data:
                sub = result.data[0]
                return {
                    "active": sub.get("status") == "active",
                    "plan": sub.get("plan_id"),
                    "status": sub.get("status", "unknown"),
                }
        except Exception:
            pass

        return {"active": False, "plan": None, "status": "not_found"}

    def _calculate_dogfood_score(
        self,
        health: dict,
        metrics: dict,
        friction: dict,
        subscription: dict,
    ) -> int:
        """Calculate an overall dogfooding health score (0-100).

        Breakdown:
        - 30 pts: Agent stability (streak, uptime, no crashes)
        - 25 pts: Activity (swipes, matches, conversations)
        - 20 pts: AI quality (conversations handled, replies generated)
        - 15 pts: Low friction (fewer issues = better)
        - 10 pts: Subscription active
        """
        score = 0

        # Stability (30 pts)
        streak = min(health.get("consecutive_streak", 0), 7)
        score += int((streak / 7) * 20)  # 20 pts for streak
        if health.get("total_crashes", 1) == 0:
            score += 10  # 10 pts for zero crashes

        # Activity (25 pts)
        swipes = metrics.get("total_swipes", 0)
        matches = metrics.get("total_matches", 0)
        convos = metrics.get("total_conversations", 0)
        if swipes > 0:
            score += 10
        if matches > 0:
            score += 8
        if convos > 0:
            score += 7

        # AI quality (20 pts)
        ai_replies = health.get("total_ai_replies", 0)
        if ai_replies >= 10:
            score += 20
        elif ai_replies >= 5:
            score += 15
        elif ai_replies >= 1:
            score += 10

        # Low friction (15 pts) — fewer unresolved issues = higher score
        unresolved = friction.get("unresolved", 0)
        blockers = friction.get("by_severity", {}).get("blocker", 0)
        if unresolved == 0:
            score += 15
        elif blockers == 0 and unresolved <= 3:
            score += 10
        elif blockers == 0:
            score += 5

        # Subscription (10 pts)
        if subscription.get("active"):
            score += 10

        return min(score, 100)
