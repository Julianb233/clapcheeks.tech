"""Phase F handoff detection + state machine (AI-8320).

Parses phone numbers out of platform messages (Tinder, Hinge, offline),
updates the clapcheeks_matches row, and bumps stage to `chatting_phone`
once both sides have shared a number.

Two detection paths:

1. SHE sends her number  -> set match.her_phone  (E.164) and
                            primary_channel='imessage' once julian has too.
2. HE (Clapcheeks draft)  sends a number -> set match.julian_shared_phone=true.

When both are true, `handoff_complete=true` + status flips to
`chatting_phone`. The daemon's iMessage poller takes over drafting from
that point on.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Iterable

from clapcheeks.imessage.reader import normalize_phone_digits, to_e164_us

logger = logging.getLogger("clapcheeks.imessage.handoff")

# Matches common NANP formats:
#   555-123-4567, (555) 123-4567, 555.123.4567, 5551234567, +1 555 123 4567
#
# Reject obvious non-phone number sequences (zip+plus4, years, OTP codes)
# via a length gate + the NANP first-digit rule (area code must be 2-9).
_PHONE_RE = re.compile(
    r"(?<!\d)"                          # not preceded by a digit
    r"(?:\+?1[\s\-\.]?)?"              # optional +1 country code
    r"\(?([2-9]\d{2})\)?"              # area code (NANP — can't start 0 or 1)
    r"[\s\-\.]?"                        # separator
    r"([2-9]\d{2})"                    # exchange
    r"[\s\-\.]?"                        # separator
    r"(\d{4})"                          # subscriber number
    r"(?!\d)"                           # not followed by a digit
)


@dataclass
class HandoffSignal:
    """Result of scanning a single message."""

    phone_e164: str | None            # normalized +1XXXXXXXXXX if found
    direction: str                    # 'incoming' (from her) or 'outgoing' (from Julian)
    raw_match: str | None             # literal substring that matched


def extract_phone(text: str | None) -> str | None:
    """Return the first NANP phone number in `text` normalized to E.164, or None."""
    if not text:
        return None
    match = _PHONE_RE.search(text)
    if not match:
        return None
    area, exchange, sub = match.groups()
    candidate = f"{area}{exchange}{sub}"
    return to_e164_us(candidate)


def scan_message(text: str | None, direction: str) -> HandoffSignal:
    """Parse a single message into a HandoffSignal.

    direction MUST be 'incoming' or 'outgoing'.
    """
    if direction not in ("incoming", "outgoing"):
        raise ValueError(f"direction must be incoming|outgoing, got {direction!r}")
    phone = extract_phone(text)
    raw = None
    if phone and text:
        m = _PHONE_RE.search(text)
        if m:
            raw = m.group(0)
    return HandoffSignal(phone_e164=phone, direction=direction, raw_match=raw)


def compute_handoff_state(
    existing: dict,
    signal: HandoffSignal,
) -> dict:
    """Pure function: given the current match row + a new HandoffSignal,
    return the dict of column updates to apply.

    Does NOT mutate `existing`. Returns {} if the signal introduces no change.

    existing shape (subset):
        { her_phone, julian_shared_phone, handoff_complete,
          primary_channel, status, handoff_detected_at }
    """
    if not signal.phone_e164:
        return {}

    updates: dict = {}

    if signal.direction == "incoming":
        # SHE shared a number.
        if not existing.get("her_phone"):
            updates["her_phone"] = signal.phone_e164
    elif signal.direction == "outgoing":
        # He (via Clapcheeks) offered a number.
        if not existing.get("julian_shared_phone"):
            updates["julian_shared_phone"] = True

    merged = {**existing, **updates}
    her_ready = bool(merged.get("her_phone"))
    julian_ready = bool(merged.get("julian_shared_phone"))

    if her_ready and julian_ready and not merged.get("handoff_complete"):
        updates["handoff_complete"] = True
        updates["primary_channel"] = "imessage"
        # Stage bump — don't demote a farther-along stage.
        cur_status = (merged.get("status") or "new").lower()
        protected = {"date_proposed", "date_booked", "dated"}
        if cur_status not in protected:
            updates["status"] = "chatting_phone"
        # Timestamp the transition for UI badges.
        from datetime import datetime, timezone
        updates["handoff_detected_at"] = datetime.now(timezone.utc).isoformat()

    return updates


def should_draft_handoff_ask(
    message_count: int,
    engagement_score: float | None,
    julian_already_shared: bool,
    green_signals: Iterable[str] | None = None,
) -> bool:
    """Decide whether to draft a 'here's my number' message.

    Gated on:
      - 5+ messages exchanged
      - Green engagement (score >= 0.6 OR any of: 'laughing', 'asks_questions',
        'long_replies', 'emojis_positive' in green_signals)
      - Julian has not already shared his number
    """
    if julian_already_shared:
        return False
    if message_count < 5:
        return False
    green = list(green_signals or [])
    positive_signals = {
        "laughing", "asks_questions", "long_replies",
        "emojis_positive", "playful", "flirty",
    }
    if any(s in positive_signals for s in green):
        return True
    if engagement_score is not None and engagement_score >= 0.6:
        return True
    return False


def load_handoff_template(persona_json: dict | None) -> str:
    """Pull `persona.platform_handoff.julian_golden_template.full_text`
    from the user_settings persona JSON, with safe fallback.
    """
    if persona_json:
        try:
            pt = (
                persona_json
                .get("platform_handoff", {})
                .get("julian_golden_template", {})
                .get("full_text")
            )
            if pt and isinstance(pt, str):
                return pt
        except (AttributeError, TypeError):
            pass
    # Fallback matches the golden template shape described in AI-8320.
    return (
        "hey, I'm never really on this app — text me. 6194801234. "
        "easier to actually chat that way."
    )
