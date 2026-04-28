"""Queue poller — fetches web-initiated replies from Supabase and sends via iMessage."""
from __future__ import annotations

import logging
import time

from clapcheeks.imessage.watcher import _send_imessage

logger = logging.getLogger(__name__)

_DEFAULT_POLL_INTERVAL = 30


def _get_supabase_client():
    """Return a user-scoped Supabase client (AI-8767).

    Uses the operator's JWT so ``clapcheeks_queued_replies`` rows are
    filtered by RLS to the operator's own ``user_id``.  No service-role key
    is required on the Mac.
    """
    from clapcheeks.supabase_client import get_user_client
    return get_user_client()


def poll_and_send(client, *, dry_run: bool = False) -> int:
    """Fetch queued replies and send each via iMessage.

    Returns the number of messages processed.
    """
    result = (
        client.table("clapcheeks_queued_replies")
        .select("*")
        .eq("status", "queued")
        .order("created_at")
        .execute()
    )

    rows = result.data or []
    if not rows:
        return 0

    processed = 0
    for row in rows:
        row_id = row["id"]
        handle = row["recipient_handle"]
        body = row["body"]

        logger.info("Sending queued reply %s to %s", row_id, handle)

        if dry_run:
            logger.info("[DRY RUN] Would send to %s: %s", handle, body)
            new_status = "sent"
        else:
            success = _send_imessage(handle, body)
            new_status = "sent" if success else "failed"
            if not success:
                logger.error("Failed to send reply %s to %s", row_id, handle)

        client.table("clapcheeks_queued_replies").update(
            {"status": new_status}
        ).eq("id", row_id).execute()

        logger.info("Reply %s marked as %s", row_id, new_status)
        processed += 1

    return processed


def run_poller(*, interval: float = _DEFAULT_POLL_INTERVAL, dry_run: bool = False) -> None:
    """Long-running loop that polls for queued replies and sends them."""
    client = _get_supabase_client()
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
