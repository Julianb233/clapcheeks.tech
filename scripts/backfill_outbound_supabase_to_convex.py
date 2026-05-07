#!/usr/bin/env python3
"""AI-9535 — Idempotent backfill: copy Supabase outbound queue tables into Convex.

Tables migrated:
  clapcheeks_scheduled_messages   -> outbound_scheduled_messages
  clapcheeks_followup_sequences   -> followup_sequences
  clapcheeks_queued_replies       -> queued_replies
  clapcheeks_posting_queue        -> posting_queue
  clapcheeks_approval_queue       -> approval_queue

Idempotent: each row is keyed by Supabase UUID stored as `legacy_id` in Convex.
Re-running skips rows already mirrored.

Usage:
  CONVEX_URL=...
  CONVEX_DEPLOY_KEY=...
  SUPABASE_URL=...
  SUPABASE_SERVICE_KEY=...
  python3 scripts/backfill_outbound_supabase_to_convex.py [--dry-run] [--only=<table>]

Where <table> is one of: scheduled_messages, followup_sequences, queued_replies,
posting_queue, approval_queue.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import logging
import os
import sys
from typing import Any, Iterable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill_outbound")


def _to_unix_ms(value: Any) -> int | None:
    """Convert Supabase timestamptz / ISO-8601 string / int to unix ms.

    Returns None if value is empty / unparseable.
    """
    if value in (None, "", 0):
        return None
    if isinstance(value, (int, float)):
        # Heuristic: > 1e12 means already ms, otherwise seconds.
        return int(value) if value > 1e12 else int(value * 1000)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        # Supabase returns "2026-04-23T00:00:00+00:00" / "2026-04-23 00:00:00.123+00".
        # python's fromisoformat handles "+00:00" but not "Z".
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = _dt.datetime.fromisoformat(s)
        except ValueError:
            try:
                dt = _dt.datetime.strptime(s.split("+")[0].strip(),
                                          "%Y-%m-%d %H:%M:%S")
                dt = dt.replace(tzinfo=_dt.timezone.utc)
            except ValueError:
                return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_dt.timezone.utc)
        return int(dt.timestamp() * 1000)
    return None


def _normalize_status(value: Any, allowed: Iterable[str], default: str) -> str:
    s = (value or "").strip().lower()
    return s if s in allowed else default


# -------------- per-table backfill --------------


def _backfill_scheduled_messages(sb, cx, dry_run: bool) -> dict[str, int]:
    counts = {"inserted": 0, "skipped": 0, "errors": 0, "scanned": 0}
    page = 0
    page_size = 500
    while True:
        resp = (sb.table("clapcheeks_scheduled_messages")
                  .select("*")
                  .range(page * page_size, (page + 1) * page_size - 1)
                  .execute())
        rows = resp.data or []
        if not rows:
            break
        for row in rows:
            counts["scanned"] += 1
            try:
                args = {
                    "legacy_id": str(row["id"]),
                    "user_id": str(row["user_id"]),
                    "match_id": row.get("match_id"),
                    "match_name": row.get("match_name") or "",
                    "platform": row.get("platform") or "iMessage",
                    "phone": row.get("phone"),
                    "message_text": row.get("message_text") or "",
                    "scheduled_at": _to_unix_ms(row.get("scheduled_at")) or 0,
                    "status": _normalize_status(
                        row.get("status"),
                        ("pending", "approved", "rejected", "sent", "failed"),
                        "pending",
                    ),
                    "sequence_type": _normalize_status(
                        row.get("sequence_type"),
                        ("follow_up", "manual", "app_to_text"),
                        "manual",
                    ),
                    "sequence_step": int(row.get("sequence_step") or 0),
                    "delay_hours": row.get("delay_hours"),
                    "rejection_reason": row.get("rejection_reason"),
                    "sent_at": _to_unix_ms(row.get("sent_at")),
                    "god_draft_id": row.get("god_draft_id"),
                    "created_at": _to_unix_ms(row.get("created_at")) or 0,
                    "updated_at": _to_unix_ms(row.get("updated_at")) or 0,
                }
                # Strip None values that mutation expects v.optional for.
                args = {k: v for k, v in args.items() if v is not None}
                if dry_run:
                    counts["inserted"] += 1
                    continue
                result = cx.mutation("outbound:backfillScheduledMessage", args)
                if isinstance(result, dict) and result.get("skipped"):
                    counts["skipped"] += 1
                else:
                    counts["inserted"] += 1
            except Exception as exc:
                log.error("scheduled_messages row %s failed: %s", row.get("id"), exc)
                counts["errors"] += 1
        if len(rows) < page_size:
            break
        page += 1
    return counts


def _backfill_followup_sequences(sb, cx, dry_run: bool) -> dict[str, int]:
    counts = {"inserted": 0, "skipped": 0, "errors": 0, "scanned": 0}
    resp = sb.table("clapcheeks_followup_sequences").select("*").execute()
    for row in resp.data or []:
        counts["scanned"] += 1
        try:
            args = {
                "legacy_id": str(row["id"]),
                "user_id": str(row["user_id"]),
                "enabled": bool(row.get("enabled", True)),
                "delays_hours": list(row.get("delays_hours") or [24, 72, 168]),
                "max_followups": int(row.get("max_followups") or 3),
                "app_to_text_enabled": bool(row.get("app_to_text_enabled", True)),
                "warmth_threshold": float(row.get("warmth_threshold") or 0.7),
                "min_messages_before_transition": int(row.get("min_messages_before_transition") or 12),
                "optimal_send_start_hour": int(row.get("optimal_send_start_hour") or 18),
                "optimal_send_end_hour": int(row.get("optimal_send_end_hour") or 21),
                "quiet_hours_start": int(row.get("quiet_hours_start") or 23),
                "quiet_hours_end": int(row.get("quiet_hours_end") or 8),
                "timezone": row.get("timezone") or "America/Los_Angeles",
                "created_at": _to_unix_ms(row.get("created_at")) or 0,
                "updated_at": _to_unix_ms(row.get("updated_at")) or 0,
            }
            if dry_run:
                counts["inserted"] += 1
                continue
            result = cx.mutation("drips:backfillFollowupSequence", args)
            if isinstance(result, dict) and result.get("skipped"):
                counts["skipped"] += 1
            else:
                counts["inserted"] += 1
        except Exception as exc:
            log.error("followup_sequences row %s failed: %s", row.get("id"), exc)
            counts["errors"] += 1
    return counts


def _backfill_queued_replies(sb, cx, dry_run: bool) -> dict[str, int]:
    counts = {"inserted": 0, "skipped": 0, "errors": 0, "scanned": 0}
    page = 0
    page_size = 500
    while True:
        resp = (sb.table("clapcheeks_queued_replies")
                  .select("*")
                  .range(page * page_size, (page + 1) * page_size - 1)
                  .execute())
        rows = resp.data or []
        if not rows:
            break
        for row in rows:
            counts["scanned"] += 1
            try:
                args = {
                    "legacy_id": str(row["id"]),
                    "user_id": str(row["user_id"]),
                    "match_name": row.get("match_name"),
                    "platform": row.get("platform"),
                    "text": row.get("text"),
                    "body": row.get("body"),
                    "recipient_handle": row.get("recipient_handle"),
                    "source": row.get("source"),
                    "status": _normalize_status(
                        row.get("status"),
                        ("queued", "sent", "failed"),
                        "queued",
                    ),
                    "created_at": _to_unix_ms(row.get("created_at")) or 0,
                }
                args = {k: v for k, v in args.items() if v is not None}
                if dry_run:
                    counts["inserted"] += 1
                    continue
                result = cx.mutation("queues:backfillQueuedReply", args)
                if isinstance(result, dict) and result.get("skipped"):
                    counts["skipped"] += 1
                else:
                    counts["inserted"] += 1
            except Exception as exc:
                log.error("queued_replies row %s failed: %s", row.get("id"), exc)
                counts["errors"] += 1
        if len(rows) < page_size:
            break
        page += 1
    return counts


def _backfill_posting_queue(sb, cx, dry_run: bool) -> dict[str, int]:
    counts = {"inserted": 0, "skipped": 0, "errors": 0, "scanned": 0}
    page = 0
    page_size = 500
    while True:
        resp = (sb.table("clapcheeks_posting_queue")
                  .select("*")
                  .range(page * page_size, (page + 1) * page_size - 1)
                  .execute())
        rows = resp.data or []
        if not rows:
            break
        for row in rows:
            counts["scanned"] += 1
            try:
                args = {
                    "legacy_id": str(row["id"]),
                    "user_id": str(row["user_id"]),
                    "content_library_id": str(row["content_library_id"]),
                    "scheduled_for": _to_unix_ms(row.get("scheduled_for")) or 0,
                    "status": _normalize_status(
                        row.get("status"),
                        ("pending", "in_progress", "posted", "failed", "cancelled"),
                        "pending",
                    ),
                    "agent_job_id": str(row["agent_job_id"]) if row.get("agent_job_id") else None,
                    "posted_at": _to_unix_ms(row.get("posted_at")),
                    "error": row.get("error"),
                    "created_at": _to_unix_ms(row.get("created_at")) or 0,
                }
                args = {k: v for k, v in args.items() if v is not None}
                if dry_run:
                    counts["inserted"] += 1
                    continue
                result = cx.mutation("queues:backfillPostingQueue", args)
                if isinstance(result, dict) and result.get("skipped"):
                    counts["skipped"] += 1
                else:
                    counts["inserted"] += 1
            except Exception as exc:
                log.error("posting_queue row %s failed: %s", row.get("id"), exc)
                counts["errors"] += 1
        if len(rows) < page_size:
            break
        page += 1
    return counts


def _backfill_approval_queue(sb, cx, dry_run: bool) -> dict[str, int]:
    counts = {"inserted": 0, "skipped": 0, "errors": 0, "scanned": 0}
    page = 0
    page_size = 500
    while True:
        resp = (sb.table("clapcheeks_approval_queue")
                  .select("*")
                  .range(page * page_size, (page + 1) * page_size - 1)
                  .execute())
        rows = resp.data or []
        if not rows:
            break
        for row in rows:
            counts["scanned"] += 1
            try:
                args = {
                    "legacy_id": str(row["id"]),
                    "user_id": str(row["user_id"]),
                    "action_type": row.get("action_type") or "",
                    "match_id": row.get("match_id"),
                    "match_name": row.get("match_name"),
                    "platform": row.get("platform"),
                    "proposed_text": row.get("proposed_text"),
                    "proposed_data": row.get("proposed_data") or {},
                    "confidence": float(row.get("confidence") or 0.0),
                    "ai_reasoning": row.get("ai_reasoning"),
                    "status": _normalize_status(
                        row.get("status"),
                        ("pending", "approved", "rejected", "expired"),
                        "pending",
                    ),
                    "expires_at": _to_unix_ms(row.get("expires_at")) or 0,
                    "decided_at": _to_unix_ms(row.get("decided_at")),
                    "created_at": _to_unix_ms(row.get("created_at")) or 0,
                }
                args = {k: v for k, v in args.items() if v is not None}
                if dry_run:
                    counts["inserted"] += 1
                    continue
                result = cx.mutation("queues:backfillApproval", args)
                if isinstance(result, dict) and result.get("skipped"):
                    counts["skipped"] += 1
                else:
                    counts["inserted"] += 1
            except Exception as exc:
                log.error("approval_queue row %s failed: %s", row.get("id"), exc)
                counts["errors"] += 1
        if len(rows) < page_size:
            break
        page += 1
    return counts


TABLES: dict[str, Any] = {
    "scheduled_messages": _backfill_scheduled_messages,
    "followup_sequences": _backfill_followup_sequences,
    "queued_replies":     _backfill_queued_replies,
    "posting_queue":      _backfill_posting_queue,
    "approval_queue":     _backfill_approval_queue,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="show what would migrate without writing to Convex")
    parser.add_argument("--only", default=None,
                        help=f"backfill just one table: {','.join(TABLES)}")
    args = parser.parse_args()

    sb_url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not sb_url or not sb_key:
        log.error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
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
        except AttributeError:
            cx.set_auth(deploy_key)

    targets = TABLES if args.only is None else {args.only: TABLES[args.only]}
    if args.only and args.only not in TABLES:
        log.error("--only must be one of: %s", ",".join(TABLES))
        return 1

    grand = {"inserted": 0, "skipped": 0, "errors": 0, "scanned": 0}
    for name, fn in targets.items():
        log.info("=== %s ===", name)
        try:
            counts = fn(sb, cx, args.dry_run)
        except Exception as exc:
            log.error("%s failed: %s", name, exc)
            counts = {"inserted": 0, "skipped": 0, "errors": 1, "scanned": 0}
        log.info("%s: %s", name, counts)
        for k, v in counts.items():
            grand[k] += v

    log.info("TOTAL: %s", grand)
    return 0 if grand["errors"] == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
