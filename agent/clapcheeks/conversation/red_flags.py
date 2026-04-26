"""Conversation red-flag detector — CONV-05 (Phase 41 / AI-8326).

Catches concerning patterns in a conversation history. Different domain than
`match_intel._find_red_flags`, which inspects the bio + prompts (her stated
preferences). This module looks at message *behavior* over time:

  - low_effort        — consistently 1-3 word replies (>=70% of her messages)
  - never_initiates   — she's never the first to message in a session
  - financial_request — asking for money / Venmo / CashApp / wire / gift cards
  - love_bombing      — "soulmate", "the one", "obsessed with you" within first 24h
  - catfish_indicators— refuses to FaceTime/photo, won't meet, vague identity
  - inconsistent      — contradictory facts (age/location/job changing across msgs)
  - external_redirect — pushing to off-platform (Telegram, WhatsApp, sketchy URLs)
  - sob_story         — pity-pitch patterns commonly used in romance scams

Output: list of RedFlag objects. Severity is "info" | "warn" | "critical".
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

# ---------------------------------------------------------------------------
# Pattern banks — heuristic, intentionally simple and easy to tune.
# ---------------------------------------------------------------------------

_FINANCIAL_TERMS = re.compile(
    r"\b(venmo|cashapp|cash\s?app|zelle|paypal|wire (?:me|the)|"
    r"send\s+(?:me\s+)?(?:money|funds|cash|btc|crypto|bitcoin)|"
    r"gift\s?cards?|steam\s?cards?|google\s?play\s?cards?|"
    r"can you (?:help|cover|pay|loan|spot)|need (?:money|cash|help with rent|to borrow)|"
    r"emergency (?:money|cash|funds))\b",
    re.I,
)

_LOVE_BOMB_TERMS = re.compile(
    r"\b(soulmate|soul mate|the one|obsessed with you|never felt this way|"
    r"my future (?:husband|wife)|i love you|in love with you|destined|"
    r"my everything|made for each other)\b",
    re.I,
)

_CATFISH_REFUSAL = re.compile(
    r"\b(can'?t (?:do |meet|video|facetime|talk on the phone)|"
    r"don'?t (?:show my face|do video calls|do photos)|"
    r"my camera (?:is broken|doesn'?t work)|"
    r"phone is broken|out of the country|stationed overseas|"
    r"deployed (?:overseas|abroad)|oil rig|on a (?:rig|ship|deployment))\b",
    re.I,
)

_SOB_STORY = re.compile(
    r"\b(my (?:husband|wife|partner) (?:died|passed|left)|widow|widowed|"
    r"sick (?:mother|father|kid|dad|mom)|stuck in (?:airport|customs|hotel)|"
    r"can'?t access my account|frozen account|inheritance|"
    r"hospital bill)\b",
    re.I,
)

_EXTERNAL_REDIRECT = re.compile(
    r"\b(telegram|signal|whatsapp|kik|snap me|snapchat|wechat|"
    r"add me on|find me at|my (?:website|site|onlyfans|of))\b",
    re.I,
)
_URL_RE = re.compile(r"https?://\S+|\bbit\.ly\S+|\bt\.co\S+", re.I)
_KNOWN_SCAM_DOMAINS = {
    "tinychat", "cashapp.me", "venmo.me", "linktr.ee", "beacons.ai",
}

_LOW_EFFORT_WORDS = {"k", "ok", "yeah", "yea", "no", "nah", "nope", "lol", "lmao",
                     "haha", "cool", "nice", "sure", "idk", "maybe", "good"}


# ---------------------------------------------------------------------------
# Output dataclass
# ---------------------------------------------------------------------------

_SEVERITY_RANK = {"info": 0, "warn": 1, "critical": 2}


@dataclass
class RedFlag:
    code: str
    severity: str            # "info" | "warn" | "critical"
    description: str
    evidence: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "severity": self.severity,
            "description": self.description,
            "evidence": self.evidence[:3],
        }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_HER_ROLES = {"user", "her", "contact", "match"}


def _normalize(messages: Iterable[dict]) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        text = m.get("content") or m.get("text") or ""
        role = (m.get("role") or m.get("sender") or "").lower()
        side = "her" if role in _HER_ROLES else "us" if role else "her"
        # Default unknowns to "her" so we don't drop messages we'd want to flag
        out.append({
            "side": side,
            "text": str(text).strip(),
            "ts": m.get("sent_at") or m.get("timestamp") or m.get("ts"),
        })
    return out


def _is_low_effort(text: str) -> bool:
    if not text:
        return True
    low = text.strip().lower()
    if len(low) <= 3:
        return True
    words = re.findall(r"[A-Za-z']+", low)
    if not words:
        return True
    if len(words) <= 2 and all(w in _LOW_EFFORT_WORDS for w in words):
        return True
    if len(words) == 1:
        return True
    return False


def _hours_between(a: str | None, b: str | None) -> float | None:
    """Best-effort timestamp delta in hours."""
    from datetime import datetime, timezone
    def parse(v):
        if v is None:
            return None
        if isinstance(v, datetime):
            return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        if isinstance(v, (int, float)):
            try:
                return datetime.fromtimestamp(float(v), tz=timezone.utc)
            except (OSError, ValueError):
                return None
        if isinstance(v, str):
            try:
                d = datetime.fromisoformat(v.replace("Z", "+00:00"))
                return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
            except Exception:
                return None
        return None
    pa, pb = parse(a), parse(b)
    if pa is None or pb is None:
        return None
    return abs((pb - pa).total_seconds()) / 3600.0


def _detect_inconsistency(her_texts: list[str]) -> list[str]:
    """Cheap consistency check across messages — pulls candidate facts and
    flags conflicts. Examples: stated age changes, city changes."""
    ages: list[int] = []
    cities: list[str] = []
    age_re = re.compile(r"\b(?:i'?m|im)\s+(\d{2})\b", re.I)
    city_re = re.compile(
        r"\b(?:i live in|im from|i'?m from|im in|i'?m in)\s+"
        r"([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})",
    )
    for t in her_texts:
        for m in age_re.findall(t):
            try:
                age = int(m)
                if 18 <= age <= 80:
                    ages.append(age)
            except ValueError:
                continue
        for m in city_re.findall(t):
            cities.append(m.strip())

    evidence: list[str] = []
    if ages and len(set(ages)) > 1:
        evidence.append(f"stated ages: {sorted(set(ages))}")
    if cities and len(set(c.lower() for c in cities)) > 1:
        evidence.append(f"stated cities: {sorted(set(cities))}")
    return evidence


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def detect_red_flags(messages: Iterable[dict]) -> list[RedFlag]:
    """Inspect a conversation and return all red flags found.

    Returns a list, sorted by severity descending. Empty list if nothing
    suspicious. Safe to call on partial/empty data.
    """
    norm = _normalize(messages)
    her = [m for m in norm if m["side"] == "her"]
    her_texts = [m["text"] for m in her if m["text"]]
    her_count = len(her_texts)

    flags: list[RedFlag] = []

    # 1. low_effort — needs at least 3 messages of signal so we don't fire
    # on the very first reply, but cheap enough that an obviously dead
    # conversation gets caught after the third dud.
    if her_count >= 3:
        low = sum(1 for t in her_texts if _is_low_effort(t))
        share = low / her_count
        if share >= 0.7:
            flags.append(RedFlag(
                code="low_effort",
                severity="warn",
                description=(
                    f"{int(share * 100)}% of her replies are 1-2 words. "
                    "Conversation isn't going anywhere."
                ),
                evidence=her_texts[-3:],
            ))

    # 2. never_initiates — she's never started a session (we always sent first).
    # Requires a sustained pattern: 16+ total messages and she has never
    # double-sent. Below that, opener-then-reply is normal dating behavior
    # and would false-flag healthy conversations.
    if norm and her_count >= 1 and norm[0]["side"] == "us" and len(norm) >= 16:
        her_initiated = False
        for prev, cur in zip(norm, norm[1:]):
            if cur["side"] == "her" and prev["side"] == "her":
                her_initiated = True
                break
        if not her_initiated:
            flags.append(RedFlag(
                code="never_initiates",
                severity="info",
                description=(
                    "Across 16+ messages she has never double-sent or initiated."
                ),
            ))

    # 3. financial_request
    fin_evidence = [t for t in her_texts if _FINANCIAL_TERMS.search(t)]
    if fin_evidence:
        flags.append(RedFlag(
            code="financial_request",
            severity="critical",
            description="She's asking for money or payment apps — high scam likelihood.",
            evidence=fin_evidence,
        ))

    # 4. love_bombing — early "soulmate" / "the one" within first ~24h
    if her_count >= 1 and norm:
        first_ts = norm[0].get("ts")
        for m in her:
            if not _LOVE_BOMB_TERMS.search(m["text"]):
                continue
            hours = _hours_between(first_ts, m.get("ts"))
            if hours is None or hours <= 48 or her_count <= 6:
                # No timestamps OR confirmed within 48h OR very few messages
                # exchanged so it's far too early either way.
                flags.append(RedFlag(
                    code="love_bombing",
                    severity="warn",
                    description="Premature intensity — 'soulmate'/'the one' very early.",
                    evidence=[m["text"]],
                ))
                break

    # 5. catfish_indicators
    catfish_evidence = [t for t in her_texts if _CATFISH_REFUSAL.search(t)]
    if catfish_evidence:
        flags.append(RedFlag(
            code="catfish_indicators",
            severity="warn",
            description=(
                "She's refusing video / photo / meeting in person. "
                "Possible catfish or scam."
            ),
            evidence=catfish_evidence,
        ))

    # 6. inconsistent
    incons_evidence = _detect_inconsistency(her_texts)
    if incons_evidence:
        flags.append(RedFlag(
            code="inconsistent",
            severity="warn",
            description="Stated facts have changed across messages (age / city).",
            evidence=incons_evidence,
        ))

    # 7. external_redirect — pushing to other platforms or sketchy domains
    redirect_evidence: list[str] = []
    for t in her_texts:
        if _EXTERNAL_REDIRECT.search(t):
            redirect_evidence.append(t)
            continue
        urls = _URL_RE.findall(t)
        for u in urls:
            low = u.lower()
            if any(d in low for d in _KNOWN_SCAM_DOMAINS):
                redirect_evidence.append(t)
                break
    if redirect_evidence:
        # Mention of Telegram alone is "info"; sketchy domain is "critical"
        sev = "warn"
        if any(any(d in t.lower() for d in _KNOWN_SCAM_DOMAINS) for t in redirect_evidence):
            sev = "critical"
        flags.append(RedFlag(
            code="external_redirect",
            severity=sev,
            description=(
                "Pushing to off-platform comm (Telegram / WhatsApp / sketchy URL)."
            ),
            evidence=redirect_evidence[:3],
        ))

    # 8. sob_story
    sob_evidence = [t for t in her_texts if _SOB_STORY.search(t)]
    if sob_evidence:
        flags.append(RedFlag(
            code="sob_story",
            severity="warn",
            description=(
                "Pity-pitch patterns common in romance scams "
                "(deceased partner, stuck abroad, sick relative, frozen account)."
            ),
            evidence=sob_evidence,
        ))

    # Sort by severity descending — critical first
    flags.sort(key=lambda f: -_SEVERITY_RANK.get(f.severity, 0))
    return flags


def red_flag_summary(flags: list[RedFlag]) -> dict:
    """Compact JSON-friendly summary."""
    if not flags:
        return {"flagged": False, "count": 0, "max_severity": None, "flags": []}
    max_sev = max(flags, key=lambda f: _SEVERITY_RANK.get(f.severity, 0)).severity
    return {
        "flagged": True,
        "count": len(flags),
        "max_severity": max_sev,
        "flags": [f.to_dict() for f in flags],
    }


__all__ = [
    "RedFlag",
    "detect_red_flags",
    "red_flag_summary",
]
