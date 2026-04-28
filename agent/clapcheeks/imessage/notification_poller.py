"""Notification queue poller (AI-8772).

Drains rows from `clapcheeks_outbound_notifications` (channel='imessage')
and sends each via the existing iMessage transport. Runs alongside the
reply queue poller -- this one targets the operator's own phone, not a
match's.
"""
from __future__ import annotations

import logging
import time

from clapcheeks.imessage.sender import send_imessage
from clapcheeks.sync import _load_supabase_env

logger = logging.getLogger(__name__)

_DEFAULT_POLL_INTERVAL = 30


def _get_supabase_client():
    """Create a Supabase client using the shared env-loading pattern."""
    from supabase import create_client

    url, key = _load_supabase_env()
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL or SUPABASE_SERVICE_KEY not set. "
            "Set them in env or ~/.clapcheeks/.env"
        )
    return create_client(url, key)


def poll_and_send(client, user_id: str, *, dry_run: bool = False) -> int:
    """Fetch queued operator notifications for `user_id` and deliver each.

    Only rows with status='pending' AND channel='imessage' are processed.
    Returns the number of messages processed.
    """
    result = (
        client.table("clapcheeks_outbound_notifications")
        .select("*")
        .eq("status", "pending")
        .eq("channel", "imessage")
        .eq("user_id", user_id)
        .order("created_at")
        .limit(20)
        .execute()
    )

    rows = result.data or []
    if not rows:
        return 0

    processed = 0
    for row in rows:
        row_id = row["id"]
        phone = row["phone_e164"]
        body = row["body"]

        logger.info("Sending operator notification %s to %s", row_id, phone)

        update: dict
        if dry_run:
            logger.info("[DRY RUN] Would send to %s: %s", phone, body)
            update = {
                "status": "sent",
                "sent_at": "now()",
                "attempts": (row.get("attempts") or 0) + 1,
            }
        else:
            res = send_imessage(phone, body)
            if res.ok:
                update = {
                    "status": "sent",
                    "sent_at": "now()",
                    "attempts": (row.get("attempts") or 0) + 1,
                }
            else:
                update = {
                    "status": "failed",
                    "attempts": (row.get("attempts") or 0) + 1,
                    "last_error": res.error or f"channel={res.channel}",
                }
                logger.error(
                    "Failed to deliver notification %s to %s: %s",
                    row_id, phone, res.error,
                )

        client.table("clapcheeks_outbound_notifications").update(update).eq(
            "id", row_id
        ).execute()

        processed += 1

    return processed


def run_poller(
    user_id: str,
    *,
    interval: float = _DEFAULT_POLL_INTERVAL,
    dry_run: bool = False,
) -> None:
    """Long-running loop that drains operator notifications.

    `user_id` scopes the poll so an operator's Mac never picks up a
    different operator's queue (defense-in-depth on top of RLS).
    """
    client = _get_supabase_client()
    logger.info(
        "Notification poller started (user_id=%s, interval=%ss, dry_run=%s)",
        user_id, interval, dry_run,
    )

    while True:
        try:
            count = poll_and_send(client, user_id, dry_run=dry_run)
            if count:
                logger.info("Processed %d operator notification(s)", count)
        except KeyboardInterrupt:
            raise
        except Exception:
            logger.exception("Error during notification poll cycle")
        time.sleep(interval)
