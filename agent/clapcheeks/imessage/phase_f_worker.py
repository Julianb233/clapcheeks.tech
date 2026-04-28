"""Phase F worker loop (AI-8320).

Runs every 2 min. For each match with `her_phone` set (either from
offline ingestion or a detected handoff), pulls any new incoming
iMessages since the last-seen rowid, drafts a reply, and either queues
it or auto-sends depending on the user's approve_replies setting.

Also scans platform conversations for handoff signals and flips the
match row state + primary_channel when both parties have shared a
number.

Designed to be driven by daemon.py's worker registry — import
`run_phase_f_cycle` and call it on a timer.

We keep this module Supabase-agnostic for easy unit testing: pass a
`supabase_client` that implements `.table(...).select/update/insert/...`.

P6 (AI-8740, write side): when scan_platform_messages_for_handoff flips
status to 'chatting_phone', we call record_handoff_memo to write the
portable per-contact memo so the iMessage reply path has profile +
last-30-message convo on hand.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Iterable

from clapcheeks.imessage.handoff import (
    compute_handoff_state,
    load_handoff_template,
    record_handoff_memo,
    scan_message,
    should_draft_handoff_ask,
)
from clapcheeks.imessage.reader import CHAT_DB, IMMessageReader
from clapcheeks.imessage.sender import send_imessage

logger = logging.getLogger("clapcheeks.imessage.phase_f_worker")


@dataclass
class PhaseFConfig:
    user_id: str
    approve_replies: bool = False     # True => queue; False => auto-send
    dry_run: bool = False


def apply_handoff_updates(
    supabase_client,
    match_row: dict,
    updates: dict,
) -> None:
    """Apply the updates dict to the clapcheeks_matches row."""
    if not updates:
        return
    try:
        supabase_client.table("clapcheeks_matches") \
            .update(updates).eq("id", match_row["id"]).execute()
        logger.info(
            "phase_f: applied handoff updates match=%s keys=%s",
            match_row.get("id"), list(updates.keys()),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("phase_f: handoff update failed for %s: %s",
                       match_row.get("id"), exc)


def _format_convo_lines(msg_list: list[dict]) -> list[str]:
    """Render the last N platform messages as 'her: ...' / 'me: ...' lines."""
    out: list[str] = []
    for msg in msg_list[-30:]:
        body = (msg.get("body") or "").strip()
        if not body:
            continue
        direction = (msg.get("direction") or "incoming").lower()
        speaker = "her" if direction == "incoming" else "me"
        out.append(f"{speaker}: {body}")
    return out


def scan_platform_messages_for_handoff(
    supabase_client,
    match_row: dict,
    recent_messages: Iterable[dict],
) -> dict:
    """Scan a batch of recent platform messages for phone signals.

    Each `message` dict must have `direction` ('incoming'|'outgoing')
    and `body`. Applies the resulting updates to the match row.

    Returns the accumulated updates applied.
    """
    accumulated: dict = {}
    snapshot = dict(match_row)
    # Materialize once so we can replay into record_handoff_memo without
    # exhausting a generator-style iterable.
    msg_list = list(recent_messages)
    for msg in msg_list:
        sig = scan_message(msg.get("body"), direction=msg.get("direction") or "incoming")
        if not sig.phone_e164:
            continue
        partial = compute_handoff_state(snapshot, sig)
        if not partial:
            continue
        snapshot.update(partial)
        accumulated.update(partial)

    if accumulated:
        apply_handoff_updates(supabase_client, match_row, accumulated)
        # P6 (AI-8740): when the state machine flips into chatting_phone,
        # write a per-contact memo so the iMessage reply path has the
        # match's profile + recent convo on hand.
        if accumulated.get("status") == "chatting_phone":
            convo_lines = _format_convo_lines(msg_list)
            merged = {**match_row, **accumulated}
            try:
                record_handoff_memo(
                    merged,
                    convo_lines=convo_lines,
                    source=str(merged.get("platform") or "unknown"),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("phase_f: handoff memo write failed: %s", exc)
    return accumulated


def poll_incoming_imessages(
    supabase_client,
    match_row: dict,
    config: PhaseFConfig,
    *,
    reader: IMMessageReader | None = None,
    imessage_checkpoints: dict[str, int] | None = None,
) -> list[dict]:
    """Poll iMessage for new incoming messages from match's her_phone.

    Returns the list of new messages written to clapcheeks_conversations
    (empty list if no new messages or no phone configured).

    `imessage_checkpoints` is a dict {match_id: last_rowid} kept in
    memory by the caller (daemon). Treat it as mutable.
    """
    phone = match_row.get("her_phone")
    if not phone:
        return []
    if imessage_checkpoints is None:
        imessage_checkpoints = {}

    if not CHAT_DB.exists():
        return []

    own_reader = False
    if reader is None:
        try:
            reader = IMMessageReader()
            own_reader = True
        except Exception as exc:  # noqa: BLE001
            logger.info("phase_f: iMessage reader unavailable: %s", exc)
            return []

    try:
        last_rowid = imessage_checkpoints.get(match_row["id"], 0)
        new_msgs = reader.get_new_messages_since(phone, since_rowid=last_rowid)
        if not new_msgs:
            return []

        # Update checkpoint.
        imessage_checkpoints[match_row["id"]] = new_msgs[-1]["rowid"]

        # Write to clapcheeks_conversations.
        rows = []
        for m in new_msgs:
            sent = m.get("date")
            if hasattr(sent, "isoformat"):
                sent = sent.isoformat()
            rows.append({
                "user_id": config.user_id,
                "match_id": match_row.get("external_id") or match_row.get("id"),
                "platform": match_row.get("platform") or "offline",
                "channel": "imessage",
                "direction": "incoming",
                "body": m.get("text") or "",
                "sent_at": sent,
            })
        if rows:
            try:
                supabase_client.table("clapcheeks_conversations").insert(rows).execute()
            except Exception as exc:  # noqa: BLE001
                logger.warning("phase_f: conv insert failed: %s", exc)
        return rows
    finally:
        if own_reader and reader is not None:
            try:
                reader.close()
            except Exception:  # noqa: BLE001
                pass


def maybe_send_handoff_ask(
    supabase_client,
    match_row: dict,
    *,
    message_count: int,
    engagement_score: float | None,
    green_signals: Iterable[str] | None,
    persona_json: dict | None,
    config: PhaseFConfig,
) -> bool:
    """If the gate passes, draft + (optionally) send the handoff ask.

    Returns True if an ask was sent/queued.
    """
    if not should_draft_handoff_ask(
        message_count=message_count,
        engagement_score=engagement_score,
        julian_already_shared=bool(match_row.get("julian_shared_phone")),
        green_signals=green_signals,
    ):
        return False
    template = load_handoff_template(persona_json)
    # Julian is on the platform side here — send the ask via the platform
    # (Tinder/Hinge) job queue, NOT iMessage. We just enqueue; the Phase M
    # consumer will route it.
    try:
        supabase_client.table("clapcheeks_agent_jobs").insert({
            "user_id": config.user_id,
            "job_type": "send_platform_reply",
            "status": "queued" if config.approve_replies else "approved",
            "payload": {
                "match_id": match_row.get("id"),
                "match_external_id": match_row.get("external_id"),
                "platform": match_row.get("platform"),
                "body": template,
                "reason": "handoff_ask",
            },
        }).execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("phase_f: handoff ask enqueue failed: %s", exc)
        return False

    # Optimistically flag that Julian has offered his number, so we don't
    # ask again next cycle. The platform reply consumer will confirm delivery.
    apply_handoff_updates(supabase_client, match_row, {"julian_shared_phone": True})
    return True
