"""Instagram handle extraction from match bio / prompts / messages.

Phase C (AI-8317). The daemon pulls any candidate IG handle out of the
match's free-text fields so ``ig_enrich._ig_enrich_worker`` can enqueue
an ``ig_user_feed`` job against her public feed.

Rules we follow (in order):

    1. Prefer "ig:/insta:/instagram:" prefixed handles (highest signal)
    2. Then anything that looks like ``@handle`` in free text
    3. Then naked ``handle_with_underscores`` preceded by "insta/ig" words

Validation:

    - 3-30 chars (Instagram's actual allowed range)
    - starts alphanumeric
    - allowed chars ``a-zA-Z0-9._``
    - can't be purely numeric (those are digits, not usernames)
    - can't be a stopword / reserved / common-English-word collision
      (e.g. ``gmail.com``, ``the``, ``about``, ``cooking``)
    - can't contain two dots in a row (IG disallows ``foo..bar``)
    - can't start or end with a dot
"""
from __future__ import annotations

import re

# Instagram's public rules on usernames:
#   - 1-30 characters (we bump the floor to 3 because <3 is 99% noise)
#   - letters, digits, dots, underscores
#   - cannot start with a dot or underscore-less-common; we just block dot
#   - no consecutive dots
HANDLE_CORE = r"[a-zA-Z0-9](?:[a-zA-Z0-9._]{1,28}[a-zA-Z0-9_])"

# Group (1) is the handle. Leading context is either:
#   - start of string, whitespace, or '@'
#   - or an explicit "ig:"/"insta:"/"instagram:" prefix (with ':' or space)
IG_HANDLE_REGEX = re.compile(
    r"(?:^|[\s,;.!?])"                        # boundary
    r"(?:ig|insta|instagram)\s*[:\-]\s*@?"    # required prefix
    r"(" + HANDLE_CORE + r")",
    re.IGNORECASE,
)

# Looser fallback: any @handle in free text. Disambiguates email addrs by
# looking ahead for a '.' and TLD-ish letters -- we skip those.
AT_HANDLE_REGEX = re.compile(
    r"(?:^|[\s,;.!?])@(" + HANDLE_CORE + r")(?!\.[a-z]{2,})",
    re.IGNORECASE,
)

# Reserved/common-word blocklist. Anything that happens to match the
# handle regex but is obviously not an IG handle goes here.
_STOPWORDS = frozenset({
    # email / URL artifacts
    "gmail", "gmail.com", "yahoo", "yahoo.com", "hotmail", "hotmail.com",
    "outlook", "outlook.com", "icloud", "icloud.com", "protonmail",
    # IG-reserved (users can't sign up as these)
    "instagram", "explore", "reels", "stories", "about", "accounts",
    "developer", "developers", "legal", "press", "privacy", "terms",
    "support", "help", "login", "logout", "signup", "signin",
    "search", "settings", "direct", "web", "www",
    # common English words that match our regex
    "the", "about", "hello", "love", "dating", "single", "cooking",
    "travel", "traveling", "yoga", "fitness", "coffee", "wine",
    "working", "looking", "coming", "going",
})

# Keyword cues that boost naked-handle detection when the word immediately
# precedes. Kept narrow to avoid false positives.
_NAKED_CUES = re.compile(
    r"(?:my\s+(?:ig|insta|instagram)\s+is|"
    r"(?:ig|insta|instagram)\s+is|"
    r"find\s+me\s+on\s+(?:ig|insta|instagram)|"
    r"follow\s+me(?:\s+on)?(?:\s+(?:ig|insta|instagram))?)\s*[:\-]?\s*@?"
    r"(" + HANDLE_CORE + r")",
    re.IGNORECASE,
)


def _valid_handle(h: str) -> bool:
    """Post-match sanity check."""
    if not h:
        return False
    h = h.strip()
    if len(h) < 3 or len(h) > 30:
        return False
    if not h[0].isalnum():
        return False
    # IG disallows trailing '.' but allows trailing '_'.
    if h.endswith("."):
        return False
    if ".." in h:
        return False
    if h.isdigit():
        return False
    if h.lower() in _STOPWORDS:
        return False
    # must contain at least one alpha char -- pure-numeric + punctuation
    # is always spam
    if not any(c.isalpha() for c in h):
        return False
    return True


def extract_ig_handles(text: str | None) -> list[str]:
    """Return unique, lowercase IG handle candidates from ``text``.

    Order is highest-signal first (explicit ``ig:`` prefix before naked
    ``@handle`` before cue-preceded bare handles). Duplicates collapse.
    """
    if not text:
        return []

    found: list[str] = []
    seen: set[str] = set()

    def _add(h: str) -> None:
        if not _valid_handle(h):
            return
        lower = h.lower().strip()
        if lower in seen:
            return
        seen.add(lower)
        found.append(lower)

    for m in IG_HANDLE_REGEX.finditer(text):
        _add(m.group(1))

    for m in _NAKED_CUES.finditer(text):
        _add(m.group(1))

    for m in AT_HANDLE_REGEX.finditer(text):
        _add(m.group(1))

    return found


def extract_primary_handle(text: str | None) -> str | None:
    """Convenience: return the first (highest-signal) handle or None."""
    handles = extract_ig_handles(text)
    return handles[0] if handles else None
