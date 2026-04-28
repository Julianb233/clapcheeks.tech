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

P6 (AI-8740, write side): on transition to chatting_phone we also write a
portable per-contact memo via :func:`record_handoff_memo` so the iMessage
reply path has the match's profile + last-30-message convo on hand.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Iterable

from clapcheeks.imessage.memo import write_memo
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


# ---------------------------------------------------------------------------
# P6 (AI-8740): per-contact memo at platform → iMessage handoff.
# ---------------------------------------------------------------------------

def _coerce_str(val) -> str:
    """Best-effort string coercion for fields that might be int/None/dict."""
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    return str(val)


def _extract_phone_from_match(match_data: dict) -> str:
    """Pull the best phone candidate out of a platform match dict.

    Different sources stash the phone under different keys; we check the
    most common ones first, then fall back to scanning string fields for
    a NANP-shaped number.
    """
    if not isinstance(match_data, dict):
        return ""
    for key in ("her_phone", "phone", "phone_e164", "phone_number", "number"):
        val = match_data.get(key)
        if val:
            return _coerce_str(val)
    # Some platforms tuck the number into a free-text field after handoff.
    for key in ("last_message", "phone_handoff_text", "bio"):
        val = match_data.get(key)
        if isinstance(val, str):
            extracted = extract_phone(val)
            if extracted:
                return extracted
    return ""


def _extract_profile_fields(match_data: dict) -> dict:
    """Normalize Tinder/Hinge/offline match dicts into write_memo kwargs.

    Tinder typically exposes:
        {name, age, city_name, distance_mi, schools:[{name}],
         jobs:[{title:{name}, company:{name}}]}
    Hinge typically exposes:
        {first_name, age, location, hometown, education:[{school_name}],
         job_title, employer, prompts:[{prompt, response}], comment}
    Offline ingest can be free-form. We fall back to empty strings.
    """
    if not isinstance(match_data, dict):
        return {}

    name = (
        match_data.get("name")
        or match_data.get("first_name")
        or match_data.get("display_name")
        or ""
    )

    city = (
        match_data.get("city")
        or match_data.get("city_name")
        or match_data.get("location")
        or ""
    )

    age = match_data.get("age") or match_data.get("birth_age") or ""

    distance_mi = (
        match_data.get("distance_mi")
        or match_data.get("distance")
        or ""
    )

    schools_raw = match_data.get("schools") or match_data.get("education") or []
    schools: list[str] = []
    if isinstance(schools_raw, list):
        for s in schools_raw:
            if isinstance(s, dict):
                val = s.get("name") or s.get("school_name") or s.get("school")
                if val:
                    schools.append(_coerce_str(val))
            elif s:
                schools.append(_coerce_str(s))

    jobs_raw = match_data.get("jobs") or []
    jobs: list[str] = []
    if isinstance(jobs_raw, list):
        for j in jobs_raw:
            if isinstance(j, dict):
                title = j.get("title")
                if isinstance(title, dict):
                    title = title.get("name") or ""
                company = j.get("company")
                if isinstance(company, dict):
                    company = company.get("name") or ""
                merged = " @ ".join(
                    filter(None, [_coerce_str(title), _coerce_str(company)])
                )
                if merged:
                    jobs.append(merged)
            elif j:
                jobs.append(_coerce_str(j))
    # Hinge-flavored single-job fallback.
    job_title = match_data.get("job_title") or match_data.get("job")
    employer = match_data.get("employer") or match_data.get("company")
    if (job_title or employer) and not jobs:
        merged = " @ ".join(
            filter(None, [_coerce_str(job_title), _coerce_str(employer)])
        )
        if merged:
            jobs.append(merged)

    prompts_raw = match_data.get("prompts") or []
    prompts: list[dict] = []
    if isinstance(prompts_raw, list):
        for p in prompts_raw:
            if not isinstance(p, dict):
                continue
            question = p.get("question") or p.get("prompt") or "?"
            answer = p.get("answer") or p.get("response") or "?"
            prompts.append({
                "question": _coerce_str(question),
                "answer": _coerce_str(answer),
            })

    her_comment = (
        match_data.get("her_comment")
        or match_data.get("comment")
        or match_data.get("like_comment")
        or ""
    )

    return {
        "name": _coerce_str(name),
        "age": _coerce_str(age),
        "city": _coerce_str(city),
        "distance_mi": _coerce_str(distance_mi),
        "schools": schools,
        "jobs": jobs,
        "prompts": prompts,
        "her_comment": _coerce_str(her_comment),
    }


def record_handoff_memo(
    match_data: dict,
    convo_lines: list[str] | None,
    source: str,
) -> str:
    """Write a per-contact memo for a match that just handed off to iMessage.

    Pulls the phone number + whatever profile fields are available out of
    ``match_data`` (Tinder dict shape, Hinge dict shape, or offline-ish
    free-form). Wraps :func:`write_memo` with the platform-specific
    extraction so callers don't have to know the memo format.

    Returns the path written, or an empty string if the memo could not be
    written (no phone, write failure, etc.). Never raises — the handoff
    state-machine flip must not be blocked by a memo I/O error.
    """
    try:
        phone = _extract_phone_from_match(match_data)
        if not phone:
            logger.info("record_handoff_memo: no phone in match_data, skipping")
            return ""

        kwargs = _extract_profile_fields(match_data)
        return write_memo(
            phone,
            source=source or "",
            convo_lines=convo_lines or [],
            **kwargs,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("record_handoff_memo failed: %s", exc)
        return ""
