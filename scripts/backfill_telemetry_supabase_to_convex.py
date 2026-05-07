#!/usr/bin/env python3
"""AI-9536 — Idempotent backfill: copy 6 Supabase telemetry/report tables
into Convex.

Source -> Target:
  clapcheeks_analytics_daily   -> analytics_daily   (telemetry:backfillAnalyticsDailyFromScript)
  clapcheeks_weekly_reports    -> weekly_reports    (reports:backfillWeeklyReportFromScript)
  clapcheeks_agent_events      -> agent_events      (telemetry:backfillAgentEventsBatchFromScript, batches of 1000)
  clapcheeks_usage_daily       -> usage_daily       (telemetry:backfillUsageDailyFromScript)
  clapcheeks_friction_points   -> friction_points   (telemetry:backfillFrictionPointFromScript)
  clapcheeks_device_heartbeats -> device_heartbeats (telemetry:backfillDeviceHeartbeatFromScript)

WARNING: clapcheeks_agent_events can be hundreds of thousands of rows.
We page Supabase 1000 rows at a time and submit each batch to Convex in one
mutation call. Idempotent on (user_id, ts, event_type).

Usage:
  CONVEX_URL=https://...  \\
  CONVEX_RUNNER_SHARED_SECRET=...  \\
  SUPABASE_URL=https://... SUPABASE_SERVICE_KEY=...  \\
  python3 scripts/backfill_telemetry_supabase_to_convex.py [options]

Options:
  --dry-run                show counts, skip writes
  --tables=t1,t2,...       only run these tables. Choices: analytics_daily,
                           weekly_reports, agent_events, usage_daily,
                           friction_points, device_heartbeats
  --batch-size=N           rows per Convex mutation for agent_events (default 1000)
  --since=YYYY-MM-DD       only copy rows with created_at >= since (events
                           and friction); default no filter
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
import time
from typing import Any

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
log = logging.getLogger("backfill_telemetry")

# ---------------------------------------------------------------------------
# Supabase pagination
# ---------------------------------------------------------------------------


def _supabase_paged(sb, table: str, *, columns: str, since: str | None,
                    page_size: int = 1000, order_col: str = "created_at"):
    """Yield Supabase rows in pages."""
    offset = 0
    while True:
        q = sb.table(table).select(columns).order(order_col).range(
            offset, offset + page_size - 1
        )
        if since:
            q = q.gte(order_col, since)
        try:
            rows = (q.execute().data or [])
        except Exception as e:
            log.error("supabase fetch failed for %s offset=%d: %s",
                      table, offset, e)
            break
        if not rows:
            return
        for r in rows:
            yield r
        if len(rows) < page_size:
            return
        offset += page_size


def _iso_to_ms(value: Any) -> int | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        # already a ms-or-s number
        return int(value if value > 1e12 else value * 1000)
    s = str(value)
    try:
        # supabase returns "2026-04-15T...", with or without Z / offset
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        d = dt.datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return int(d.timestamp() * 1000)
    except Exception:
        return None


def _date_to_iso(value: Any) -> str | None:
    if value in (None, ""):
        return None
    s = str(value)
    if "T" in s:
        return s.split("T")[0]
    return s[:10]


def _midnight_ms(date_iso: str) -> int:
    return int(
        dt.datetime.fromisoformat(date_iso + "T00:00:00+00:00").timestamp() * 1000
    )


# ---------------------------------------------------------------------------
# Per-table backfills
# ---------------------------------------------------------------------------


def backfill_analytics_daily(sb, cx, secret, dry_run):
    log.info("[analytics_daily] streaming from Supabase ...")
    sent = skipped = errors = 0
    for r in _supabase_paged(
        sb, "clapcheeks_analytics_daily",
        columns=(
            "user_id,date,app,swipes_right,swipes_left,matches,"
            "conversations_started,dates_booked,money_spent,created_at"
        ),
        since=None,
        order_col="created_at",
    ):
        sent += 1
        if dry_run:
            continue
        try:
            res = cx.mutation("telemetry:backfillAnalyticsDailyFromScript", {
                "deploy_key_check": secret,
                "user_id": str(r["user_id"]),
                "day_iso": _date_to_iso(r["date"]),
                "app": r["app"],
                "swipes_right": int(r.get("swipes_right") or 0),
                "swipes_left": int(r.get("swipes_left") or 0),
                "matches": int(r.get("matches") or 0),
                "conversations_started": int(r.get("conversations_started") or 0),
                "dates_booked": int(r.get("dates_booked") or 0),
                "money_spent": float(r.get("money_spent") or 0),
                "created_at": _iso_to_ms(r["created_at"]) or int(time.time() * 1000),
            })
            if isinstance(res, dict) and res.get("action") == "skipped":
                skipped += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                log.warning("analytics_daily error: %s", e)
    log.info("[analytics_daily] sent=%d skipped=%d errors=%d",
             sent, skipped, errors)
    return sent, errors


def backfill_weekly_reports(sb, cx, secret, dry_run):
    log.info("[weekly_reports] streaming from Supabase ...")
    sent = skipped = errors = 0
    for r in _supabase_paged(
        sb, "clapcheeks_weekly_reports",
        columns=(
            "user_id,week_start,week_end,metrics_snapshot,pdf_url,sent_at,"
            "report_type,created_at"
        ),
        since=None,
        order_col="created_at",
    ):
        sent += 1
        if dry_run:
            continue
        try:
            week_start_iso = _date_to_iso(r["week_start"])
            week_end_iso = _date_to_iso(r["week_end"])
            res = cx.mutation("reports:backfillWeeklyReportFromScript", {
                "deploy_key_check": secret,
                "user_id": str(r["user_id"]),
                "week_start_ms": _midnight_ms(week_start_iso),
                "week_end_ms": _midnight_ms(week_end_iso),
                "week_start_iso": week_start_iso,
                "metrics_snapshot": r.get("metrics_snapshot") or {},
                "pdf_url": r.get("pdf_url"),
                "sent_at": _iso_to_ms(r.get("sent_at")),
                "report_type": r.get("report_type") or "standard",
                "created_at": _iso_to_ms(r["created_at"]) or int(time.time() * 1000),
            })
            if isinstance(res, dict) and res.get("action") == "skipped":
                skipped += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                log.warning("weekly_reports error: %s", e)
    log.info("[weekly_reports] sent=%d skipped=%d errors=%d",
             sent, skipped, errors)
    return sent, errors


def backfill_agent_events(sb, cx, secret, dry_run, batch_size, since):
    log.info("[agent_events] streaming from Supabase (batch=%d) ...",
             batch_size)
    sent = skipped_total = errors = inserted_total = 0
    batch: list[dict] = []

    def flush():
        nonlocal batch, inserted_total, skipped_total, errors
        if not batch:
            return
        if dry_run:
            batch = []
            return
        try:
            res = cx.mutation(
                "telemetry:backfillAgentEventsBatchFromScript",
                {"deploy_key_check": secret, "rows": batch},
            )
            if isinstance(res, dict):
                inserted_total += int(res.get("inserted") or 0)
                skipped_total += int(res.get("skipped") or 0)
        except Exception as e:
            errors += 1
            if errors <= 5:
                log.warning("agent_events batch flush failed (size=%d): %s",
                            len(batch), e)
        batch = []

    for r in _supabase_paged(
        sb, "clapcheeks_agent_events",
        columns="user_id,event_type,data,occurred_at,created_at",
        since=since,
        order_col="created_at",
        page_size=1000,
    ):
        sent += 1
        ts = _iso_to_ms(r.get("created_at")) or _iso_to_ms(r.get("occurred_at"))
        if ts is None:
            continue
        platform = None
        data = r.get("data")
        if isinstance(data, dict):
            platform = data.get("platform")
        batch.append({
            "user_id": str(r["user_id"]),
            "event_type": r.get("event_type") or "unknown",
            "platform": platform,
            "data": data or None,
            "occurred_at": _iso_to_ms(r.get("occurred_at")),
            "ts": ts,
        })
        if len(batch) >= batch_size:
            flush()
    flush()
    log.info(
        "[agent_events] sent=%d inserted=%d skipped=%d errors=%d",
        sent, inserted_total, skipped_total, errors,
    )
    return sent, errors


def backfill_usage_daily(sb, cx, secret, dry_run):
    log.info("[usage_daily] streaming from Supabase ...")
    sent = skipped = errors = 0
    for r in _supabase_paged(
        sb, "clapcheeks_usage_daily",
        columns="user_id,date,swipes_used,coaching_calls_used,ai_replies_used",
        since=None,
        order_col="date",
    ):
        sent += 1
        if dry_run:
            continue
        try:
            day_iso = _date_to_iso(r["date"])
            res = cx.mutation("telemetry:backfillUsageDailyFromScript", {
                "deploy_key_check": secret,
                "user_id": str(r["user_id"]),
                "day_iso": day_iso,
                "swipes_used": int(r.get("swipes_used") or 0),
                "coaching_calls_used": int(r.get("coaching_calls_used") or 0),
                "ai_replies_used": int(r.get("ai_replies_used") or 0),
                "created_at": _midnight_ms(day_iso),
            })
            if isinstance(res, dict) and res.get("action") == "skipped":
                skipped += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                log.warning("usage_daily error: %s", e)
    log.info("[usage_daily] sent=%d skipped=%d errors=%d",
             sent, skipped, errors)
    return sent, errors


def backfill_friction_points(sb, cx, secret, dry_run, since):
    log.info("[friction_points] streaming from Supabase ...")
    sent = errors = 0
    for r in _supabase_paged(
        sb, "clapcheeks_friction_points",
        columns=(
            "user_id,title,description,severity,category,platform,"
            "auto_detected,context,resolved,resolution,resolved_at,created_at"
        ),
        since=since,
        order_col="created_at",
    ):
        sent += 1
        if dry_run:
            continue
        try:
            cx.mutation("telemetry:backfillFrictionPointFromScript", {
                "deploy_key_check": secret,
                "user_id": str(r["user_id"]),
                "title": r["title"],
                "description": r.get("description"),
                "severity": r.get("severity") or "minor",
                "category": r.get("category") or "ux",
                "platform": r.get("platform"),
                "auto_detected": bool(r.get("auto_detected")),
                "context": r.get("context"),
                "resolved": bool(r.get("resolved")),
                "resolution": r.get("resolution"),
                "resolved_at": _iso_to_ms(r.get("resolved_at")),
                "created_at": _iso_to_ms(r["created_at"]) or int(time.time() * 1000),
            })
        except Exception as e:
            errors += 1
            if errors <= 5:
                log.warning("friction_points error: %s", e)
    log.info("[friction_points] sent=%d errors=%d", sent, errors)
    return sent, errors


def backfill_device_heartbeats(sb, cx, secret, dry_run):
    log.info("[device_heartbeats] streaming from Supabase ...")
    sent = skipped = errors = unmatched = 0

    log.info("  pre-fetching clapcheeks_agent_tokens to map token strings ...")
    token_by_id: dict[str, str] = {}
    for trow in _supabase_paged(
        sb, "clapcheeks_agent_tokens",
        columns="id,token",
        since=None,
        order_col="created_at",
    ):
        if trow.get("id") and trow.get("token"):
            token_by_id[str(trow["id"])] = trow["token"]
    log.info("  loaded %d Supabase agent tokens", len(token_by_id))

    convex_token_id_cache: dict[str, str] = {}

    for r in _supabase_paged(
        sb, "clapcheeks_device_heartbeats",
        columns=(
            "token_id,user_id,device_name,daemon_version,last_sync_at,"
            "errors_jsonb,last_heartbeat_at,created_at"
        ),
        since=None,
        order_col="created_at",
    ):
        sent += 1
        sb_token_id = str(r.get("token_id") or "")
        token_str = token_by_id.get(sb_token_id)
        if not token_str:
            unmatched += 1
            continue
        if dry_run:
            continue

        cx_id = convex_token_id_cache.get(token_str)
        if not cx_id:
            try:
                cx_id = cx.query("telemetry:findDeviceTokenIdForBackfill", {
                    "deploy_key_check": secret,
                    "token": token_str,
                })
            except Exception as e:
                errors += 1
                if errors <= 5:
                    log.warning("findDeviceTokenIdForBackfill failed: %s", e)
                continue
            if not cx_id:
                unmatched += 1
                continue
            convex_token_id_cache[token_str] = cx_id

        try:
            res = cx.mutation("telemetry:backfillDeviceHeartbeatFromScript", {
                "deploy_key_check": secret,
                "device_token_id": cx_id,
                "user_id": str(r.get("user_id") or ""),
                "device_id": r.get("device_name"),
                "daemon_version": r.get("daemon_version"),
                "last_sync_at": _iso_to_ms(r.get("last_sync_at")),
                "errors_jsonb": r.get("errors_jsonb"),
                "last_heartbeat_at":
                    _iso_to_ms(r.get("last_heartbeat_at"))
                    or int(time.time() * 1000),
                "created_at":
                    _iso_to_ms(r["created_at"]) or int(time.time() * 1000),
            })
            if isinstance(res, dict) and res.get("action") == "skipped":
                skipped += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                log.warning("device_heartbeats error: %s", e)
    log.info(
        "[device_heartbeats] sent=%d skipped=%d errors=%d unmatched=%d",
        sent, skipped, errors, unmatched,
    )
    return sent, errors


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--tables",
        default=(
            "analytics_daily,weekly_reports,agent_events,usage_daily,"
            "friction_points,device_heartbeats"
        ),
    )
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--since", default=None,
                        help="ISO date filter for created_at (events + friction only)")
    args = parser.parse_args()

    sb_url = os.environ.get("SUPABASE_URL") or os.environ.get(
        "NEXT_PUBLIC_SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY")
    if not sb_url or not sb_key:
        log.error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
        return 1

    cx_secret = os.environ.get("CONVEX_RUNNER_SHARED_SECRET", "").strip()
    if not cx_secret:
        log.error("CONVEX_RUNNER_SHARED_SECRET not set")
        return 1

    cx_url = os.environ.get("CONVEX_URL", "").strip()
    if not cx_url:
        log.error("CONVEX_URL not set")
        return 1

    try:
        from supabase import create_client
    except ImportError:
        log.error("pip install supabase")
        return 1
    try:
        from convex import ConvexClient  # type: ignore
    except ImportError:
        log.error("pip install convex")
        return 1

    sb = create_client(sb_url, sb_key)
    cx = ConvexClient(cx_url)
    deploy_key = os.environ.get("CONVEX_DEPLOY_KEY", "").strip()
    if deploy_key:
        try:
            cx.set_admin_auth(deploy_key)
        except Exception:
            pass

    tables = {t.strip() for t in args.tables.split(",") if t.strip()}
    log.info("backfill plan: %s dry_run=%s", sorted(tables), args.dry_run)

    total_sent = total_errors = 0

    if "analytics_daily" in tables:
        s, e = backfill_analytics_daily(sb, cx, cx_secret, args.dry_run)
        total_sent += s
        total_errors += e
    if "weekly_reports" in tables:
        s, e = backfill_weekly_reports(sb, cx, cx_secret, args.dry_run)
        total_sent += s
        total_errors += e
    if "usage_daily" in tables:
        s, e = backfill_usage_daily(sb, cx, cx_secret, args.dry_run)
        total_sent += s
        total_errors += e
    if "friction_points" in tables:
        s, e = backfill_friction_points(
            sb, cx, cx_secret, args.dry_run, args.since,
        )
        total_sent += s
        total_errors += e
    if "device_heartbeats" in tables:
        s, e = backfill_device_heartbeats(sb, cx, cx_secret, args.dry_run)
        total_sent += s
        total_errors += e
    if "agent_events" in tables:
        s, e = backfill_agent_events(
            sb, cx, cx_secret, args.dry_run, args.batch_size, args.since,
        )
        total_sent += s
        total_errors += e

    log.info("DONE. sent=%d errors=%d", total_sent, total_errors)
    return 0 if total_errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
