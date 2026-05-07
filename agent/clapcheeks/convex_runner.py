"""Convex job runner — claims jobs from ``agent_jobs`` and dispatches.

Runs as a daemon thread alongside the existing Supabase ``job_queue``-based
Chrome-extension drain. The two drains are intentionally separate:

  - ``job_queue.py`` (Supabase, AI-8345)    — Chrome-extension HTTP fetches
  - ``convex_runner.py`` (Convex, AI-9449)  — Mac daemon native work

Job types this runner handles:

    send_imessage         — outbound iMessage via BlueBubbles
    send_hinge            — outbound Hinge via SendBird
    obsidian_sync_one     — re-sync one People/<file>.md
    enrich_person         — refresh comms_profiler / interests for a person
    cadence_evaluate_one  — manually trigger a cadence-runner pass per person

Drafting (Claude API) happens here, on the worker thread, NOT on the
cadence-runner thread — that way a Claude API failure produces a clean
``fail()`` + retry, rather than a silent drop.

Linear: AI-9449.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

from clapcheeks.convex_client import fleet_user_id, query
from clapcheeks.convex_jobs import claim, complete, fail

log = logging.getLogger("clapcheeks.convex_runner")

CONVEX_RUNNER_INTERVAL_SECONDS = int(os.environ.get("CC_CONVEX_RUNNER_INTERVAL", "5"))
CONVEX_RUNNER_LOCK_SECONDS = int(os.environ.get("CC_CONVEX_RUNNER_LOCK", "120"))


# ---------------------------------------------------------------------------
# Reply drafting via Anthropic Claude
# ---------------------------------------------------------------------------
def _build_system_prompt(person: dict) -> str:
    interests = ", ".join(person.get("interests") or []) or "—"
    goals = ", ".join(person.get("goals") or []) or "—"
    values = ", ".join(person.get("values") or []) or "—"
    style = person.get("communication_style") or "warm, casual, real-person texting"
    cadence = person.get("cadence_profile") or "warm"
    return (
        "You are drafting a single message to one specific person. Output "
        "ONLY the message text — no preamble, no analysis, no quotes.\n\n"
        f"Person: {person.get('display_name', 'them')}\n"
        f"Their interests: {interests}\n"
        f"Their goals: {goals}\n"
        f"Their values: {values}\n"
        f"Communication style: {style}\n"
        f"Cadence profile: {cadence}\n\n"
        "RULES:\n"
        "- 1-2 sentences max. Concise like a real text.\n"
        "- No em-dashes, no semicolons.\n"
        "- Match their style — if they use 'haha' / 'lol', so do you.\n"
        "- Reference something they actually said, or move toward a real plan.\n"
        "- Never claim things about yourself you can't verify.\n"
        "- If you have nothing strong to send, output exactly: SKIP"
    )


def _recent_messages_for_person(person_id: str, limit: int = 30) -> list[dict]:
    try:
        rows = query("messages:listForPerson", {"person_id": person_id, "limit": limit}) or []
    except Exception as e:  # noqa: BLE001
        log.debug("messages:listForPerson unavailable: %s", e)
        return []
    rows.sort(key=lambda r: r.get("sent_at") or 0)
    return rows


def _draft_via_claude(person: dict, recent: list[dict]) -> str | None:
    """Return drafted message body or None to abort the send."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        log.warning("ANTHROPIC_API_KEY not set — cannot draft. Aborting.")
        return None
    try:
        from anthropic import Anthropic  # type: ignore
    except ImportError:
        log.warning("anthropic SDK not installed — cannot draft. Aborting.")
        return None

    transcript = "\n".join(
        f"{'You' if m.get('direction') == 'outbound' else 'Them'}: {m.get('body','')}"
        for m in recent[-30:]
    ) or "(no prior messages)"

    client = Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=os.environ.get("CC_CLAUDE_MODEL", "claude-sonnet-4-6"),
        max_tokens=200,
        system=_build_system_prompt(person),
        messages=[{"role": "user", "content": f"Recent thread:\n{transcript}\n\nDraft the next message to send."}],
    )
    text = "".join(b.text for b in resp.content if hasattr(b, "text")).strip()
    if not text or text.upper() == "SKIP":
        log.info("Claude declined to draft (SKIP) — aborting send")
        return None
    return text


# ---------------------------------------------------------------------------
# Job handlers
# ---------------------------------------------------------------------------
def _handle_send_imessage(payload: dict) -> dict:
    """Send an outbound iMessage via BlueBubbles. Drafts if requested.

    AI-9449 Wave 2.1: extended for touch-engine payloads —
      - person_id (looked up by ID, used to derive handle)
      - touch_type (drives prompt template selection)
      - generate_at_fire_time=True: draft at fire moment using the 4 hard rules
      - media_asset_id: attach photo/video via BlueBubbles attachment endpoint
      - prompt_template: hot_reply | context_aware_reply | date_ask_three_options |
                         event_followup | date_confirm_24h | date_dayof | date_postmortem |
                         pattern_interrupt | morning_text
    """
    handle = payload.get("handle")
    person_id = payload.get("person_id")
    person: dict | None = None

    # If handle is missing but we have a person_id, derive it.
    if not handle and person_id:
        person = query("people:get", {"id": person_id})
        if person and person.get("handles"):
            primary = next(
                (h for h in person["handles"] if h.get("primary")), None,
            ) or person["handles"][0]
            handle = primary.get("value")
    if not handle:
        raise ValueError("send_imessage payload missing 'handle' (and no person_id resolved)")

    body = payload.get("body") or payload.get("draft_body")
    needs_draft = (not body) and (
        payload.get("draft_with_claude") or payload.get("generate_at_fire_time")
    )
    if needs_draft:
        if not person_id:
            raise RuntimeError("draft requested but no person_id provided")
        if person is None:
            person = query("people:get", {"id": person_id})
        if not person:
            raise RuntimeError(f"person {person_id} not found for drafting")
        recent = _recent_messages_for_person(str(person_id))
        template = (payload.get("prompt_template") or "context_aware_reply").lower()
        body = _draft_with_template(person, recent, template, payload)
        if not body:
            return {"skipped": True, "reason": "draft_skipped", "template": template}
        # AI-9500-D: boundary_violation sentinel returned when regeneration also failed.
        if body == "__BOUNDARY_VIOLATION__":
            return {"skipped": True, "reason": "boundary_violation", "template": template}

    if not body:
        raise ValueError("send_imessage payload requires body or generate_at_fire_time=True")

    # Send via BlueBubbles. Optional media attachment.
    from clapcheeks.imessage.bluebubbles import BlueBubblesClient
    line = int(payload.get("line", 1))
    bb = BlueBubblesClient.from_env()

    media_asset_id = payload.get("media_asset_id")
    media_path: str | None = None
    media_storage_url: str | None = None
    if media_asset_id:
        # Look up storage_url via Convex; download to /tmp; pass to BB.
        asset = query("media_assets:get", {"id": media_asset_id})
        if asset and asset.get("approval_status") == "approved":
            media_storage_url = asset.get("storage_url")
            try:
                media_path = _download_to_tmp(media_storage_url, asset.get("mime_type") or "image/jpeg")
            except Exception as e:  # noqa: BLE001
                log.warning("media download failed asset_id=%s: %s", media_asset_id, str(e)[:120])
                media_path = None

    if media_path:
        result = _bb_send_with_attachment(bb, handle, body, line, media_path)
    else:
        result = bb.send_text(handle=handle, text=body, line=line)

    # Record media use if any.
    if media_asset_id and media_path:
        try:
            from clapcheeks.convex_client import mutation as cm
            cm("media:recordUse", {
                "user_id": fleet_user_id(),
                "asset_id": media_asset_id,
                "person_id": person_id,
                "sent_at": int(time.time() * 1000),
                "message_external_guid": result.get("guid"),
                "fire_context": payload.get("touch_type") or "manual",
            })
        except Exception as e:  # noqa: BLE001
            log.warning("media:recordUse failed: %s", str(e)[:120])

    return {
        "sent": True, "guid": result.get("guid"),
        "transport": "bluebubbles",
        "media_asset_id": media_asset_id,
        "template": payload.get("prompt_template"),
    }


def _download_to_tmp(url: str, mime_type: str) -> str:
    """Download a media URL to /tmp and return path."""
    import urllib.request
    import tempfile
    ext = ".jpg"
    if "png" in mime_type: ext = ".png"
    elif "mp4" in mime_type: ext = ".mp4"
    elif "gif" in mime_type: ext = ".gif"
    elif "webm" in mime_type: ext = ".webm"
    fd, path = tempfile.mkstemp(prefix="ccmedia_", suffix=ext)
    os.close(fd)
    with urllib.request.urlopen(url, timeout=60) as r:
        with open(path, "wb") as f:
            f.write(r.read())
    return path


def _bb_send_with_attachment(bb, handle: str, text: str, line: int, media_path: str) -> dict:
    """BlueBubbles attachment send. Falls back to text-only if BB doesn't expose
    the attachment endpoint."""
    if hasattr(bb, "send_attachment"):
        return bb.send_attachment(handle=handle, text=text, line=line, file_path=media_path)
    # Best-effort manual call against /api/v1/message/attachment.
    import requests  # type: ignore
    base = (os.environ.get("BLUEBUBBLES_URL") or "").rstrip("/")
    pw = os.environ.get("BLUEBUBBLES_PASSWORD") or ""
    if not base or not pw:
        log.warning("BB attachment unavailable (no env) — sending text only")
        return bb.send_text(handle=handle, text=text, line=line)
    try:
        with open(media_path, "rb") as f:
            files = {"attachment": f}
            data = {
                "chatGuid": f"iMessage;-;{handle}",
                "tempGuid": f"cc-{int(time.time()*1000)}",
                "name": os.path.basename(media_path),
                "message": text,
            }
            r = requests.post(
                f"{base}/api/v1/message/attachment?password={pw}",
                files=files, data=data, timeout=60,
            )
            r.raise_for_status()
            return r.json().get("data") or {}
    except Exception as e:  # noqa: BLE001
        log.warning("BB attachment failed, falling back to text: %s", str(e)[:120])
        return bb.send_text(handle=handle, text=text, line=line)


# ---------------------------------------------------------------------------
# Reply templates — implements the 4 hard rules for "feels seen, heard, understood".
# ---------------------------------------------------------------------------
def _free_slot_options(limit: int = 4, preferred_hours: tuple = (18, 19, 20)) -> list[str]:
    """Pull upcoming free slots from Convex calendar_slots cache.
    Filter to slots in preferred_hours range. Return human-friendly labels."""
    try:
        rows = query("calendar:listFreeSlots", {
            "user_id": fleet_user_id(),
            "horizon_days": 14,
            "limit": 60,
        }) or []
    except Exception as e:  # noqa: BLE001
        log.debug("calendar:listFreeSlots failed: %s", str(e)[:100])
        return []
    import datetime
    out: list[str] = []
    seen_days: set[str] = set()
    for r in rows:
        try:
            dt = datetime.datetime.fromtimestamp(r["slot_start_ms"] / 1000)
        except Exception:  # noqa: BLE001
            continue
        if dt.hour not in preferred_hours:
            continue
        day_key = dt.strftime("%Y-%m-%d")
        if day_key in seen_days:
            continue
        seen_days.add(day_key)
        out.append(r.get("label_local") or dt.strftime("%a %-I%p"))
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------------------
# AI-9500-D: Boundary-to-banned-tokens map.
# Maps substrings in boundaries_stated to sets of tokens that MUST NOT appear
# in the draft. Used by _validate_draft_boundaries() below.
# Configurable via CC_BOUNDARY_BANNED_TOKENS env var (JSON dict) to override
# or extend without redeploying.
# ---------------------------------------------------------------------------
_DEFAULT_BOUNDARY_BANNED_TOKENS: dict[str, list[str]] = {
    "drink": ["drink", "wine", "beer", "alcohol", "shots", "cocktail", "bourbon",
              "whiskey", "vodka", "tequila", "drunk", "tipsy", "bar tab"],
    "alcohol": ["drink", "wine", "beer", "alcohol", "shots", "cocktail", "bourbon",
                "whiskey", "vodka", "tequila", "drunk", "tipsy", "bar tab"],
    "wine": ["wine", "drink", "alcohol", "beer"],
    "beer": ["beer", "drink", "alcohol", "wine"],
    "sober": ["drink", "wine", "beer", "alcohol", "shots", "cocktail", "bar"],
    "late night": ["late night", "late-night", "tonight late", "after midnight",
                   "booty call", "come over late", "2am", "3am"],
    "late": ["late night", "after midnight", "2am", "3am", "booty call"],
    "slow": ["slow it down", "rushing", "too fast", "too soon", "move faster",
             "already", "so quick"],
    "slow it down": ["rushing", "too fast", "too soon", "move faster", "already", "so quick"],
    "religion": ["church", "mosque", "bible", "quran", "pray", "pastor", "sermon"],
    "kids": ["kids", "children", "baby", "babies", "pregnant", "have kids"],
    "no kids": ["kids", "children", "baby", "babies", "pregnant", "have kids"],
    "politics": ["vote", "republican", "democrat", "political", "election", "liberal",
                 "conservative"],
    "meat": ["steak", "burger", "barbecue", "bbq", "bacon", "chicken wings"],
    "vegan": ["meat", "steak", "burger", "chicken", "beef", "pork", "seafood", "fish"],
}


def _get_boundary_banned_tokens() -> dict[str, list[str]]:
    """Return the boundary→tokens map, merged with CC_BOUNDARY_BANNED_TOKENS env override."""
    import json as _json
    base = dict(_DEFAULT_BOUNDARY_BANNED_TOKENS)
    override_raw = os.environ.get("CC_BOUNDARY_BANNED_TOKENS", "").strip()
    if override_raw:
        try:
            extra = _json.loads(override_raw)
            if isinstance(extra, dict):
                base.update(extra)
        except Exception:  # noqa: BLE001
            log.warning("CC_BOUNDARY_BANNED_TOKENS is not valid JSON — using defaults")
    return base


def _validate_draft_boundaries(draft: str, boundaries: list[str]) -> list[str]:
    """Return the list of banned tokens found in the draft based on stated boundaries.

    Matching is case-insensitive substring. Returns [] if draft is clean.
    """
    if not draft or not boundaries:
        return []
    token_map = _get_boundary_banned_tokens()
    draft_lower = draft.lower()
    violations: list[str] = []
    for boundary in boundaries:
        boundary_lower = boundary.lower()
        # Try exact match first, then substring match against the map keys.
        banned_for_this: list[str] = []
        if boundary_lower in token_map:
            banned_for_this = token_map[boundary_lower]
        else:
            for key, tokens in token_map.items():
                if key in boundary_lower or boundary_lower in key:
                    banned_for_this.extend(tokens)
        for token in banned_for_this:
            if token.lower() in draft_lower and token not in violations:
                violations.append(token)
    return violations


# ---------------------------------------------------------------------------
# AI-9500-F: Pattern-interrupt sub-style templates + DISC-based selector.
# ---------------------------------------------------------------------------
# Five calibrated sub-styles for pattern_interrupt, each <=140 chars and
# targeting a different re-engagement energy.
#
# Sub-style → use-case mapping:
#   callback          - universal safe choice; references something she said.
#                       Triggered by: neutral/unknown DISC, any stage.
#   meme_reference    - playful cultural hook to restart fun energy.
#                       Triggered by: high-I (Influence), early_chat/phone_swap.
#   low_pressure_check_in - super-soft on-ramp, zero pressure.
#                       Triggered by: high-S (Steadiness), ghosted/dormant stage.
#   bold_direct       - confident direct re-opener with mild challenge energy.
#                       Triggered by: high-D (Dominance), first_date_done/ongoing.
#   seasonal_hook     - ties into a current season, event, or trending moment.
#                       Triggered by: high-C (Conscientiousness), cold conversation.
#
# Each template is a Jinja-like format string; available slots:
#   {name}       - person's display_name (first word)
#   {callback}   - first item from references_to_callback[] if available, else "(something she mentioned)"
#   {topic}      - first item from things_she_loves[] if available, else "(something she loves)"
#   {stage}      - courtship_stage value
#
# Templates are kept <=140 chars to fit SMS + iMessage previews comfortably.
_PATTERN_INTERRUPT_TEMPLATES: dict[str, str] = {
    "callback": (
        "hey, random thought — you mentioned {callback} a while back. "
        "did that ever end up happening?"
    ),
    "meme_reference": (
        "this is your sign to text me back lol "
        "(also genuinely — how's {topic} going?)"
    ),
    "low_pressure_check_in": (
        "hey no pressure at all — just wanted to say hope you're doing well. "
        "what's been good lately?"
    ),
    "bold_direct": (
        "alright I'll be real — it's been a minute. "
        "what's the story, {name}?"
    ),
    "seasonal_hook": (
        "thought of you when I saw something about {topic} — "
        "how are things going on your end?"
    ),
}


def _pick_pattern_interrupt_substyle(person: dict) -> str:
    """Choose the best pattern-interrupt sub-style for a person.

    AI-9500-F — Selection logic:

    Resolution order:
      1. courtship_stage hard override:
           ghosted | ended | dormant  → low_pressure_check_in
           matched                    → meme_reference (early low-stakes vibe)
      2. disc_primary (operator-set) → DISC map
      3. disc_inference (LLM-inferred string like "D/I" or "I") → first letter → DISC map
      4. Fallback → "callback" (universally safe; references her own words)

    DISC map:
      D (Dominance)     → bold_direct    (direct, confident, slight challenge)
      I (Influence)     → meme_reference (playful, pop-culture hook)
      S (Steadiness)    → low_pressure_check_in (soft, no pressure)
      C (Conscientiousness) → seasonal_hook (concrete, timely peg)
    """
    _DISC_TO_SUBSTYLE: dict[str, str] = {
        "D": "bold_direct",
        "I": "meme_reference",
        "S": "low_pressure_check_in",
        "C": "seasonal_hook",
    }
    _STAGE_TO_SUBSTYLE: dict[str, str] = {
        "ghosted": "low_pressure_check_in",
        "ended": "low_pressure_check_in",
        "matched": "meme_reference",
    }

    stage = (person.get("courtship_stage") or "").lower()
    if stage in _STAGE_TO_SUBSTYLE:
        return _STAGE_TO_SUBSTYLE[stage]

    disc = (
        person.get("disc_primary")
        or person.get("disc_inference")
        or ""
    )
    primary = (disc or "").strip().upper()
    # Handle composite "D/I" or "IS" — take first char.
    if primary:
        primary = primary[0]
    if primary in _DISC_TO_SUBSTYLE:
        return _DISC_TO_SUBSTYLE[primary]

    return "callback"


def _render_pattern_interrupt_template(substyle: str, person: dict) -> str:
    """Render the chosen sub-style template with person context slots.

    Fills {name}, {callback}, {topic}, {stage} from person fields.
    Falls back to safe generic values when fields are missing.
    """
    name_raw = (person.get("display_name") or "hey").split()[0]
    callbacks = person.get("references_to_callback") or []
    callback_val = callbacks[0] if callbacks else "something she mentioned"
    loves = person.get("things_she_loves") or []
    topic_val = loves[0] if loves else "something she loves"
    stage_val = person.get("courtship_stage") or "early_chat"

    tpl = _PATTERN_INTERRUPT_TEMPLATES.get(substyle, _PATTERN_INTERRUPT_TEMPLATES["callback"])
    try:
        return tpl.format(
            name=name_raw,
            callback=callback_val,
            topic=topic_val,
            stage=stage_val,
        )
    except KeyError:
        return tpl  # return raw if unexpected placeholder


def _build_pattern_interrupt_substyle_context(person: dict, payload: dict) -> str:
    """Return an additional system-prompt section guiding the LLM toward the
    correct sub-style when template=pattern_interrupt.

    Called from _draft_with_template's template_prompts dict.
    The substyle is read from payload['template_id'] (set by
    sweepFatigueDetection in enrichment.ts), or computed on the fly via
    _pick_pattern_interrupt_substyle if not present.
    """
    substyle = (payload.get("template_id") or "").strip().lower()
    if substyle not in _PATTERN_INTERRUPT_TEMPLATES:
        substyle = _pick_pattern_interrupt_substyle(person)

    example = _render_pattern_interrupt_template(substyle, person)

    sub_style_guidance: dict[str, str] = {
        "callback": (
            "SUB-STYLE: callback. Reference a SPECIFIC thing she said or shared earlier. "
            "Show her you were paying attention. Don't make it feel like a sales follow-up."
        ),
        "meme_reference": (
            "SUB-STYLE: meme_reference. Lead with a playful, culturally-aware hook "
            "(a reference to something trending, or a light joke). Keep it low-stakes — "
            "it should feel like a funny text from a friend, not a pick-up line."
        ),
        "low_pressure_check_in": (
            "SUB-STYLE: low_pressure_check_in. Zero pressure. She should feel like she "
            "can reply with one word and it's fine. Warm but completely non-demanding. "
            "Don't reference the silence or ask why she hasn't replied."
        ),
        "bold_direct": (
            "SUB-STYLE: bold_direct. Direct and confident — acknowledge the gap with a "
            "light, amused tone, then pivot immediately to something interesting. "
            "No apologies, no over-explaining."
        ),
        "seasonal_hook": (
            "SUB-STYLE: seasonal_hook. Tie the message to something timely — "
            "a season, a holiday, a trending event, or something that's happening 'right now'. "
            "Make it feel spontaneous, like this moment reminded you of her."
        ),
    }

    guidance = sub_style_guidance.get(substyle, sub_style_guidance["callback"])
    return (
        f"\n\n## Pattern-Interrupt Sub-Style\n"
        f"{guidance}\n\n"
        f"Example for inspiration (adapt, don't copy verbatim):\n"
        f'  "{example}"\n'
        f"\nRemember: <=140 chars. Output ONLY the message text."
    )


def _draft_with_template(person: dict, recent: list[dict], template: str, payload: dict) -> str | None:
    """Generate the actual outbound text via the LLM cascade, using the
    requested template's system prompt. Templates encode the 4 hard rules:
      1. Reference at least one specific thing from prior messages
      2. Match her current emotional state
      3. End with one specific question OR observation
      4. Don't pivot to Julian unless asked

    Templates supported:
      hot_reply, context_aware_reply, date_ask_three_options,
      event_followup, date_confirm_24h, date_dayof, date_postmortem,
      pattern_interrupt, morning_text, ghost_recovery, callback_reference

    AI-9500-D additions:
      - boundaries_stated injected as ## HARD RULES — DO NOT VIOLATE section
        in the system prompt.
      - Post-draft validation: if the draft contains any banned-phrase token
        mapped to a stated boundary, regenerate ONCE; if still violating,
        skip with fail_reason="boundary_violation".

    AI-9500-F additions:
      - pattern_interrupt template dispatches to one of 5 calibrated sub-styles
        (callback, meme_reference, low_pressure_check_in, bold_direct, seasonal_hook)
        based on payload['template_id'] or _pick_pattern_interrupt_substyle(person).
    """
    # Last emotional state from person row (set by inbound interpreter).
    states = person.get("emotional_state_recent") or []
    last_state = states[-1].get("state") if states else "neutral"
    interests = ", ".join(person.get("interests") or []) or "—"
    style = person.get("communication_style") or "warm, casual texting"
    stage = person.get("courtship_stage") or "early_chat"
    pdetails = "; ".join(
        d.get("fact", "") for d in (person.get("personal_details") or [])[-8:]
    ) or "(none yet)"
    pending_qs = [
        q.get("question") for q in (person.get("curiosity_ledger") or [])
        if q.get("status") == "pending"
    ][:3]
    things_loves = ", ".join((person.get("things_she_loves") or [])[:5])
    # AI-9500-D: boundaries_stated drives both the system prompt injection and
    # the post-draft validation pass.
    boundaries_stated: list[str] = (person.get("boundaries_stated") or [])[:10]
    boundaries_display = ", ".join(boundaries_stated) or "(none stated)"

    # AI-9500-D: Build a HARD RULES block from boundaries_stated that gets
    # appended to the system prompt BEFORE the template-specific instructions.
    # This ensures the LLM sees stated limits as strict constraints.
    BOUNDARY_RULES_SECTION = ""
    if boundaries_stated:
        rules_lines = "\n".join(f"  - {b}" for b in boundaries_stated)
        BOUNDARY_RULES_SECTION = (
            "\n\n## HARD RULES — DO NOT VIOLATE\n"
            "She has explicitly stated the following limits. Violating ANY of these\n"
            "will cause the message to be rejected and regenerated. NEVER reference\n"
            "or imply anything related to:\n"
            f"{rules_lines}\n"
            "If the context naturally leads toward any of these topics, steer away\n"
            "or end with a neutral question instead."
        )

    # Template-specific override prompts.
    HARD_RULES_HEADER = (
        "HARD RULES (in this order):\n"
        f"1. Reference at least one SPECIFIC thing from prior messages OR personal details.\n"
        f"   No generic 'how's your week?'.\n"
        f"2. Match her current emotional state: {last_state}.\n"
        "   - stressed/anxious -> soft, no pressure, hold space\n"
        "   - excited/proud    -> match energy, celebrate with her\n"
        "   - vulnerable       -> warm, no advice, name what you noticed\n"
        "   - playful/flirty   -> tease back, extend the bit\n"
        "   - bored            -> change topic or escalate\n"
        "   - neutral          -> curious, light, end on a question\n"
        f"3. End with one question OR observation. If question, it MUST reference\n"
        "   something specific to her — never generic.\n"
        "4. Don't talk about Julian unless she asked. Mirror-and-extend her topic.\n"
        "5. <=240 chars. Match her message length style. No em-dashes, no semicolons.\n"
    )
    PERSON_SNAP = (
        f"\nPerson context:\n"
        f"  Display name: {person.get('display_name', 'her')}\n"
        f"  Courtship stage: {stage}\n"
        f"  Interests: {interests}\n"
        f"  Things she loves (observed): {things_loves or '(none yet)'}\n"
        f"  Boundaries stated: {boundaries_display}\n"
        f"  Personal details we've learned: {pdetails}\n"
        f"  Style: {style}\n"
    )

    template_prompts = {
        "hot_reply": (
            "She just sent a HIGH-INTEREST message — extended length, asked questions back, "
            "future-tense words, or sexual undertone. Capture the moment with a fast, sharp reply.\n"
            + HARD_RULES_HEADER + PERSON_SNAP + BOUNDARY_RULES_SECTION
        ),
        "context_aware_reply": (
            "Draft the next text reply.\n" + HARD_RULES_HEADER + PERSON_SNAP +
            (f"\nPending curiosity question to ask if natural: {pending_qs[0] if pending_qs else '(none)'}") +
            BOUNDARY_RULES_SECTION
        ),
        "date_ask_three_options": (
            "Time to propose a date. Generate ONE message that subtly proposes meeting up. "
            "Offer 1-3 specific time/place options from Julian's REAL availability below. "
            "Reference something she actually likes. Keep it casual, not desperate. "
            "Calibrate flex_level to courtship_stage.\n"
            + HARD_RULES_HEADER + PERSON_SNAP +
            f"\nThings she's lit up about: {things_loves}\n"
            f"Julian's actual free evening windows: {_free_slot_options() or '(no fresh availability — propose general timeframes)'}\n"
            "Format: lead with a callback line, then the proposal. Example: "
            "'btw you mentioned that taco place... Thu 7pm or Sat 8pm work for you?'"
            + BOUNDARY_RULES_SECTION
        ),
        "event_followup": (
            "She mentioned an event happening today/yesterday. Check in lightly.\n"
            + HARD_RULES_HEADER + PERSON_SNAP +
            f"\nRecent events she mentioned: {[e.get('event') for e in (person.get('recent_life_events') or [])[-5:]]}" +
            BOUNDARY_RULES_SECTION
        ),
        "date_confirm_24h": (
            "There's a date scheduled in the next ~24h. Send a confirming check-in. "
            "Keep it warm, not insecure.\n"
            + HARD_RULES_HEADER + PERSON_SNAP + BOUNDARY_RULES_SECTION
        ),
        "date_dayof": (
            "Date is today. Quick logistics-confirm or excited-to-see-you note.\n"
            + HARD_RULES_HEADER + PERSON_SNAP + BOUNDARY_RULES_SECTION
        ),
        "date_postmortem": (
            "Date happened yesterday/last night. Reach out warmly the morning after, "
            "reference something specific from the date itself if possible.\n"
            + HARD_RULES_HEADER + PERSON_SNAP + BOUNDARY_RULES_SECTION
        ),
        # AI-9500-F: pattern_interrupt now dispatches to one of 5 sub-styles.
        # _build_pattern_interrupt_substyle_context() reads payload['template_id']
        # (set by sweepFatigueDetection in enrichment.ts) or falls back to
        # _pick_pattern_interrupt_substyle() based on DISC + courtship_stage.
        "pattern_interrupt": (
            "Conversation has gone cold (5+ days silent or declining engagement). "
            "Send a low-pressure pattern interrupt that re-establishes the spark. "
            "Reference something specific she said — show you remember.\n"
            + HARD_RULES_HEADER + PERSON_SNAP + BOUNDARY_RULES_SECTION
            + _build_pattern_interrupt_substyle_context(person, payload)
        ),
        "morning_text": (
            "Casual morning check-in. Light, specific, ends on a question.\n"
            + HARD_RULES_HEADER + PERSON_SNAP + BOUNDARY_RULES_SECTION
        ),
        "ghost_recovery": (
            "She went silent. Pick a specific memory from prior messages and surface it. "
            "Don't accuse her of ghosting; just reference something cool she shared.\n"
            + HARD_RULES_HEADER + PERSON_SNAP + BOUNDARY_RULES_SECTION
        ),
        "callback_reference": (
            "She mentioned something interesting earlier in the thread. "
            "Reach out specifically to ask about it — show that you actually paid attention.\n"
            + HARD_RULES_HEADER + PERSON_SNAP + BOUNDARY_RULES_SECTION
        ),
    }
    system_prompt = template_prompts.get(template) or template_prompts["context_aware_reply"]

    transcript = "\n".join(
        f"{'You' if m.get('direction') == 'outbound' else 'Her'}: {m.get('body','')[:240]}"
        for m in recent[-30:]
    ) or "(no prior messages)"
    user_prompt = f"Recent thread (oldest -> newest):\n{transcript}\n\nDraft the next message — output ONLY the message text, no quotes, no preamble."

    # Use the LLM cascade. We need plain text, not JSON. Reuse the cascade
    # logic by routing to text providers.
    draft = _llm_text(system_prompt, user_prompt, max_tokens=240)
    if not draft:
        return None

    # AI-9500-D: Post-draft boundary validation pass.
    # If boundaries_stated is non-empty, scan the draft for banned tokens.
    # On violation: regenerate ONCE with an explicit failure note prepended to
    # the user_prompt. If still violating after the retry, return None so the
    # caller marks the job as skip/fail with reason "boundary_violation".
    if boundaries_stated:
        violations = _validate_draft_boundaries(draft, boundaries_stated)
        if violations:
            violation_list = ", ".join(f'"{v}"' for v in violations)
            person_name = person.get("display_name", "her")
            log.info(
                "boundary_violation in draft for %s (tokens: %s) — regenerating once",
                person_name, violation_list,
            )
            retry_user_prompt = (
                f"REGENERATE — previous draft violated her stated boundaries by containing: "
                f"{violation_list}. She has explicitly said: "
                f"{'; '.join(boundaries_stated)}. "
                f"Produce a new message that avoids ALL of these topics entirely.\n\n"
                + user_prompt
            )
            draft = _llm_text(system_prompt, retry_user_prompt, max_tokens=240)
            if not draft:
                return None
            retry_violations = _validate_draft_boundaries(draft, boundaries_stated)
            if retry_violations:
                log.warning(
                    "boundary_violation persists after retry for %s (tokens: %s) — skipping send",
                    person_name, ", ".join(f'"{v}"' for v in retry_violations),
                )
                # Signal to caller via a special sentinel so _handle_send_imessage
                # can mark the job with skip_reason="boundary_violation".
                return "__BOUNDARY_VIOLATION__"

    return draft


def _llm_text(system_prompt: str, user_prompt: str, *, max_tokens: int = 240) -> str | None:
    """Plain-text variant of _llm_json. Cascade order matches that fn."""
    import json as _json
    import urllib.request
    import urllib.error

    def try_anthropic() -> str | None:
        key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not key:
            return None
        try:
            from anthropic import Anthropic  # type: ignore
        except ImportError:
            return None
        try:
            c = Anthropic(api_key=key)
            resp = c.messages.create(
                model=os.environ.get("CC_REPLY_MODEL_ANTHROPIC", "claude-sonnet-4-6"),
                max_tokens=max_tokens, system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            return "".join(b.text for b in resp.content if hasattr(b, "text")).strip() or None
        except Exception as e:  # noqa: BLE001
            log.warning("anthropic text failed: %s", str(e)[:200])
            return None

    def try_gemini() -> str | None:
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not key:
            return None
        model = os.environ.get("CC_REPLY_MODEL_GEMINI", "gemini-2.0-flash")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        body = {
            "contents": [{"parts": [{"text": f"{system_prompt}\n\n{user_prompt}"}]}],
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": max_tokens},
        }
        req = urllib.request.Request(url, data=_json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                resp = _json.loads(r.read())
            return resp["candidates"][0]["content"]["parts"][0]["text"].strip() or None
        except Exception as e:  # noqa: BLE001
            log.warning("gemini text failed: %s", str(e)[:200])
            return None

    def try_openai_compat(api_url: str, key: str, model: str) -> str | None:
        body = {
            "model": model, "max_tokens": max_tokens, "temperature": 0.7,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        req = urllib.request.Request(api_url, data=_json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
                                     method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                resp = _json.loads(r.read())
            return resp["choices"][0]["message"]["content"].strip() or None
        except Exception as e:  # noqa: BLE001
            log.warning("LLM text failed (%s): %s", api_url, str(e)[:200])
            return None

    explicit = (os.environ.get("CC_LLM_PROVIDER") or "").strip().lower()
    providers = {
        "anthropic": try_anthropic, "gemini": try_gemini,
        "deepseek": lambda: try_openai_compat(
            "https://api.deepseek.com/chat/completions",
            os.environ.get("DEEPSEEK_API_KEY", "").strip(),
            os.environ.get("CC_REPLY_MODEL_DEEPSEEK", "deepseek-chat"),
        ) if os.environ.get("DEEPSEEK_API_KEY") else None,
        "grok": lambda: try_openai_compat(
            "https://api.x.ai/v1/chat/completions",
            os.environ.get("XAI_API_KEY", "").strip(),
            os.environ.get("CC_REPLY_MODEL_GROK", "grok-2-latest"),
        ) if os.environ.get("XAI_API_KEY") else None,
    }
    if explicit and explicit in providers:
        result = providers[explicit]()
        if result:
            return result
    for name in ("anthropic", "gemini", "deepseek", "grok"):
        result = providers[name]()
        if result:
            return result
    return None


def _handle_fetch_calendar_slots(payload: dict) -> dict:
    """Pull Julian's free-busy from gws calendars; write to Convex calendar_slots.

    Calendars to check (per ~/.claude/CLAUDE.md scheduling rules):
      primary, CONSULTING, SALES CALLS, Work IN THE Business

    Strategy:
      - Use gws calendar freeBusy or events.list across all 4 calendars
      - Treat any event as "busy" between its start_ms and end_ms
      - Generate "free" slots in active hours (8-22 Pacific) on each day
        within the window that have NO overlapping busy events
      - Discretize free into 1h windows on hour boundaries
    """
    import json, subprocess, datetime, zoneinfo

    user_id = fleet_user_id()
    window_start = int(payload.get("window_start_ms") or int(time.time() * 1000))
    window_end = int(payload.get("window_end_ms") or window_start + 14 * 24 * 3600 * 1000)
    tz_name = os.environ.get("CC_TZ", "America/Los_Angeles")
    tz = zoneinfo.ZoneInfo(tz_name)

    # Calendars Julian wants for dating ops:
    #   - julian@aiacrobatics.com primary (work / aiacrobatics busy blocker)
    #   - "Calendar for Fun" (personal social calendar — both busy and as the
    #     destination for confirmed dates)
    # Override either via env so we don't have to redeploy when the calendar
    # list shifts.
    #
    # CC_BUSY_CALENDARS  — comma-separated calendar IDs / names to read for busy
    #                       (default: "primary,Calendar for Fun")
    # CC_FUN_CALENDAR    — calendar where confirmed dates get written
    #                       (default: "Calendar for Fun")
    # GWS_PROFILE_DIR    — gws profile directory for julian@aiacrobatics.com
    # Defaults to Julian's work primary + the existing "Dating" calendar in his
    # aiacrobatics workspace (calendar id verified 2026-05-06). Override either
    # via env without redeploying.
    busy_cal_csv = os.environ.get(
        "CC_BUSY_CALENDARS",
        "julian@aiacrobatics.com,c_3084e8452ab4cd8bad2d7a18411144ebb54765a5462d3a8c79375b3041e35bf2@group.calendar.google.com",
    )
    calendars = [c.strip() for c in busy_cal_csv.split(",") if c.strip()]
    busy_intervals: list[tuple[int, int]] = []
    cal_results: dict[str, dict] = {}
    for cal in calendars:
        try:
            params = {
                "calendarId": cal,
                "timeMin": _iso_from_ms(window_start, tz),
                "timeMax": _iso_from_ms(window_end, tz),
                "maxResults": 100,
                "singleEvents": True,
                "orderBy": "startTime",
            }
            cmd = [
                "gws", "calendar", "events", "list",
                "--params", json.dumps(params),
            ]
            env = os.environ.copy()
            # Mac Mini keeps the gws profile in ~/.config/gws-profiles/workspace
            # (copied from VPS workspace profile). VPS keeps it in fleet-config.
            # Auto-detect by trying $HOME first, then VPS path.
            home_profile = os.path.expanduser("~/.config/gws-profiles/workspace")
            default_profile = (home_profile if os.path.isdir(home_profile)
                               else "/opt/agency-workspace/.fleet-config/google-cloud/gws/profiles/workspace")
            env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = os.environ.get("GWS_PROFILE_DIR", default_profile)
            # File keyring backend — needed on macOS where the default OS keyring
            # requires GUI interaction (fails over SSH / launchd).
            env.setdefault("GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND", "file")
            r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=30)
            if r.returncode != 0:
                log.warning("gws calendar %s failed: %s", cal, r.stderr[:200])
                cal_results[cal] = {"ok": False, "error": r.stderr[:200]}
                continue
            events = json.loads(r.stdout) if r.stdout.strip().startswith("[") else json.loads(r.stdout).get("items", [])
            cal_event_count = 0
            for ev in events:
                start_iso = (ev.get("start") or {}).get("dateTime") or (ev.get("start") or {}).get("date")
                end_iso = (ev.get("end") or {}).get("dateTime") or (ev.get("end") or {}).get("date")
                if not start_iso or not end_iso:
                    continue
                # Skip transparent events (busy=False) — Julian marks "free time" here.
                if (ev.get("transparency") or "").lower() == "transparent":
                    continue
                try:
                    sd = datetime.datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
                    ed = datetime.datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
                    busy_intervals.append((int(sd.timestamp() * 1000), int(ed.timestamp() * 1000)))
                    cal_event_count += 1
                except Exception:  # noqa: BLE001
                    continue
            cal_results[cal] = {"ok": True, "events": cal_event_count}
        except Exception as e:  # noqa: BLE001
            log.warning("gws calendar fetch %s exception: %s", cal, str(e)[:150])
            cal_results[cal] = {"ok": False, "error": str(e)[:150]}
            continue

    busy_intervals.sort()

    # Generate free slots in 1h chunks, 8-22 local, skipping busy overlaps.
    free_slots: list[dict] = []
    busy_slots: list[dict] = []
    cursor = datetime.datetime.fromtimestamp(window_start / 1000, tz=tz)
    end_dt = datetime.datetime.fromtimestamp(window_end / 1000, tz=tz)
    cursor = cursor.replace(minute=0, second=0, microsecond=0)
    while cursor < end_dt:
        hour = cursor.hour
        if 8 <= hour < 22:  # active dating hours
            slot_start = int(cursor.timestamp() * 1000)
            slot_end = int((cursor + datetime.timedelta(hours=1)).timestamp() * 1000)
            overlap = any(b[0] < slot_end and b[1] > slot_start for b in busy_intervals)
            label = cursor.strftime("%a %-I%p %Z")
            entry = {
                "slot_start_ms": slot_start, "slot_end_ms": slot_end,
                "label_local": label,
            }
            if overlap:
                busy_slots.append({**entry, "slot_kind": "busy"})
            else:
                free_slots.append({**entry, "slot_kind": "free"})
        cursor += datetime.timedelta(hours=1)

    # Cap payload size — top 50 of each kind.
    from clapcheeks.convex_client import mutation as cm
    cm("calendar:upsertSlots", {
        "user_id": user_id,
        "window_start_ms": window_start,
        "window_end_ms": window_end,
        "slots": (free_slots[:50] + busy_slots[:30]),
    })
    return {
        "free_slots": len(free_slots),
        "busy_slots": len(busy_slots),
        "calendars_checked": calendars,
        "per_calendar": cal_results,
    }


def _iso_from_ms(ms: int, tz) -> str:
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, tz=tz).isoformat()


def _handle_create_date_event(payload: dict) -> dict:
    """Create a calendar event on Julian's 'Calendar for Fun' when a date confirms.

    Payload:
      person_id, person_display_name, slot_start_ms, slot_end_ms,
      venue (optional), notes (optional), her_email (optional, for invite)
    """
    import json, subprocess, datetime
    cal_id = os.environ.get(
        "CC_FUN_CALENDAR",
        "c_3084e8452ab4cd8bad2d7a18411144ebb54765a5462d3a8c79375b3041e35bf2@group.calendar.google.com",  # Dating
    )
    home_profile = os.path.expanduser("~/.config/gws-profiles/workspace")
    profile_dir = os.environ.get(
        "GWS_PROFILE_DIR",
        home_profile if os.path.isdir(home_profile)
        else "/opt/agency-workspace/.fleet-config/google-cloud/gws/profiles/workspace",
    )
    name = payload.get("person_display_name") or "Date"
    venue = payload.get("venue")
    summary = f"Date: {name}" + (f" — {venue}" if venue else "")
    start_ms = int(payload.get("slot_start_ms"))
    end_ms = int(payload.get("slot_end_ms") or (start_ms + 90 * 60 * 1000))
    body = {
        "summary": summary,
        "description": payload.get("notes") or "",
        "start": {"dateTime": datetime.datetime.fromtimestamp(start_ms / 1000).isoformat(),
                  "timeZone": os.environ.get("CC_TZ", "America/Los_Angeles")},
        "end":   {"dateTime": datetime.datetime.fromtimestamp(end_ms / 1000).isoformat(),
                  "timeZone": os.environ.get("CC_TZ", "America/Los_Angeles")},
    }
    if payload.get("venue"):
        body["location"] = payload["venue"]
    if payload.get("her_email"):
        body["attendees"] = [{"email": payload["her_email"]}]

    env = os.environ.copy()
    env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = profile_dir
    env.setdefault("GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND", "file")
    params = {"calendarId": cal_id, "sendUpdates": "all"}
    cmd = ["gws", "calendar", "events", "insert",
           "--params", json.dumps(params),
           "--body", json.dumps(body)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=30)
        if r.returncode != 0:
            return {"failed": True, "stderr": r.stderr[:300]}
        out = json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}
        # Mark the slot in Convex.
        slot_id = payload.get("slot_id")
        if slot_id:
            try:
                from clapcheeks.convex_client import mutation as cm
                cm("calendar:markConfirmed", {"slot_id": slot_id})
            except Exception as e:  # noqa: BLE001
                log.warning("markConfirmed failed: %s", str(e)[:120])
        return {"created": True, "event_id": out.get("id"), "html_link": out.get("htmlLink")}
    except Exception as e:  # noqa: BLE001
        return {"failed": True, "exc": str(e)[:300]}


def _handle_send_digest_to_julian(payload: dict) -> dict:
    """Render the morning digest as a sequence of iMessages to Julian.

    Each item gets: name, stage, last-msg-preview, draft, urgency.
    Julian replies "send" to fire the draft via a separate flow.
    """
    from clapcheeks.imessage.bluebubbles import BlueBubblesClient

    julian_phone = os.environ.get("MY_PHONE_NUMBER", "+16195090699")
    items = (payload.get("items") or [])[:12]
    if not items:
        return {"skipped": True, "reason": "no_items"}

    bb = BlueBubblesClient.from_env()
    header = f"📋 Daily digest — {len(items)} active threads"
    bb.send_text(handle=julian_phone, text=header, line=1)

    sent = 0
    for i, item in enumerate(items, 1):
        name = item.get("display_name") or "?"
        stage = item.get("stage") or "—"
        urgency = item.get("urgency", 0)
        her_msg = (item.get("last_msg_from_her") or "(none)")[:200]
        emo = item.get("her_emotional_state") or "neutral"
        ttas = item.get("time_to_ask_score") or 0
        draft = item.get("draft_reply") or "(no draft generated)"
        nbm = item.get("next_best_move")
        details = item.get("relevant_personal_details") or []
        body = (
            f"#{i} {name} · {stage} · u={urgency:.1f}\n"
            f"💭 {emo} | ask={ttas:.2f}\n"
            f"Her: {her_msg[:140]}\n"
            f"DRAFT: {draft[:200]}\n"
            f"NBM: {(nbm or '—')[:100]}\n"
        )
        if details:
            body += f"Remembered: {' / '.join(details[:3])[:140]}"
        try:
            bb.send_text(handle=julian_phone, text=body, line=1)
            sent += 1
        except Exception as e:  # noqa: BLE001
            log.warning("digest item send failed: %s", str(e)[:120])
    return {"sent_items": sent, "total_items": len(items)}


def _handle_send_hinge(payload: dict) -> dict:
    """Send an outbound Hinge SendBird message."""
    channel_url = payload.get("sendbird_channel_url")
    if not channel_url:
        raise ValueError("send_hinge payload missing 'sendbird_channel_url'")

    body = payload.get("body")
    if not body and payload.get("draft_with_claude"):
        person_id = payload.get("person_id")
        person = query("people:get", {"id": person_id}) if person_id else None
        if not person:
            raise RuntimeError(f"person {person_id} not found for drafting")
        recent = _recent_messages_for_person(str(person_id))
        body = _draft_via_claude(person, recent)
        if not body:
            return {"skipped": True, "reason": "claude_skipped"}

    if not body:
        raise ValueError("send_hinge payload requires either 'body' or 'draft_with_claude'")

    from clapcheeks.platforms.hinge_api import send_message  # type: ignore

    res = send_message(channel_url=channel_url, body=body)
    return {"sent": True, "transport": "hinge_sendbird", "result": res}


def _handle_obsidian_sync_one(payload: dict) -> dict:
    from pathlib import Path

    from clapcheeks.intel.obsidian_sync import sync_one

    rel = payload.get("obsidian_path")
    if not rel:
        raise ValueError("obsidian_sync_one missing 'obsidian_path'")
    vault = os.environ.get("OBSIDIAN_VAULT_PATH", "").strip()
    if not vault:
        raise RuntimeError("OBSIDIAN_VAULT_PATH not set")
    path = Path(vault).expanduser() / rel
    r = sync_one(path)
    return {"path": r.path, "person_id": r.person_id, "changed": r.changed, "error": r.error}


def _handle_enrich_person(payload: dict) -> dict:
    """Refresh comms_profiler output for a person.

    Loads recent messages, runs build_style_profile, writes back to
    Convex via people:updateLiveState.
    """
    from clapcheeks.conversation.comms_profiler import build_style_profile
    from clapcheeks.convex_client import mutation as cm

    person_id = payload.get("person_id")
    if not person_id:
        raise ValueError("enrich_person missing 'person_id'")
    recent = _recent_messages_for_person(str(person_id), limit=200)
    if not recent:
        return {"skipped": True, "reason": "no_messages"}
    style = build_style_profile([
        {
            "sender": "user" if m.get("direction") == "outbound" else "contact",
            "text": m.get("body") or "",
            "sent_at": m.get("sent_at"),
        }
        for m in recent
    ])
    cm("people:updateLiveState", {"person_id": person_id, "style_profile": style})
    return {"person_id": person_id, "style_keys": list(style.keys()) if isinstance(style, dict) else []}


def _handle_cadence_evaluate_one(payload: dict) -> dict:
    """Force a cadence evaluation for one person (debug / dashboard button)."""
    from clapcheeks.cadence_runner import _enqueue_for_conversation, _most_recent_conversation

    person_id = payload.get("person_id")
    if not person_id:
        raise ValueError("cadence_evaluate_one missing 'person_id'")
    person = query("people:get", {"id": person_id}) if person_id else None
    if not person:
        return {"skipped": True, "reason": "person_not_found"}
    conv = _most_recent_conversation(str(person_id))
    if not conv:
        return {"skipped": True, "reason": "no_conversation"}
    job = _enqueue_for_conversation(person, conv)
    return {"enqueued_job_id": job}


def _llm_json(system_prompt: str, user_prompt: str, *, max_tokens: int = 180) -> dict | None:
    """Provider-agnostic structured-JSON LLM call.

    Tries providers in order based on which API key is present:
      1. CC_LLM_PROVIDER env var (anthropic | gemini | grok | deepseek) — explicit
      2. ANTHROPIC_API_KEY → claude-haiku-4-5
      3. GEMINI_API_KEY    → gemini-2.0-flash
      4. DEEPSEEK_API_KEY  → deepseek-chat (cheapest, OpenAI-compatible)
      5. XAI_API_KEY       → grok-2-latest

    Returns parsed dict or None on failure. JSON-mode is enforced where the
    provider supports it (Gemini responseMimeType, DeepSeek/Grok response_format,
    Anthropic via prompt only).
    """
    import json as _json
    import urllib.request
    import urllib.error

    explicit = (os.environ.get("CC_LLM_PROVIDER") or "").strip().lower()

    def try_anthropic() -> dict | None:
        key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not key:
            return None
        try:
            from anthropic import Anthropic  # type: ignore
        except ImportError:
            return None
        try:
            c = Anthropic(api_key=key)
            resp = c.messages.create(
                model=os.environ.get("CC_VIBE_MODEL_ANTHROPIC", "claude-haiku-4-5-20251001"),
                max_tokens=max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            raw = "".join(b.text for b in resp.content if hasattr(b, "text")).strip()
        except Exception as e:  # noqa: BLE001
            log.warning("anthropic call failed: %s", str(e)[:200])
            return None
        if raw.startswith("```"):
            raw = raw.strip("`").lstrip("json").strip()
        try:
            return _json.loads(raw)
        except _json.JSONDecodeError:
            return None

    def try_gemini() -> dict | None:
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not key:
            return None
        model = os.environ.get("CC_VIBE_MODEL_GEMINI", "gemini-2.0-flash")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        body = {
            "contents": [{"parts": [{"text": f"{system_prompt}\n\n{user_prompt}"}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.1,
                "maxOutputTokens": max_tokens,
            },
        }
        req = urllib.request.Request(
            url, data=_json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                resp = _json.loads(r.read())
        except urllib.error.HTTPError as e:
            log.warning("gemini http %d: %s", e.code, e.read()[:200])
            return None
        except Exception as e:  # noqa: BLE001
            log.warning("gemini call failed: %s", str(e)[:200])
            return None
        try:
            text = resp["candidates"][0]["content"]["parts"][0]["text"]
            return _json.loads(text)
        except (KeyError, IndexError, _json.JSONDecodeError):
            return None

    def _openai_compat_call(api_url: str, key: str, model: str) -> dict | None:
        body = {
            "model": model, "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        req = urllib.request.Request(
            api_url, data=_json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                resp = _json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            log.warning("LLM call failed (%s): %s", api_url, str(e)[:200])
            return None
        try:
            text = resp["choices"][0]["message"]["content"]
            return _json.loads(text)
        except (KeyError, IndexError, _json.JSONDecodeError):
            return None

    def try_grok() -> dict | None:
        key = os.environ.get("XAI_API_KEY", "").strip()
        if not key:
            return None
        return _openai_compat_call(
            "https://api.x.ai/v1/chat/completions", key,
            os.environ.get("CC_VIBE_MODEL_GROK", "grok-2-latest"),
        )

    def try_deepseek() -> dict | None:
        key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
        if not key:
            return None
        return _openai_compat_call(
            "https://api.deepseek.com/chat/completions", key,
            os.environ.get("CC_VIBE_MODEL_DEEPSEEK", "deepseek-chat"),
        )

    providers = {
        "anthropic": try_anthropic,
        "gemini": try_gemini,
        "deepseek": try_deepseek,
        "grok": try_grok,
    }
    if explicit and explicit in providers:
        return providers[explicit]()

    # Auto-cascade: try whatever has a key, in this order.
    for name in ("anthropic", "gemini", "deepseek", "grok"):
        result = providers[name]()
        if result is not None:
            return result
    return None


def _handle_classify_conversation_vibe(payload: dict) -> dict:
    """Classify a person's conversation as dating / platonic / professional / unclear.

    Pulls last 50 messages, runs the configured LLM with a structured prompt,
    writes back via people:updateVibe. The dashboard shows results as candidates
    to add to the CC TECH Google Contacts label — never auto-applies.

    Provider order: ANTHROPIC_API_KEY -> GEMINI_API_KEY -> XAI_API_KEY (Grok).
    Override via CC_LLM_PROVIDER env (anthropic|gemini|grok).
    """
    from clapcheeks.convex_client import mutation as cm

    person_id = payload.get("person_id")
    if not person_id:
        raise ValueError("classify_conversation_vibe missing 'person_id'")
    recent = _recent_messages_for_person(str(person_id), limit=50)
    if len(recent) < 4:
        return {"skipped": True, "reason": "not_enough_messages", "count": len(recent)}

    transcript = "\n".join(
        f"{'You' if m.get('direction') == 'outbound' else 'Them'}: {m.get('body','')[:240]}"
        for m in recent[-50:]
    )
    system_prompt = (
        "You classify a 1:1 conversation transcript into ONE of four buckets:\n"
        "  dating       — romantic, flirtatious, or dating-app context\n"
        "  platonic     — friends / family / coaches / non-romantic personal\n"
        "  professional — business, work, client, vendor, contractor\n"
        "  unclear      — not enough signal to decide\n\n"
        "Output ONLY a single JSON object:\n"
        '  {"classification": "dating|platonic|professional|unclear", "confidence": 0.0-1.0, "evidence": "<one sentence quoting or paraphrasing the strongest cue>"}\n'
        "No prose. No markdown. JSON only."
    )

    parsed = _llm_json(system_prompt, f"Transcript:\n\n{transcript}")
    if parsed is None:
        return {"skipped": True, "reason": "no_llm_provider_or_all_failed"}

    classification = str(parsed.get("classification", "unclear")).strip().lower()
    if classification not in ("dating", "platonic", "professional", "unclear"):
        classification = "unclear"
    confidence = float(parsed.get("confidence", 0.0) or 0.0)
    confidence = max(0.0, min(1.0, confidence))
    evidence = str(parsed.get("evidence", "") or "")[:300]

    cm("people:updateVibe", {
        "person_id": person_id,
        "vibe_classification": classification,
        "vibe_confidence": confidence,
        "vibe_evidence": evidence or None,
    })
    return {"person_id": person_id, "classification": classification, "confidence": confidence}


def _handle_enrich_courtship(payload: dict) -> dict:
    """Read last ~100 messages of a person, output structured courtship signals.

    Populates trust_score, courtship_stage, trust_signals_observed/missing,
    things_she_loves/dislikes, boundaries_stated, green_flags, red_flags,
    compliments_that_landed, references_to_callback, her_love_languages,
    next_best_move (a sentence-long suggestion).

    The dashboard surfaces all of this so Julian can see, per-person:
      - where the relationship is right now (stage)
      - what she values (love-languages, things_she_loves)
      - what to avoid (boundaries_stated, things_she_dislikes, red_flags)
      - what's worked before (compliments_that_landed, references_to_callback)
      - the LLM's suggested next move
    """
    from clapcheeks.convex_client import mutation as cm

    person_id = payload.get("person_id")
    if not person_id:
        raise ValueError("enrich_courtship missing 'person_id'")
    recent = _recent_messages_for_person(str(person_id), limit=100)
    if len(recent) < 6:
        return {"skipped": True, "reason": "not_enough_messages", "count": len(recent)}

    transcript = "\n".join(
        f"{'You' if m.get('direction') == 'outbound' else 'Her'}: {m.get('body','')[:280]}"
        for m in recent[-100:]
    )
    system_prompt = (
        "You are a dating coach analyzing a 1:1 iMessage thread between Julian (You) "
        "and a woman (Her). Your job is to extract STRUCTURED SIGNALS Julian can use to "
        "build trust and court her better.\n\n"
        "Output ONLY a single JSON object with these fields. Use [] when nothing applies; "
        "do NOT invent data not in the transcript.\n\n"
        "{\n"
        '  "trust_score": 0.0-1.0,\n'
        '  "courtship_stage": "matched|early_chat|phone_swap|pre_date|first_date_done|ongoing|exclusive|ghosted|ended",\n'
        '  "trust_signals_observed": ["short phrase per signal", ...],\n'
        '  "trust_signals_missing": ["short phrase per concern", ...],\n'
        '  "things_she_loves": ["specific topic/activity she lit up about", ...],\n'
        '  "things_she_dislikes": [...],\n'
        '  "boundaries_stated": ["explicit statements like \\"I don\'t drink\\", \\"slow it down\\"", ...],\n'
        '  "green_flags": ["positive signs about her character", ...],\n'
        '  "red_flags": ["warning signs", ...],\n'
        '  "compliments_that_landed": ["compliments Julian gave that she responded warmly to", ...],\n'
        '  "references_to_callback": ["inside jokes / shared memories Julian could invoke later", ...],\n'
        '  "her_love_languages": ["words_of_affirmation|quality_time|receiving_gifts|acts_of_service|physical_touch", ...],\n'
        '  "next_best_move": "<one concrete next message or move, <=140 chars>",\n'
        '  "next_best_move_confidence": 0.0-1.0\n'
        "}\n\n"
        "Rules:\n"
        "- Be evidence-based. Quote or paraphrase short phrases from the transcript.\n"
        "- Empty arrays are fine. Don't pad.\n"
        "- next_best_move is concrete, not abstract. Bad: 'be patient'. Good: 'invite her to that taco place she mentioned for Saturday at 7'.\n"
        "- If the transcript is too thin to judge, return courtship_stage=\"early_chat\" and trust_score=0.3.\n"
        "- JSON only. No prose. No markdown."
    )

    parsed = _llm_json(system_prompt, f"Transcript:\n\n{transcript}", max_tokens=900)
    if parsed is None:
        return {"skipped": True, "reason": "no_llm_provider_or_all_failed"}

    # Sanitize values
    def _clamp01(x):
        try:
            return max(0.0, min(1.0, float(x)))
        except Exception:  # noqa: BLE001
            return None

    def _strs(x):
        if not isinstance(x, list):
            return None
        return [str(s)[:200] for s in x if str(s).strip()][:20]

    valid_stages = {"matched", "early_chat", "phone_swap", "pre_date",
                    "first_date_done", "ongoing", "exclusive", "ghosted", "ended"}
    stage = str(parsed.get("courtship_stage", "")).strip().lower()
    if stage not in valid_stages:
        stage = "early_chat"

    args: dict = {"person_id": person_id, "courtship_stage": stage}
    ts = _clamp01(parsed.get("trust_score"))
    if ts is not None:
        args["trust_score"] = ts
    for key in (
        "trust_signals_observed", "trust_signals_missing",
        "things_she_loves", "things_she_dislikes", "boundaries_stated",
        "green_flags", "red_flags", "compliments_that_landed",
        "references_to_callback", "her_love_languages",
    ):
        v = _strs(parsed.get(key))
        if v is not None:
            args[key] = v

    nbm = parsed.get("next_best_move")
    if nbm:
        args["next_best_move"] = str(nbm)[:300]
    nbm_conf = _clamp01(parsed.get("next_best_move_confidence"))
    if nbm_conf is not None:
        args["next_best_move_confidence"] = nbm_conf

    cm("people:updateCourtship", args)
    return {
        "person_id": person_id,
        "courtship_stage": stage,
        "trust_score": ts,
        "next_best_move": (str(nbm)[:80] if nbm else None),
    }


def _handle_google_contacts_sync_one(payload: dict) -> dict:
    """Re-sync one labeled Google Contact (e.g. after dashboard click)."""
    from clapcheeks.intel.google_contacts_sync import sync_profile

    profile = payload.get("profile") or "personal"
    label = payload.get("label") or "CC TECH"
    results = sync_profile(profile, label_name=label)
    return {
        "profile": profile,
        "processed": len(results),
        "created": sum(1 for r in results if r.created),
        "errors": sum(1 for r in results if r.error),
    }



def _handle_sync_hinge(payload: dict) -> dict:
    """AI-9507: Poll Hinge SendBird for new messages and push to Convex."""
    from clapcheeks.intel.hinge_poller import run_once
    return run_once()


HANDLERS = {
    "send_imessage": _handle_send_imessage,
    "send_hinge": _handle_send_hinge,
    "obsidian_sync_one": _handle_obsidian_sync_one,
    "enrich_person": _handle_enrich_person,
    "cadence_evaluate_one": _handle_cadence_evaluate_one,
    "classify_conversation_vibe": _handle_classify_conversation_vibe,
    "enrich_courtship": _handle_enrich_courtship,
    "google_contacts_sync_one": _handle_google_contacts_sync_one,
    "send_digest_to_julian": _handle_send_digest_to_julian,
    "fetch_calendar_slots": _handle_fetch_calendar_slots,
    "create_date_event": _handle_create_date_event,
    "sync_hinge": _handle_sync_hinge,  # AI-9507: Hinge SendBird poller
}


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def _run_one_iteration() -> bool:
    """Claim and dispatch one job. Returns True if work was done."""
    try:
        job = claim(lock_seconds=CONVEX_RUNNER_LOCK_SECONDS)
    except Exception as e:  # noqa: BLE001
        log.exception("claim failed: %s", e)
        return False

    if not job:
        return False

    job_id = str(job.get("_id"))
    job_type = str(job.get("job_type"))
    payload = job.get("payload") or {}
    handler = HANDLERS.get(job_type)
    if not handler:
        fail(job_id, f"no handler for job_type={job_type}")
        return True

    log.info("dispatch job_id=%s type=%s", job_id, job_type)
    try:
        result = handler(payload) or {}
        complete(job_id, result if isinstance(result, dict) else {"value": result})
    except Exception as e:  # noqa: BLE001
        log.exception("handler %s raised: %s", job_type, e)
        fail(job_id, str(e))
    return True


def run_forever(interval_seconds: int | None = None) -> None:
    """Daemon thread entry. Drains queued jobs as fast as it can; sleeps
    only when the queue is empty.
    """
    interval = interval_seconds or CONVEX_RUNNER_INTERVAL_SECONDS
    log.info("convex_runner thread starting (poll_interval=%ds)", interval)
    while True:
        try:
            did_work = _run_one_iteration()
        except Exception as e:  # noqa: BLE001
            log.exception("convex_runner loop error: %s", e)
            did_work = False
        if not did_work:
            time.sleep(interval)


__all__ = ["run_forever", "_run_one_iteration", "HANDLERS"]
