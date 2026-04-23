"""Phase K (AI-8339): Social graph collision detector.

Detects mutual friends between Julian and every match using three tiers:

    Tier 1 - hinge_native: match_intel['mutual_friends'] from Hinge's native
             "mutual friends" API field.
    Tier 1 - ig_overlap:   intersection of Julian's IG follower list with
             her public follower list (fetched via the Phase M extension
             queue - never scraped from the VPS).
    Tier 1 - phone_contacts: intersection of her phone number (when known)
             with Julian's iMessage/contacts DB.

Each tier contributes names + a confidence multiplier. The final detector
output is stored on clapcheeks_matches:

    mutual_friends_count    INT
    mutual_friends_list     JSONB  [{name, handle, source, confidence}]
    social_risk_band        TEXT   safe | watch | high_risk | auto_flag
    social_graph_confidence REAL   0..1
    social_graph_sources    JSONB  ["hinge_native","ig_overlap",...]
    social_graph_scanned_at TIMESTAMPTZ

Risk band thresholds are driven by the persona's
``social_graph_rules.mutual_friends_threshold`` block (stored in Supabase
for user 9c848c51-8996-4f1f-9dbf-50128e3408ea). If the persona block is
missing we fall back to the defaults documented on AI-8339:

    0-3  safe
    4-7  watch
    8-11 high_risk
    12+  auto_flag

Usage:

    from clapcheeks.social.graph import detect_mutual_friends, compute_risk_band
    result = detect_mutual_friends(match_row, julian_ig_session, julian_contacts)
    band   = compute_risk_band(result['count'], persona_rules)

The detector never raises. Any sub-tier that errors is logged and skipped
so the daemon always makes forward progress.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Iterable

logger = logging.getLogger("clapcheeks.social.graph")

# Default thresholds matching AI-8339 scope.
DEFAULT_THRESHOLDS: dict[str, tuple[int, int]] = {
    "safe":      (0, 3),
    "watch":     (4, 7),
    "high_risk": (8, 11),
    # auto_flag is (12, +inf) - handled specially below.
}


# ---------------------------------------------------------------------------
# Name / handle normalization
# ---------------------------------------------------------------------------

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
# Instagram handles legally contain underscores + dots. Strip dots + leading
# '@' but keep underscores so "jane_doe" stays "jane_doe" (that's what
# downstream callers - and tests - compare against).
_HANDLE_STRIP = re.compile(r"[^a-z0-9_]+")


def _normalize_handle(h: str | None) -> str:
    if not h:
        return ""
    h = h.strip().lower().lstrip("@")
    return _HANDLE_STRIP.sub("", h)


def _normalize_name(n: str | None) -> str:
    if not n:
        return ""
    return _NON_ALNUM.sub("", n.strip().lower())


def _normalize_phone(p: str | None) -> str:
    if not p:
        return ""
    digits = re.sub(r"\D+", "", p)
    # US numbers: trim leading '1' so '+15551234567' == '5551234567'.
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits


# ---------------------------------------------------------------------------
# Tier 1a: Hinge native mutual_friends field
# ---------------------------------------------------------------------------

def _extract_hinge_mutuals(match_intel: Any) -> list[dict[str, str]]:
    """Pull mutual-friend entries out of match_intel['mutual_friends'].

    Hinge surfaces a list like:
        [{"name": "Jane", "handle": "jane_doe"}, ...]
    or sometimes a bare count integer. We only keep dict-shaped entries
    with at least one of name/handle set.
    """
    if not match_intel or not isinstance(match_intel, dict):
        return []
    raw = match_intel.get("mutual_friends")
    if raw is None:
        return []
    if isinstance(raw, int):
        # Count-only payload - record it as an anonymous placeholder so the
        # count is captured even without names.
        return [{"name": "", "handle": "", "source": "hinge_native",
                 "confidence": 0.6}] * max(0, raw)
    if not isinstance(raw, list):
        return []

    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        handle = (item.get("handle") or item.get("username") or "").strip()
        if not name and not handle:
            continue
        out.append({
            "name": name,
            "handle": handle,
            "source": "hinge_native",
            "confidence": 0.95,
        })
    return out


# ---------------------------------------------------------------------------
# Tier 1b: IG follower overlap
# ---------------------------------------------------------------------------

def _extract_ig_followers(intel: Any) -> set[str]:
    """Pull the follower/following handles out of a stored instagram_intel
    blob, or a live ``julian_ig_session`` payload.

    We accept several shapes so we don't hard-fail on Instagram's JSON
    shuffling:
        {"followers": [{"username": "x"}, ...]}
        {"followers": ["x", "y"]}
        {"followed_by": {"edges": [{"node": {"username": "x"}}]}}
    """
    if not intel or not isinstance(intel, dict):
        return set()
    handles: set[str] = set()

    for key in ("followers", "following", "followed_by", "follows"):
        raw = intel.get(key)
        if raw is None:
            continue
        if isinstance(raw, list):
            for entry in raw:
                if isinstance(entry, str):
                    handles.add(_normalize_handle(entry))
                elif isinstance(entry, dict):
                    h = entry.get("username") or entry.get("handle")
                    if h:
                        handles.add(_normalize_handle(h))
        elif isinstance(raw, dict):
            edges = raw.get("edges") or []
            for e in edges:
                node = (e or {}).get("node") or {}
                h = node.get("username")
                if h:
                    handles.add(_normalize_handle(h))
    handles.discard("")
    return handles


def _ig_overlap(
    match_ig_intel: Any,
    julian_ig_session: dict | None,
) -> list[dict[str, str]]:
    """Intersect Julian's IG follower graph with hers.

    Caller is responsible for populating ``julian_ig_session`` from a
    previously-fetched snapshot. The VPS never scrapes IG directly - that
    data comes in via the Phase M extension queue the same way the rest
    of Phase C's enrichment does.
    """
    if not julian_ig_session:
        return []
    julian_handles = _extract_ig_followers(julian_ig_session)
    if not julian_handles:
        return []
    her_handles = _extract_ig_followers(match_ig_intel)
    if not her_handles:
        return []

    overlap = julian_handles & her_handles
    out: list[dict[str, str]] = []
    for h in sorted(overlap):
        out.append({
            "name": "",
            "handle": h,
            "source": "ig_overlap",
            "confidence": 0.85,
        })
    return out


# ---------------------------------------------------------------------------
# Tier 1c: Phone contacts overlap
# ---------------------------------------------------------------------------

def _phone_contact_overlap(
    match_row: dict,
    julian_contacts: list[str] | None,
) -> list[dict[str, str]]:
    """If we know her phone number (post-match handoff), check whether
    she appears in Julian's contact DB (iMessage address book).

    Returns at most one entry per match - this tier is binary, not a list.
    """
    if not julian_contacts:
        return []

    her_phones: set[str] = set()
    for key in ("phone", "phone_number", "her_phone"):
        val = match_row.get(key)
        if val:
            her_phones.add(_normalize_phone(val))

    # match_intel may carry a contact block too.
    intel = match_row.get("match_intel") or {}
    if isinstance(intel, dict):
        contact = intel.get("contact") or {}
        if isinstance(contact, dict):
            p = contact.get("phone") or contact.get("phone_number")
            if p:
                her_phones.add(_normalize_phone(p))

    her_phones.discard("")
    if not her_phones:
        return []

    julian_digits = {_normalize_phone(p) for p in julian_contacts}
    julian_digits.discard("")
    if her_phones & julian_digits:
        return [{
            "name": match_row.get("name") or match_row.get("match_name") or "",
            "handle": "",
            "source": "phone_contacts",
            "confidence": 0.98,
        }]
    return []


# ---------------------------------------------------------------------------
# De-duplication across tiers
# ---------------------------------------------------------------------------

def _dedupe_entries(entries: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    """Collapse duplicates so the same person counted twice across tiers
    doesn't inflate mutual_friends_count. The confidence-ordering rule:
    higher confidence wins, and the union of sources is recorded.
    """
    by_key: dict[str, dict] = {}
    for e in entries:
        key = _normalize_handle(e.get("handle")) or _normalize_name(e.get("name"))
        if not key:
            # Anonymous entries (Hinge count-only) stay separate.
            by_key[f"__anon_{len(by_key)}"] = dict(e, sources=[e["source"]])
            continue
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = dict(e, sources=[e["source"]])
        else:
            if e.get("confidence", 0) > existing.get("confidence", 0):
                existing["confidence"] = e["confidence"]
                # Prefer the higher-confidence name if we have one.
                if e.get("name"):
                    existing["name"] = e["name"]
                if e.get("handle"):
                    existing["handle"] = e["handle"]
            if e["source"] not in existing["sources"]:
                existing["sources"].append(e["source"])
    return list(by_key.values())


# ---------------------------------------------------------------------------
# Public detector entry point
# ---------------------------------------------------------------------------

def detect_mutual_friends(
    match: dict,
    julian_ig_session: dict | None = None,
    julian_contacts: list[str] | None = None,
) -> dict:
    """Run every detection tier and return an aggregate report.

    Parameters
    ----------
    match : dict
        A clapcheeks_matches row (or subset containing ``match_intel``,
        ``instagram_intel``, ``name``, ``match_id`` etc.).
    julian_ig_session : dict | None
        Julian's follower/following graph snapshot. None => skip tier 1b.
    julian_contacts : list[str] | None
        Phone numbers (any shape) from Julian's contact DB. None => skip 1c.

    Returns
    -------
    dict with keys:
        count        int - de-duped mutual-friend count
        list         list[dict] - the merged entries [{name, handle, ...}]
        confidence   float in [0, 1] - weighted-average of tier confidences
        sources      list[str]  - union of tier tags that contributed
    """
    if not isinstance(match, dict):
        logger.debug("detect_mutual_friends called with non-dict match; returning empty")
        return {"count": 0, "list": [], "confidence": 0.0, "sources": []}

    entries: list[dict[str, str]] = []

    # Tier 1a - Hinge native
    try:
        entries.extend(_extract_hinge_mutuals(match.get("match_intel")))
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("hinge mutual extraction failed: %s", exc)

    # Tier 1b - IG overlap
    try:
        entries.extend(
            _ig_overlap(match.get("instagram_intel"), julian_ig_session)
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("ig overlap detection failed: %s", exc)

    # Tier 1c - phone contacts
    try:
        entries.extend(_phone_contact_overlap(match, julian_contacts))
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("phone contacts overlap failed: %s", exc)

    merged = _dedupe_entries(entries)
    count = len(merged)
    sources_used = sorted({s for e in merged for s in e.get("sources", [])})
    confidence = (
        round(sum(e.get("confidence", 0.0) for e in merged) / count, 3)
        if count else 0.0
    )

    # Strip the per-entry 'sources' list from each output entry and leave a
    # single 'source' (highest-ranked) to match the JSONB schema.
    final_list: list[dict[str, str]] = []
    for e in merged:
        primary = e.get("sources", [e.get("source", "unknown")])[0]
        final_list.append({
            "name": e.get("name", ""),
            "handle": e.get("handle", ""),
            "source": primary,
            "confidence": round(float(e.get("confidence", 0.0)), 3),
        })

    return {
        "count": count,
        "list": final_list,
        "confidence": confidence,
        "sources": sources_used,
    }


# ---------------------------------------------------------------------------
# Risk-band classifier
# ---------------------------------------------------------------------------

def _parse_threshold_string(raw: Any) -> tuple[int, int] | None:
    """Extract a numeric range from persona strings like ``"4-7 mutual ..."``."""
    if raw is None:
        return None
    if isinstance(raw, (list, tuple)) and len(raw) == 2:
        try:
            return int(raw[0]), int(raw[1])
        except Exception:
            return None
    if isinstance(raw, dict):
        lo = raw.get("min")
        hi = raw.get("max")
        if lo is not None and hi is not None:
            try:
                return int(lo), int(hi)
            except Exception:
                return None
    if not isinstance(raw, str):
        return None
    # Match leading patterns:  "0-3", "4 - 7", "8+", "12+ mutual..."
    m = re.match(r"\s*(\d+)\s*(?:-|to)\s*(\d+)", raw)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r"\s*(\d+)\s*\+", raw)
    if m:
        return int(m.group(1)), 10_000
    return None


def compute_risk_band(count: int, persona_rules: dict | None = None) -> str:
    """Return one of safe | watch | high_risk | auto_flag.

    ``persona_rules`` is the ``social_graph_rules.mutual_friends_threshold``
    block from the persona (or the whole social_graph_rules block - we'll
    dig). Falls back to DEFAULT_THRESHOLDS when missing or malformed.
    """
    try:
        count = int(count)
    except Exception:
        count = 0
    if count < 0:
        count = 0

    thresholds = dict(DEFAULT_THRESHOLDS)
    auto_flag_min = 12

    if persona_rules and isinstance(persona_rules, dict):
        block = persona_rules.get("mutual_friends_threshold") or persona_rules
        if isinstance(block, dict):
            for band in ("safe", "watch", "high_risk"):
                parsed = _parse_threshold_string(block.get(band))
                if parsed is not None:
                    thresholds[band] = parsed
            af = _parse_threshold_string(block.get("auto_flag"))
            if af is not None:
                auto_flag_min = af[0]

    if count >= auto_flag_min:
        return "auto_flag"
    # Walk bands in ascending order.
    for band in ("safe", "watch", "high_risk"):
        lo, hi = thresholds[band]
        if lo <= count <= hi:
            return band
    # Fell through - anything above high_risk hi but below auto_flag.
    return "high_risk"


# ---------------------------------------------------------------------------
# Convenience: one-shot scan for a match row
# ---------------------------------------------------------------------------

def scan_match(
    match: dict,
    persona_rules: dict | None = None,
    julian_ig_session: dict | None = None,
    julian_contacts: list[str] | None = None,
) -> dict:
    """Run the detector AND classify the risk band in one call.

    Returns a dict suitable for direct PATCH into clapcheeks_matches:
        {
          mutual_friends_count, mutual_friends_list,
          social_risk_band, social_graph_confidence, social_graph_sources,
        }
    """
    det = detect_mutual_friends(match, julian_ig_session, julian_contacts)
    band = compute_risk_band(det["count"], persona_rules)
    return {
        "mutual_friends_count": det["count"],
        "mutual_friends_list": det["list"],
        "social_risk_band": band,
        "social_graph_confidence": det["confidence"],
        "social_graph_sources": det["sources"],
    }
