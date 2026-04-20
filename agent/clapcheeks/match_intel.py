"""Parse a match's raw profile into structured intel the AI can use.

Inputs vary by platform:
    - Tinder JSON recs: {user: {_id, name, bio, birth_date, photos, ...}}
    - Hinge recs: {subject: {firstName, prompts, photos, ...}}
    - Cached match dict from ConversationManager

Output is a compact dict we inject into the system prompt so the AI speaks
*to this specific person*, not a generic match. Includes zodiac inference
(from birth_date, or stated sign in bio/prompts).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

ZODIAC_SIGNS = [
    ("Capricorn",   (12, 22), (1, 19)),
    ("Aquarius",    (1, 20),  (2, 18)),
    ("Pisces",      (2, 19),  (3, 20)),
    ("Aries",       (3, 21),  (4, 19)),
    ("Taurus",      (4, 20),  (5, 20)),
    ("Gemini",      (5, 21),  (6, 20)),
    ("Cancer",      (6, 21),  (7, 22)),
    ("Leo",         (7, 23),  (8, 22)),
    ("Virgo",       (8, 23),  (9, 22)),
    ("Libra",       (9, 23),  (10, 22)),
    ("Scorpio",     (10, 23), (11, 21)),
    ("Sagittarius", (11, 22), (12, 21)),
]

# Rough, not-astrologically-authoritative — used to color tone, not to
# diagnose anyone. Keep it playful and low-stakes.
ZODIAC_TRAITS: dict[str, str] = {
    "Aries":       "direct, competitive, bold — respond to confidence and a little challenge",
    "Taurus":      "sensual, steady, values craft and comfort — lead with taste and specificity",
    "Gemini":      "quick-witted, loves banter and ideas — match her tempo, keep it playful",
    "Cancer":      "warm, protective, emotionally present — be sincere, ask meaningful questions",
    "Leo":         "wants to feel seen and celebrated — sincere compliments land, not flattery",
    "Virgo":       "precise, funny in a dry way, observant — don't be sloppy, small details win",
    "Libra":       "social, aesthetic, dislikes conflict — lean charming, avoid heavy topics early",
    "Scorpio":     "intense, reads subtext, values depth — be direct, mean what you say",
    "Sagittarius": "adventurous, hates small talk — propose experiences, reference travel/stories",
    "Capricorn":   "ambitious, dry humor, respects follow-through — confidence + a clear plan",
    "Aquarius":    "independent, cerebral, original — bring ideas, skip the generic openers",
    "Pisces":      "dreamy, empathetic, artsy — emotional resonance > logic, soft landing",
}


# ---------------------------------------------------------------------------
# Zodiac helpers
# ---------------------------------------------------------------------------

_MONTH_DAY_RE = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    r"\s+(\d{1,2})", re.IGNORECASE,
)


def sign_from_date(birth: date | datetime | None) -> str | None:
    if not birth:
        return None
    if isinstance(birth, datetime):
        birth = birth.date()
    m, d = birth.month, birth.day
    for name, (sm, sd), (em, ed) in ZODIAC_SIGNS:
        # Capricorn wraps year boundary
        if name == "Capricorn":
            if (m, d) >= (sm, sd) or (m, d) <= (em, ed):
                return name
        elif (m, d) >= (sm, sd) and (m, d) <= (em, ed):
            return name
    return None


def sign_from_text(text: str | None) -> str | None:
    if not text:
        return None
    lower = text.lower()
    for name, _, _ in ZODIAC_SIGNS:
        if name.lower() in lower:
            return name
    # Common emoji shorthand — ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓
    emoji_map = {
        "♈": "Aries", "♉": "Taurus", "♊": "Gemini", "♋": "Cancer",
        "♌": "Leo", "♍": "Virgo", "♎": "Libra", "♏": "Scorpio",
        "♐": "Sagittarius", "♑": "Capricorn", "♒": "Aquarius", "♓": "Pisces",
    }
    for glyph, name in emoji_map.items():
        if glyph in text:
            return name
    return None


def _parse_birth_date(s: Any) -> date | None:
    if not s:
        return None
    if isinstance(s, (date, datetime)):
        return s if isinstance(s, date) else s.date()
    if not isinstance(s, str):
        return None
    # ISO first
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except Exception:
        pass
    # "1995-04-12" shapes
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Text extraction helpers
# ---------------------------------------------------------------------------

_INTEREST_KEYWORDS = {
    "travel": ["travel", "passport", "wanderlust", "flights"],
    "fitness": ["gym", "lift", "run", "climb", "yoga", "pilates", "hike"],
    "food": ["foodie", "cook", "baker", "brunch", "wine", "taco", "ramen"],
    "music": ["concert", "festival", "spotify", "plays music", "guitar", "dj"],
    "art": ["museum", "painter", "sketch", "gallery", "ceramics"],
    "dogs": ["dog", "puppy", "pup"],
    "cats": ["cat lady", " cat ", "kitten"],
    "reading": ["bookworm", "reader", "book club", "kindle"],
    "outdoors": ["hiking", "camping", "surfing", "skiing", "climber"],
    "career": ["founder", "engineer", "designer", "doctor", "nurse", "lawyer"],
}


def _find_interests(text: str) -> list[str]:
    if not text:
        return []
    lower = text.lower()
    hits: list[str] = []
    for tag, needles in _INTEREST_KEYWORDS.items():
        if any(n in lower for n in needles):
            hits.append(tag)
    return hits


_RED_FLAG_PATTERNS = [
    ("no_hookups", re.compile(r"no\s+hook[-\s]?ups|looking for something real", re.I)),
    ("no_men_under", re.compile(r"no (men|guys) under (\d+)", re.I)),
    ("gym_required", re.compile(r"must (love|hit) (the )?gym", re.I)),
    ("height_requirement", re.compile(r"(\d['\"]\d?)\s*or\s*above|taller than (\d)", re.I)),
]


def _find_red_flags(text: str) -> list[str]:
    if not text:
        return []
    out = []
    for name, pat in _RED_FLAG_PATTERNS:
        if pat.search(text):
            out.append(name)
    return out


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def extract(raw: dict | None) -> dict:
    """Extract structured intel from a platform's raw match/rec dict.

    Returns a dict with:
        name, age, bio, zodiac, zodiac_trait, interests, prompt_themes,
        red_flags, location, platform_hint.
    """
    if not raw:
        return {}

    # Normalize between Tinder and Hinge shapes
    subject = raw.get("subject") or raw.get("user") or raw
    name = subject.get("firstName") or subject.get("name") or raw.get("name") or ""
    bio = subject.get("bio") or ""
    age = subject.get("age")
    if not age:
        age = raw.get("age")

    # Prompts (Hinge) — join question + answer as free text
    prompt_themes: list[str] = []
    prompts = subject.get("prompts") or []
    prompt_blob_parts: list[str] = []
    for p in prompts:
        q = (p.get("prompt") or {}).get("question") or ""
        a = p.get("answer") or ""
        if q:
            prompt_themes.append(q.strip())
        if a:
            prompt_blob_parts.append(a)
    prompts_blob = " || ".join(prompt_blob_parts)

    text_blob = " ".join(x for x in [bio, prompts_blob] if x)

    # Zodiac: birth_date first, then stated sign in text
    birth = _parse_birth_date(subject.get("birth_date") or subject.get("birthDate"))
    zodiac = sign_from_date(birth) or sign_from_text(text_blob)
    zodiac_trait = ZODIAC_TRAITS.get(zodiac) if zodiac else None

    return {
        "name": name,
        "age": age,
        "bio": bio,
        "zodiac": zodiac,
        "zodiac_trait": zodiac_trait,
        "interests": _find_interests(text_blob),
        "prompt_themes": prompt_themes,
        "prompt_text": prompts_blob[:600],
        "red_flags": _find_red_flags(text_blob),
        "location": subject.get("city", {}).get("name") if isinstance(subject.get("city"), dict) else "",
    }


def format_for_system_prompt(intel: dict | None) -> str:
    """Compact prompt block describing the match. Injected next to persona."""
    if not intel or not intel.get("name"):
        return ""
    lines = ["=== WHO SHE IS (write FOR her) ==="]
    ident = f"- {intel['name']}"
    if intel.get("age"):
        ident += f", {intel['age']}"
    if intel.get("location"):
        ident += f" ({intel['location']})"
    lines.append(ident)
    if intel.get("zodiac"):
        trait = intel.get("zodiac_trait") or ""
        lines.append(f"- Sign: {intel['zodiac']} — {trait}.")
    if intel.get("interests"):
        lines.append("- Interests: " + ", ".join(intel["interests"]) + ".")
    if intel.get("prompt_themes"):
        lines.append("- She opened conversations on: " +
                     "; ".join(intel["prompt_themes"][:3]) + ".")
    if intel.get("prompt_text"):
        lines.append(f"- What she wrote: {intel['prompt_text']}")
    if intel.get("red_flags"):
        lines.append(
            "- Signals to respect: "
            + ", ".join(intel["red_flags"]) + " (don't clash with these)."
        )
    lines.append(
        "- Use ONE specific detail from above — never list them. If her sign "
        "doesn't feel natural to reference, ignore it."
    )
    return "\n".join(lines)
