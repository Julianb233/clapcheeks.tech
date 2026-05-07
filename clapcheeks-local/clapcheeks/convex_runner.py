"""convex_runner — Mac Mini side Convex job consumer.

AI-9500-F: pattern_interrupt template family + DISC-based sub-style chooser.

This module is consumed by the Mac Mini daemon when it picks up
``send_imessage`` agent_jobs whose ``prompt_template`` field is set to
``pattern_interrupt_<sub_style>``.

Flow (fireOne in Convex touches.ts) ─────────────────────────────────────────
  1. Convex fires a scheduled_touch with type="pattern_interrupt" and
     prompt_template="pattern_interrupt_<sub_style>".
  2. Convex enqueues an agent_jobs row with job_type="send_imessage" and
     the prompt_template in the payload.
  3. Mac Mini daemon polls agent_jobs, sees the row, calls
     _draft_with_template(person, template_key) to get a draft body.
  4. Draft goes through the standard drafter pipeline (sanitize → validate →
     split → queue / auto-send).

Sub-styles
──────────
  callback              — reference an earlier conversation moment
  meme_reference        — light pop-culture nudge
  low_pressure_check_in — "hope your week's been chill"
  bold_direct           — "haven't heard from you — figured I'd just say hey"
  seasonal_hook         — tied to current season/month

DISC chooser
────────────
  D (Dominance)         → bold_direct
  I (Influence)         → meme_reference
  S (Steadiness)        → low_pressure_check_in
  C (Conscientiousness) → callback
  default / unknown     → seasonal_hook

The same logic is mirrored in TypeScript at
  web/convex/enrichment.ts → pickPatternInterruptSubStyle()
Keep the two in sync.
"""
from __future__ import annotations

import calendar
import datetime
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pattern interrupt sub-style templates
# ---------------------------------------------------------------------------
# Each template is a *system prompt* string fed into the drafter pipeline
# (clapcheeks.ai.drafter.run_pipeline).  {name} is interpolated with the
# person's first name before the LLM call.
#
# Rules applied here (mirroring reactivation.py conventions):
#   - 12 words max (the *instruction* constrains the LLM, not the template).
#   - Lowercase output.
#   - No banned openers: "hey stranger", "long time no talk", "just checking in",
#     "miss me?", "remember me?", "did I do something wrong".
#   - No apology, no reference to silence / gap / not-texting.
#   - The template is intentionally short so the LLM stays tightly scoped.

_PATTERN_INTERRUPT_TEMPLATES: dict[str, str] = {
    "callback": (
        "Write one very short, casual message for {name}. "
        "Reference a specific earlier moment from the conversation — an inside joke, "
        "something she mentioned she was excited about, or a shared reference point. "
        "Make it feel like you genuinely thought of her because of that thing, not "
        "because a script fired. 12 words max, lowercase. "
        "Do NOT say 'hey stranger', 'just checking in', 'long time no talk'. "
        "Do NOT mention any gap or silence. "
        "Reply with ONLY the message text."
    ),
    "meme_reference": (
        "Write one very short, playful message for {name}. "
        "Drop a light, current pop-culture or internet-culture reference — "
        "something that feels natural to forward to someone you're thinking about. "
        "Tone: fun, not try-hard. 10 words max, lowercase. "
        "No reference to not-texting, no apology. "
        "Reply with ONLY the message text."
    ),
    "low_pressure_check_in": (
        "Write one very short, warm, low-pressure message for {name}. "
        "Something like 'hope your week's been good' or 'been thinking about you' — "
        "easy, no expectation of a long reply, genuinely warm. "
        "10 words max, lowercase. "
        "Do NOT say 'just checking in', 'long time no talk', 'hey stranger'. "
        "No guilt, no apology, no reference to silence. "
        "Reply with ONLY the message text."
    ),
    "bold_direct": (
        "Write one very short, confident, direct message for {name}. "
        "The kind of thing a secure guy says when he's been thinking about someone "
        "and just decides to reach out — no preamble, no apology. "
        "Example energy: 'figured I'd just say hey'. "
        "10 words max, lowercase. "
        "Do NOT reference the silence or apologise for it. "
        "Reply with ONLY the message text."
    ),
    "seasonal_hook": (
        "Write one very short, casual message for {name} that's relevant to the "
        "current time of year — the season, a recent holiday, weather, or a cultural "
        "moment happening right now. "
        "Make it feel spontaneous, like something in your environment reminded you "
        "of her. 12 words max, lowercase. "
        "Do NOT say 'hey stranger', 'just checking in', 'long time no talk'. "
        "No apology, no reference to silence. "
        "Reply with ONLY the message text."
    ),
}

# Valid sub-style keys — matches TypeScript enum in enrichment.ts.
VALID_SUB_STYLES = frozenset(_PATTERN_INTERRUPT_TEMPLATES.keys())


# ---------------------------------------------------------------------------
# DISC-based sub-style chooser
# ---------------------------------------------------------------------------

def pick_sub_style(person: dict[str, Any]) -> str:
    """Return the best pattern_interrupt sub-style for this person.

    Reads ``disc_primary`` from the person dict (Convex people row).
    Mirror of TypeScript ``pickPatternInterruptSubStyle`` in enrichment.ts.

    DISC mapping:
      D → bold_direct
      I → meme_reference
      S → low_pressure_check_in
      C → callback
      other / None → seasonal_hook

    Args:
        person: A dict with at least an optional ``disc_primary`` key (str).
                Can also contain ``courtship_stage`` for future refinements.

    Returns:
        One of: "bold_direct", "meme_reference", "low_pressure_check_in",
                "callback", "seasonal_hook".
    """
    disc = (person.get("disc_primary") or "").strip().upper()
    if disc == "D":
        return "bold_direct"
    if disc == "I":
        return "meme_reference"
    if disc == "S":
        return "low_pressure_check_in"
    if disc == "C":
        return "callback"
    # Default: seasonal_hook.  Also falls back gracefully for unknown values.
    return "seasonal_hook"


# ---------------------------------------------------------------------------
# Template getter (with seasonal context injection)
# ---------------------------------------------------------------------------

def _current_season() -> str:
    """Return the Northern Hemisphere season name for the current month."""
    month = datetime.date.today().month
    if month in (12, 1, 2):
        return "winter"
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    return "fall"


def get_template(sub_style: str) -> str:
    """Return the system-prompt template string for the given sub_style.

    Falls back to ``seasonal_hook`` for unrecognised keys.

    For ``seasonal_hook``, the template includes the *current* season name
    injected at call time so the LLM has concrete temporal context.
    """
    if sub_style not in _PATTERN_INTERRUPT_TEMPLATES:
        logger.warning(
            "pattern_interrupt: unknown sub_style %r — falling back to seasonal_hook",
            sub_style,
        )
        sub_style = "seasonal_hook"

    template = _PATTERN_INTERRUPT_TEMPLATES[sub_style]

    # Inject current season for the seasonal hook variant.
    if sub_style == "seasonal_hook":
        season = _current_season()
        month_name = calendar.month_name[datetime.date.today().month]
        template = (
            f"[Context: It is currently {month_name}, {season}.]\n\n{template}"
        )

    return template


# ---------------------------------------------------------------------------
# Main draft entrypoint — called by Mac Mini daemon's agent_jobs consumer
# ---------------------------------------------------------------------------

def _draft_with_template(
    person: dict[str, Any],
    template_key: str,
    *,
    user_id: Optional[str] = None,
    supabase: Any = None,
) -> list[str]:
    """Draft a pattern_interrupt message and run it through the pipeline.

    Args:
        person: Convex people row (dict).  Must have ``display_name``.
        template_key: Full template key, e.g. ``"pattern_interrupt_bold_direct"``.
                      May also be the bare sub-style key (``"bold_direct"``).
        user_id: Supabase user id (for AI gate check + discard logging).
        supabase: Supabase client (for AI gate check).

    Returns:
        List of 1-3 message strings to send sequentially.
        Falls back to the ``bold_direct`` hardcoded default if the pipeline
        rejects the draft.
    """
    # Strip prefix if caller passed the full template key.
    sub_style = template_key
    if sub_style.startswith("pattern_interrupt_"):
        sub_style = sub_style[len("pattern_interrupt_"):]
    if sub_style not in VALID_SUB_STYLES:
        sub_style = pick_sub_style(person)

    template = get_template(sub_style)
    name = (person.get("display_name") or "").split()[0] or "her"
    system_prompt = template.format(name=name)

    try:
        from clapcheeks.ai import drafter as _drafter

        result = _drafter.run_pipeline(
            raw_text=system_prompt,   # drafter forwards this to the LLM
            user_id=user_id,
            conversation_stage="mid",
            supabase=supabase,
            match_id=str(person.get("_id") or ""),
            on_discard=lambda txt, errs: _drafter.log_discard_to_supabase(
                user_id, "pattern_interrupt", txt, errs
            ),
        )

        if result.ok and result.messages:
            return result.messages

        logger.info(
            "pattern_interrupt draft discarded for %s: %s",
            person.get("display_name"),
            result.errors,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("pattern_interrupt _draft_with_template error: %s", exc)

    # Hardcoded fallback — always safe to send.
    return ["figured I'd just say hey"]


# ---------------------------------------------------------------------------
# AI-9500 W2 E13 — call sync handler
#
# Reads call records from chat.db (the message table has item_type=2 for
# audio/video calls and a non-null audio_files / was_data_detected column on
# FaceTime calls).  We use the following columns:
#
#   message.item_type        — 2 = attachment/call event (audio call)
#   message.is_from_me       — 1 = outbound, 0 = inbound
#   message.date             — Apple CoreData timestamp (ns since 2001-01-01)
#   message.date_delivered   — non-zero for connected calls
#   message.was_delivered_quietly — sometimes set for missed
#   handle.id                — phone / iMessage handle
#   message.service          — "iMessage" or "SMS" (FaceTime shows as iMessage)
#   message.text             — may contain "FaceTime" for FaceTime audio/video
#
# Simpler approach used here:  messages whose `text` IS NULL and `item_type`
# IN (2, 3) or whose text matches FaceTime-style system text.  We also capture
# plain audio calls via `message.service` = 'iMessage' and text NULL.
#
# We look for:
#   - "FaceTime Audio" or "FaceTime Video" in the text or cache_has_attachments > 0
#     with item_type in (2, 3) → platform = "facetime"
#   - item_type = 2, service = "iMessage", text IS NULL → platform = "imessage_native"
#
# Duration: chat.db does NOT store call duration for iMessage/FaceTime natively
# (it is not surfaced in the SQLite schema the way WhatsApp does it).  We
# store None and allow a future patch via the upsertCall mutation if Twilio
# or another source provides it.
#
# This handler is registered in agent_jobs as job_type = "sync_calls".
# The cron at /clapcheeks-local/clapcheeks/agent_jobs.py enqueues it every
# 15 minutes.
# ---------------------------------------------------------------------------

import datetime
import sqlite3
from pathlib import Path
from typing import Optional, Any

CHAT_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"

# Apple's reference epoch: 2001-01-01 00:00:00 UTC
_APPLE_EPOCH_TS = datetime.datetime(2001, 1, 1, tzinfo=datetime.timezone.utc).timestamp()

# How far back to look on each poll (avoids re-scanning the full DB forever)
_CALL_LOOKBACK_DAYS = 30


def _apple_ns_to_epoch_ms(ns_ts: Optional[int]) -> Optional[int]:
    """Convert an Apple CoreData nanosecond timestamp to Unix milliseconds."""
    if ns_ts is None or ns_ts == 0:
        return None
    seconds = ns_ts / 1_000_000_000.0
    return int((_APPLE_EPOCH_TS + seconds) * 1_000)


def _handle_sync_calls(
    convex_client: Any,
    user_id: str,
    *,
    lookback_days: int = _CALL_LOOKBACK_DAYS,
) -> dict[str, int]:
    """Poll chat.db for call records and upsert them to Convex.

    Args:
        convex_client: A convex Python client instance with a ``mutation`` method.
        user_id: The Convex user_id (typically "fleet-julian").
        lookback_days: How many days back to scan (default 30).

    Returns:
        Dict with keys ``scanned``, ``upserted``, ``skipped``.
    """
    if not CHAT_DB_PATH.exists():
        logger.warning("[sync_calls] chat.db not found at %s — skipping", CHAT_DB_PATH)
        return {"scanned": 0, "upserted": 0, "skipped": 0}

    # Open read-only via URI
    try:
        conn = sqlite3.connect(
            f"file:{CHAT_DB_PATH}?mode=ro",
            uri=True,
            timeout=10,
        )
        conn.row_factory = sqlite3.Row
    except sqlite3.OperationalError as exc:
        logger.warning("[sync_calls] Cannot open chat.db: %s", exc)
        return {"scanned": 0, "upserted": 0, "skipped": 0}

    # Compute the Apple timestamp for our lookback window
    now_unix = datetime.datetime.now(datetime.timezone.utc).timestamp()
    lookback_unix = now_unix - lookback_days * 86400
    # Convert back to Apple nanoseconds
    lookback_apple_ns = int((lookback_unix - _APPLE_EPOCH_TS) * 1_000_000_000)

    # Detect calls:
    # item_type = 2 or 3 in the message table often marks call events.
    # We also include messages where `text` IS NULL and `service` = 'iMessage'
    # with an associated audio/video attachment (cache_has_attachments = 1).
    # Broadest safe filter: item_type IN (2, 3) OR text LIKE '%FaceTime%'
    CALL_SQL = """
        SELECT
            m.ROWID         AS msg_id,
            m.date          AS apple_date,
            m.is_from_me    AS is_from_me,
            m.service       AS service,
            m.text          AS msg_text,
            m.item_type     AS item_type,
            m.was_delivered_quietly AS was_quiet,
            h.id            AS handle_value
        FROM message m
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE m.date > ?
          AND (
              m.item_type IN (2, 3)
              OR (m.text IS NOT NULL AND m.text LIKE '%FaceTime%')
          )
        ORDER BY m.date ASC
        LIMIT 2000
    """

    scanned = 0
    upserted = 0
    skipped = 0

    try:
        cursor = conn.execute(CALL_SQL, (lookback_apple_ns,))
        rows = cursor.fetchall()
    except sqlite3.OperationalError as exc:
        logger.warning("[sync_calls] Query failed: %s", exc)
        conn.close()
        return {"scanned": 0, "upserted": 0, "skipped": 0}
    finally:
        conn.close()

    for row in rows:
        scanned += 1
        started_at_ms = _apple_ns_to_epoch_ms(row["apple_date"])
        if started_at_ms is None:
            skipped += 1
            continue

        # Determine platform
        msg_text = row["msg_text"] or ""
        service = row["service"] or ""
        if "FaceTime" in msg_text:
            platform = "facetime"
        elif service.lower() in ("imessage", "iMessage"):
            platform = "imessage_native"
        else:
            platform = "phone_native"

        # Direction: is_from_me=1 → outbound.
        # "Missed" detection: was_delivered_quietly=1 is sometimes set for missed;
        # more reliably, item_type=3 often marks a missed FaceTime.
        is_from_me = bool(row["is_from_me"])
        was_quiet = bool(row["was_quiet"])
        item_type = row["item_type"]

        if is_from_me:
            direction = "outbound"
        elif item_type == 3 or was_quiet:
            direction = "missed"
        else:
            direction = "inbound"

        handle_value = row["handle_value"] or None

        try:
            convex_client.mutation(
                "calls:upsertCall",
                {
                    "user_id": user_id,
                    "direction": direction,
                    "started_at_ms": started_at_ms,
                    "handle_value": handle_value,
                    "platform": platform,
                },
            )
            upserted += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[sync_calls] upsertCall failed for row %s: %s",
                row["msg_id"],
                exc,
            )
            skipped += 1

    logger.info(
        "[sync_calls] done — scanned=%d upserted=%d skipped=%d",
        scanned, upserted, skipped,
    )
    return {"scanned": scanned, "upserted": upserted, "skipped": skipped}
