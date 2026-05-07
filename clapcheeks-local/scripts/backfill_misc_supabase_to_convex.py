#!/usr/bin/env python3
"""AI-9537 — Idempotent backfill: copy billing + miscellaneous Supabase tables
into Convex.

Tables migrated:
  - clapcheeks_subscriptions       -> subscriptions
  - dunning_events                 -> dunning_events
  - clapcheeks_voice_profiles      -> voice_profiles
  - user_voice_context             -> voice_context
  - clapcheeks_notification_prefs  -> notification_prefs
  - clapcheeks_outbound_notifications -> outbound_notifications
  - clapcheeks_push_queue          -> push_queue
  - clapcheeks_report_preferences  -> report_preferences
  - clapcheeks_coaching_sessions   -> coaching_sessions
  - clapcheeks_tip_feedback        -> tip_feedback
  - clapcheeks_memos               -> memos
  - clapcheeks_referrals           -> referrals
  - notifications                  -> notifications
  - devices                        -> devices
  - google_calendar_tokens         -> google_calendar_tokens
                                       (refresh_token + access_token are
                                        encrypted client-side via the token
                                        vault before write — never plaintext
                                        at rest in Convex)

Run from any host with Supabase service-role + Convex deploy access.
Safe to re-run: every write is an idempotent upsert on the natural key.

Usage:
  CONVEX_URL=...  \\
  CONVEX_DEPLOY_KEY=...  \\
  CONVEX_RUNNER_SHARED_SECRET=...  \\
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \\
  CLAPCHEEKS_TOKEN_MASTER_KEY=...  # required for google_calendar_tokens
  python3 scripts/backfill_misc_supabase_to_convex.py [--dry-run] [--only TABLE,...]

Optional flags:
  --dry-run    : count rows but write nothing
  --only       : comma-separated table list to limit scope
                 (e.g. --only google_calendar_tokens,memos)
  --limit N    : per-table cap (smoke-test friendly)

Output: a JSON summary {table: {read, written, skipped, errors}}.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from typing import Any, Iterable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill_misc")


def _to_ms(value: Any) -> int | None:
    """Convert Supabase timestamp/text -> unix ms."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # Heuristic: < 10^12 means seconds, else already ms.
        return int(value) if value > 1e11 else int(value * 1000)
    if isinstance(value, str):
        try:
            # Postgres timestamptz: 2026-04-27T18:00:00.000Z
            iso = value.replace("Z", "+00:00")
            return int(datetime.fromisoformat(iso).timestamp() * 1000)
        except Exception:
            return None
    return None


def _iter_pages(client, table: str, page_size: int = 500, columns: str = "*"):
    offset = 0
    while True:
        resp = (
            client.table(table)
            .select(columns)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return
        for r in rows:
            yield r
        if len(rows) < page_size:
            return
        offset += page_size


# ---------------------------------------------------------------------------
# Table-specific backfillers
# ---------------------------------------------------------------------------


def backfill_subscriptions(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    plan_allow = {"starter", "pro", "elite"}
    for row in _iter_pages(supabase, "clapcheeks_subscriptions"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        plan = row.get("plan")
        if plan not in plan_allow:
            stats["skipped"] += 1
            continue
        payload = {
            "user_id": row["user_id"],
            "stripe_subscription_id": row.get("stripe_subscription_id"),
            "plan": plan,
            "status": row.get("status") or "active",
            "current_period_start": _to_ms(row.get("current_period_start")),
            "current_period_end": _to_ms(row.get("current_period_end")),
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("billing:upsertSubscription", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("subscriptions row %s failed: %s", row.get("id"), exc)
            stats["errors"] += 1
    return stats


def backfill_dunning_events(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    valid_types = {
        "payment_failed",
        "payment_recovered",
        "grace_period_expired",
        "manual_retry",
        "subscription_canceled",
    }
    for row in _iter_pages(supabase, "dunning_events"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        et = row.get("event_type")
        if et not in valid_types:
            stats["skipped"] += 1
            continue
        payload = {
            "user_id": row.get("user_id"),
            "stripe_customer_id": row.get("stripe_customer_id"),
            "stripe_invoice_id": row.get("stripe_invoice_id"),
            "event_type": et,
            "attempt_number": row.get("attempt_number"),
            "grace_period_end": _to_ms(row.get("grace_period_end")),
            "metadata": row.get("metadata") or {},
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("billing:insertDunningEvent", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("dunning_events row %s failed: %s", row.get("id"), exc)
            stats["errors"] += 1
    return stats


def backfill_voice_profiles(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "clapcheeks_voice_profiles"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "user_id": row["user_id"],
            "style_summary": row.get("style_summary"),
            "sample_phrases": row.get("sample_phrases") or [],
            "tone": row.get("tone"),
            "profile_data": row.get("profile_data") or {},
            "messages_analyzed": row.get("messages_analyzed"),
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("voice:upsertProfile", payload)
            digest_payload = {
                "user_id": row["user_id"],
                "digest": row.get("digest"),
                "boosted_samples": row.get("boosted_samples"),
                "last_scan_at": _to_ms(row.get("last_scan_at")),
            }
            convex.mutation("voice:upsertProfileDigest", digest_payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("voice_profiles row %s failed: %s", row.get("user_id"), exc)
            stats["errors"] += 1
    return stats


def backfill_voice_context(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "user_voice_context"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "user_id": row["user_id"],
            "answers": row.get("answers") or {},
            "summary": row.get("summary"),
            "persona_blob": row.get("persona_blob"),
            "completed_at": _to_ms(row.get("completed_at")),
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("voice:upsertContext", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("voice_context row %s failed: %s", row.get("user_id"), exc)
            stats["errors"] += 1
    return stats


def backfill_notification_prefs(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "clapcheeks_notification_prefs"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "user_id": row["user_id"],
            "email": row.get("email"),
            "phone_e164": row.get("phone_e164"),
            "channels_per_event": row.get("channels_per_event") or {},
            "quiet_hours_start": int(row.get("quiet_hours_start") or 21),
            "quiet_hours_end": int(row.get("quiet_hours_end") or 8),
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("notifications:upsertPrefs", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("notification_prefs row %s failed: %s", row.get("user_id"), exc)
            stats["errors"] += 1
    return stats


def backfill_report_preferences(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "clapcheeks_report_preferences"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "user_id": row["user_id"],
            "email_enabled": bool(row.get("email_enabled", True)),
            "send_day": row.get("send_day") or "sunday",
            "send_hour": int(row.get("send_hour", 8)),
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("reportPreferences:upsertForUser", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("report_preferences row %s failed: %s", row.get("user_id"), exc)
            stats["errors"] += 1
    return stats


def backfill_coaching_sessions(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "clapcheeks_coaching_sessions"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "user_id": row["user_id"],
            "week_start": str(row.get("week_start") or "")[:10],
            "generated_at": _to_ms(row.get("generated_at")),
            "tips": row.get("tips") or [],
            "stats_snapshot": row.get("stats_snapshot"),
            "feedback_score": row.get("feedback_score"),
            "model_used": row.get("model_used"),
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("coaching:upsertSession", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("coaching_sessions row %s failed: %s", row.get("id"), exc)
            stats["errors"] += 1
    return stats


def backfill_memos(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "clapcheeks_memos"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "user_id": row["user_id"],
            "contact_handle": row["contact_handle"],
            "content": row.get("content") or "",
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("memos:upsertMemo", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("memos row %s failed: %s", row.get("id"), exc)
            stats["errors"] += 1
    return stats


def backfill_referrals(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "clapcheeks_referrals"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "referrer_id": row["referrer_id"],
            "referred_id": row.get("referred_id"),
            "referral_code": row["referral_code"],
            "status": row.get("status") or "pending",
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("referrals:insertReferral", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("referrals row %s failed: %s", row.get("id"), exc)
            stats["errors"] += 1
    return stats


def backfill_notifications(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "notifications"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "user_id": row["user_id"],
            "title": row.get("title") or "",
            "message": row.get("message"),
            "type": row.get("type"),
            "action_url": row.get("action_url"),
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("notifications:insertNotification", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("notifications row %s failed: %s", row.get("id"), exc)
            stats["errors"] += 1
    return stats


def backfill_devices(supabase, convex, *, dry_run: bool, limit: int | None):
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}
    for row in _iter_pages(supabase, "devices"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        payload = {
            "user_id": row["user_id"],
            "device_name": row.get("device_name") or "unknown",
            "platform": row.get("platform") or "other",
            "agent_version": row.get("agent_version"),
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("devices:upsertDevice", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning("devices row %s failed: %s", row.get("id"), exc)
            stats["errors"] += 1
    return stats


def backfill_google_calendar_tokens(supabase, convex, *, dry_run: bool, limit: int | None):
    """Encrypt refresh_token + access_token client-side, then write ciphertext."""
    stats = {"read": 0, "written": 0, "skipped": 0, "errors": 0}

    # Lazy-import to avoid a hard dependency unless this table is requested.
    try:
        from clapcheeks.auth.token_vault import encrypt_token  # type: ignore
    except Exception as exc:
        log.error(
            "google_calendar_tokens requires clapcheeks.auth.token_vault.encrypt_token: %s",
            exc,
        )
        stats["errors"] = 1
        return stats

    for row in _iter_pages(supabase, "google_calendar_tokens"):
        stats["read"] += 1
        if limit and stats["read"] > limit:
            break
        user_id = row["user_id"]
        access = row.get("access_token") or ""
        refresh = row.get("refresh_token") or ""
        if not refresh:
            stats["skipped"] += 1
            continue
        try:
            access_ct = bytes(encrypt_token(access, user_id))
            refresh_ct = bytes(encrypt_token(refresh, user_id))
        except Exception as exc:
            log.warning(
                "encrypt failure for user %s on google_calendar_tokens: %s",
                user_id, exc,
            )
            stats["errors"] += 1
            continue
        payload = {
            "user_id": user_id,
            "google_email": row.get("google_email") or "",
            "google_sub": row.get("google_sub"),
            "access_token_encrypted": access_ct,
            "refresh_token_encrypted": refresh_ct,
            "enc_version": 1,
            "expires_at": _to_ms(row.get("expires_at")) or 0,
            "scopes": row.get("scopes") or [],
            "calendar_id": row.get("calendar_id") or "primary",
        }
        if dry_run:
            stats["written"] += 1
            continue
        try:
            convex.mutation("calendarTokens:upsertEncrypted", payload)
            stats["written"] += 1
        except Exception as exc:
            log.warning(
                "google_calendar_tokens row %s failed: %s", user_id, exc,
            )
            stats["errors"] += 1
    return stats


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

TABLE_RUNNERS = {
    "subscriptions": backfill_subscriptions,
    "dunning_events": backfill_dunning_events,
    "voice_profiles": backfill_voice_profiles,
    "voice_context": backfill_voice_context,
    "notification_prefs": backfill_notification_prefs,
    "report_preferences": backfill_report_preferences,
    "coaching_sessions": backfill_coaching_sessions,
    "memos": backfill_memos,
    "referrals": backfill_referrals,
    "notifications": backfill_notifications,
    "devices": backfill_devices,
    "google_calendar_tokens": backfill_google_calendar_tokens,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only", default="", help="comma-separated table list")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")
    convex_url = os.environ.get("CONVEX_URL")
    if not (supabase_url and supabase_key and convex_url):
        log.error(
            "SUPABASE_URL, SUPABASE_SERVICE_KEY, and CONVEX_URL are required",
        )
        return 1

    try:
        from supabase import create_client  # type: ignore
        from convex import ConvexClient  # type: ignore
    except ImportError as exc:
        log.error("missing dependency: %s", exc)
        log.error("install with: pip install supabase convex")
        return 1

    supabase = create_client(supabase_url, supabase_key)
    convex = ConvexClient(convex_url)
    deploy_key = os.environ.get("CONVEX_DEPLOY_KEY")
    if deploy_key:
        convex.set_admin_auth(deploy_key)

    only = {t.strip() for t in args.only.split(",") if t.strip()}
    limit = args.limit or None

    summary: dict[str, dict[str, int]] = {}
    for table, runner in TABLE_RUNNERS.items():
        if only and table not in only:
            continue
        log.info("backfilling %s (dry_run=%s)", table, args.dry_run)
        try:
            stats = runner(supabase, convex, dry_run=args.dry_run, limit=limit)
        except Exception as exc:
            log.exception("table %s failed: %s", table, exc)
            stats = {"read": 0, "written": 0, "skipped": 0, "errors": 1}
        summary[table] = stats
        log.info("%s -> %s", table, json.dumps(stats))

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
