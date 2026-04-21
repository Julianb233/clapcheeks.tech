"""Phase F offline contact ingestion (AI-8320).

Julian meets a woman in real life and adds her via the dashboard. This
module:

1. Creates a clapcheeks_matches row with platform='offline', source='imessage'
2. Pulls the last 90 days of iMessage history for her number
3. Writes those messages to clapcheeks_conversations with channel='imessage'
4. Optionally enqueues an Instagram enrichment job if a handle was given

The actual Supabase writes are orchestrated here as thin wrappers; the
dashboard /api/matches/offline route calls into this module.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from clapcheeks.imessage.handoff import to_e164_us
from clapcheeks.imessage.reader import (
    CHAT_DB,
    IMMessageReader,
    normalize_phone_digits,
)

logger = logging.getLogger("clapcheeks.imessage.offline_ingest")


class OfflineIngestError(ValueError):
    """Raised when the offline contact payload is invalid."""


def validate_offline_payload(payload: dict) -> dict:
    """Validate + normalize a dashboard submission.

    Required: name, phone
    Optional: instagram_handle, met_at, first_impression, notes

    Returns a normalized dict with `phone_e164` set.
    Raises OfflineIngestError on any validation failure.
    """
    name = (payload.get("name") or "").strip()
    phone = (payload.get("phone") or "").strip()
    if not name:
        raise OfflineIngestError("name is required")
    if not phone:
        raise OfflineIngestError("phone is required")

    phone_e164 = to_e164_us(phone)
    if not phone_e164:
        raise OfflineIngestError(
            f"phone '{phone}' is not a valid 10-digit NANP number"
        )

    handle = (payload.get("instagram_handle") or "").strip().lstrip("@") or None
    met_at = (payload.get("met_at") or "").strip() or None
    first_impression = (payload.get("first_impression") or payload.get("notes") or "").strip() or None

    return {
        "name": name,
        "phone_e164": phone_e164,
        "instagram_handle": handle,
        "met_at": met_at,
        "first_impression": first_impression,
    }


def build_match_row(user_id: str, normalized: dict) -> dict:
    """Return the dict to upsert into clapcheeks_matches."""
    digits = normalize_phone_digits(normalized["phone_e164"])
    external_id = f"offline:{digits}"
    now = datetime.now(timezone.utc).isoformat()
    return {
        "user_id": user_id,
        "platform": "offline",
        "external_id": external_id,
        "name": normalized["name"],
        "her_phone": normalized["phone_e164"],
        "source": "imessage",
        "primary_channel": "imessage",
        "handoff_complete": True,  # offline contacts start already on iMessage
        "julian_shared_phone": True,
        "handoff_detected_at": now,
        "instagram_handle": normalized.get("instagram_handle"),
        "met_at": normalized.get("met_at"),
        "first_impression": normalized.get("first_impression"),
        "status": "conversing",
        "created_at": now,
        "updated_at": now,
        "last_activity_at": now,
    }


def build_conversation_events(
    user_id: str,
    external_id: str,
    imessages: list[dict],
) -> list[dict]:
    """Turn raw iMessage rows into clapcheeks_conversations inserts.

    We keep the schema loose — each row is channel='imessage' so the
    unified thread renders correctly.
    """
    out: list[dict] = []
    for msg in imessages:
        sent_at = msg.get("date")
        if hasattr(sent_at, "isoformat"):
            sent_at = sent_at.isoformat()
        out.append({
            "user_id": user_id,
            "match_id": external_id,
            "platform": "offline",
            "channel": "imessage",
            "direction": "outgoing" if msg.get("is_from_me") else "incoming",
            "body": msg.get("text") or "",
            "sent_at": sent_at or datetime.now(timezone.utc).isoformat(),
            "handle_id": msg.get("handle_id"),
        })
    return out


def pull_imessage_history(phone_e164: str, days: int = 90) -> list[dict]:
    """Thin wrapper around IMMessageReader. Safe on machines without FDA
    (returns [] when chat.db can't be opened).
    """
    if not CHAT_DB.exists():
        logger.info("iMessage chat.db not present at %s — skipping history", CHAT_DB)
        return []
    try:
        with IMMessageReader() as reader:
            return reader.get_messages_for_phone(phone_e164, days=days)
    except Exception as exc:  # noqa: BLE001 — defensive; any read error is non-fatal
        logger.warning("iMessage history pull failed: %s", exc)
        return []


def enqueue_ig_enrichment_job(
    user_id: str,
    match_external_id: str,
    handle: str,
    *,
    supabase_client=None,
) -> None:
    """Post a job onto clapcheeks_agent_jobs so the Phase C consumer
    enriches the IG profile asynchronously.

    No-op if supabase_client is None (unit tests).
    """
    if supabase_client is None:
        return
    payload = {
        "user_id": user_id,
        "job_type": "ig_enrich_match",
        "status": "queued",
        "payload": {
            "match_external_id": match_external_id,
            "instagram_handle": handle,
            "source": "phase_f_offline",
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        supabase_client.table("clapcheeks_agent_jobs").insert(payload).execute()
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning("IG enrichment enqueue failed for %s: %s", handle, exc)
