"""Queue poller — fetches web-initiated replies from Convex and sends via iMessage.

AI-9535: migrated from Supabase ``clapcheeks_queued_replies`` to Convex
``queued_replies``. The new mutations live in ``convex/queues.ts``:

  queues:listRepliesForUser    — fetch queued rows for the operator
  queues:updateReplyStatus     — flip status to sent/failed after dispatch

Env contract: same as ``convex_client.py`` —
``CONVEX_URL`` (required), ``CONVEX_DEPLOY_KEY`` (recommended),
``CONVEX_FLEET_USER_ID`` (defaults to ``fleet-julian``).
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

from clapcheeks.convex_client import get_client
from clapcheeks.imessage.watcher import _send_imessage

logger = logging.getLogger(__name__)

_DEFAULT_POLL_INTERVAL = 30


def _user_id() -> str:
    return os.environ.get("CONVEX_FLEET_USER_ID", "fleet-julian").strip() or "fleet-julian"


def poll_and_send(client: Any, *, dry_run: bool = False) -> int:
    """Fetch queued replies from Convex and send each via iMessage.

    Returns the number of messages processed.
    """
    user_id = _user_id()

    try:
        rows = client.query("queues:listRepliesForUser", {
            "user_id": user_id,
            "limit": 100,
        }) or []
    except Exception:
        logger.exception("Convex listRepliesForUser failed")
        return 0

    rows = [r for r in rows if (r or {}).get("status") == "queued"]
    if not rows:
        return 0

    processed = 0
    for row in rows:
        row_id = row.get("_id")
        handle = row.get("recipient_handle") or row.get("match_name")
        body = row.get("body") or row.get("text")
        if not row_id or not handle or not body:
            logger.warning("queued reply missing fields, skipping: %s", row)
            continue

        logger.info("Sending queued reply %s to %s", row_id, handle)

        if dry_run:
            logger.info("[DRY RUN] Would send to %s: %s", handle, body)
            new_status = "sent"
        else:
            success = _send_imessage(handle, body)
            new_status = "sent" if success else "failed"
            if not success:
                logger.error("Failed to send reply %s to %s", row_id, handle)

        try:
            client.mutation("queues:updateReplyStatus", {
                "id": row_id,
                "user_id": user_id,
                "status": new_status,
            })
            logger.info("Reply %s marked as %s", row_id, new_status)
        except Exception:
            logger.exception("Convex updateReplyStatus failed for %s", row_id)
            continue
        processed += 1

    return processed


def run_poller(*, interval: float = _DEFAULT_POLL_INTERVAL, dry_run: bool = False) -> None:
    """Long-running loop that polls Convex for queued replies and sends them."""
    client = get_client()
    logger.info("Queue poller started (interval=%ss, dry_run=%s)", interval, dry_run)

    while True:
        try:
            count = poll_and_send(client, dry_run=dry_run)
            if count:
                logger.info("Processed %d queued reply(ies)", count)
        except KeyboardInterrupt:
            raise
        except Exception:
            logger.exception("Error during poll cycle")
        time.sleep(interval)
