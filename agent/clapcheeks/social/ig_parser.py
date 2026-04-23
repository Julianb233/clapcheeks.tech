"""Instagram response parser + aggregator (Phase C, AI-8317).

The Chrome extension (Phase M) fetches Instagram's public
``web_profile_info`` endpoint from inside Julian's real browser
session. The raw JSON is deep + nested. This module pulls out the
handful of signals we care about:

    - display_name, bio, follower / following / post counts
    - is_private flag
    - last 12 caption snippets (<= 120 chars each)
    - hashtags that appear >= 2 times across those captions
    - aesthetic / vibe tags inferred from captions + hashtags

And then collapses everything into a single-paragraph summary (<=
280 chars, ASCII-only, no em-dashes) that the system prompt can
inject like ``vision_summary`` does.

The parser is defensive - Instagram is famous for shuffling its
response shapes. Any key missing -> empty default, never a crash.
"""
from __future__ import annotations

import logging
import re
from collections import Counter

logger = logging.getLogger("clapcheeks.social.ig_parser")

MAX_POSTS = 12
MAX_CAPTION_CHARS = 120
MAX_SUMMARY_CHARS = 280
HASHTAG_REGEX = re.compile(r"#([A-Za-z][A-Za-z0-9_]{1,29})")

# Rough vibe dictionaries. Not astrology-grade -- just enough for the
# system prompt to know "she posts travel + coffee" vs "she posts gym +
# nutrition". Keep values short so aggregate_ig_intel stays under 280.
AESTHETIC_CUES: dict[str, tuple[str, ...]] = {
    "travel": (
        "travel", "wanderlust", "passport", "vacation", "jetlagged",
        "airport", "trip", "abroad", "beach", "nomad",
    ),
    "fitness": (
        "gym", "fitness", "workout", "lift", "run", "running", "yoga",
        "pilates", "strong", "crossfit", "training",
    ),
    "foodie": (
        "brunch", "coffee", "latte", "espresso", "wine", "cocktail",
        "ramen", "sushi", "dinner", "chef", "cooking", "recipe",
    ),
    "outdoor": (
        "hike", "hiking", "trail", "camping", "mountain", "nature",
        "sunset", "ocean", "surf", "ski", "snowboard",
    ),
    "creative": (
        "art", "artist", "design", "photography", "music", "vinyl",
        "concert", "painter", "studio", "gallery",
    ),
    "nightlife": (
        "bar", "club", "party", "drinks", "cocktails", "dj",
        "nightout", "rooftop",
    ),
    "wellness": (
        "meditation", "mindful", "wellness", "selfcare", "spa",
        "therapy", "grounded",
    ),
    "career": (
        "grind", "hustle", "founder", "ceo", "startup", "entrepreneur",
        "podcast", "keynote",
    ),
    "family": (
        "family", "niece", "nephew", "mom", "dad", "sister", "brother",
        "godmom", "auntie",
    ),
    "pets": (
        "dog", "puppy", "cat", "pup", "kitten", "rescue", "dogmom",
        "catmom",
    ),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _dig(node, *path, default=None):
    """Safely traverse nested dict/list keys. Returns default on miss."""
    cur = node
    for step in path:
        if cur is None:
            return default
        if isinstance(step, int):
            if isinstance(cur, list) and 0 <= step < len(cur):
                cur = cur[step]
            else:
                return default
        else:
            if isinstance(cur, dict) and step in cur:
                cur = cur[step]
            else:
                return default
    return cur if cur is not None else default


def _to_int(val, default=0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _strip_ascii(text: str) -> str:
    """Collapse whitespace, substitute smart punctuation, drop non-ASCII."""
    if not text:
        return ""
    table = str.maketrans({
        "\u2014": "-",   # em-dash
        "\u2013": "-",   # en-dash
        "\u2018": "'",   # curly single open
        "\u2019": "'",   # curly single close
        "\u201c": '"',   # curly double open
        "\u201d": '"',   # curly double close
        "\u2026": "...",
        "\u2022": "*",
        "\u2192": "->",
        "\xa0": " ",     # nbsp
    })
    t = text.translate(table)
    t = t.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", t).strip()


def _extract_caption(node) -> str:
    """Pull the first caption text out of a post node."""
    # web_profile_info shape: node.edge_media_to_caption.edges[0].node.text
    cap = _dig(node, "edge_media_to_caption", "edges", 0, "node", "text")
    if cap:
        return cap
    # GraphQL alt shape
    cap = _dig(node, "caption", "text")
    if cap:
        return cap
    cap = _dig(node, "caption")
    if isinstance(cap, str):
        return cap
    return ""


def _extract_user(raw: dict) -> dict | None:
    """Find the user object in a web_profile_info OR ``?__a=1`` body."""
    if not isinstance(raw, dict):
        return None
    user = _dig(raw, "data", "user")
    if user:
        return user
    user = _dig(raw, "graphql", "user")
    if user:
        return user
    # When the extension delivers a result envelope the user is one level
    # deeper; unwrap the body if present.
    if "body" in raw and isinstance(raw["body"], dict):
        return _extract_user(raw["body"])
    # Some accounts return {user: {...}} directly
    if "user" in raw and isinstance(raw["user"], dict):
        return raw["user"]
    return None


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


def parse_ig_user_feed(raw_response: dict | None) -> dict:
    """Parse an Instagram ``web_profile_info`` response into compact intel.

    Returns a dict with fixed keys (never missing - all defaulted) so
    downstream aggregators never have to None-check.
    """
    empty = {
        "handle": None,
        "display_name": None,
        "bio": None,
        "follower_count": 0,
        "following_count": 0,
        "post_count": 0,
        "is_private": False,
        "is_verified": False,
        "recent_posts": [],
        "common_hashtags": [],
        "aesthetic_tags": [],
    }

    user = _extract_user(raw_response or {})
    if not user:
        return empty

    handle = user.get("username")
    display_name = user.get("full_name") or None
    bio = user.get("biography") or None
    is_private = bool(user.get("is_private"))
    is_verified = bool(user.get("is_verified"))

    follower_count = _to_int(_dig(user, "edge_followed_by", "count")
                             or user.get("follower_count"))
    following_count = _to_int(_dig(user, "edge_follow", "count")
                              or user.get("following_count"))
    post_count = _to_int(_dig(user, "edge_owner_to_timeline_media", "count")
                         or user.get("media_count"))

    # Private profiles: we still capture the top-line counts but no
    # captions come back.
    recent_posts: list[dict] = []
    captions: list[str] = []

    edges = _dig(user, "edge_owner_to_timeline_media", "edges", default=[]) or []
    if not edges:
        edges = _dig(user, "timeline_media", "edges", default=[]) or []

    for edge in edges[:MAX_POSTS]:
        node = edge.get("node") if isinstance(edge, dict) else None
        if not node:
            continue
        caption = _strip_ascii(_extract_caption(node))[:MAX_CAPTION_CHARS]
        if caption:
            captions.append(caption)
        recent_posts.append({
            "shortcode": node.get("shortcode") or node.get("code"),
            "caption": caption,
            "like_count": _to_int(
                _dig(node, "edge_liked_by", "count")
                or _dig(node, "edge_media_preview_like", "count")
                or node.get("like_count")
            ),
            "comment_count": _to_int(
                _dig(node, "edge_media_to_comment", "count")
                or node.get("comment_count")
            ),
            "taken_at": _to_int(node.get("taken_at_timestamp")
                                or node.get("taken_at")),
            "is_video": bool(node.get("is_video")
                             or (node.get("media_type") == 2)),
        })

    # Hashtag extraction across all captions
    tag_counter: Counter[str] = Counter()
    for cap in captions:
        for tag in HASHTAG_REGEX.findall(cap):
            tag_counter[tag.lower()] += 1
    common_hashtags = [
        t for t, n in tag_counter.most_common(12) if n >= 2
    ]

    # Aesthetic inference from caption text + hashtag vocabulary
    vocabulary = " ".join(captions).lower() + " " + " ".join(
        tag_counter.keys()
    ).lower() + " " + (bio or "").lower()
    aesthetic_tags: list[str] = []
    for tag, cues in AESTHETIC_CUES.items():
        hits = sum(1 for c in cues if c in vocabulary)
        if hits >= 1:
            aesthetic_tags.append(tag)
    # Cap at 5 so downstream prompts stay lean.
    aesthetic_tags = aesthetic_tags[:5]

    return {
        "handle": handle,
        "display_name": display_name,
        "bio": _strip_ascii(bio) if bio else None,
        "follower_count": follower_count,
        "following_count": following_count,
        "post_count": post_count,
        "is_private": is_private,
        "is_verified": is_verified,
        "recent_posts": recent_posts,
        "common_hashtags": common_hashtags,
        "aesthetic_tags": aesthetic_tags,
    }


# ---------------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------------


def _post_frequency_label(post_count: int, recent_posts: list[dict]) -> str:
    """Crude "post cadence" label using the first + last recent post timestamps."""
    timestamps = [p.get("taken_at") for p in recent_posts if p.get("taken_at")]
    if len(timestamps) < 2:
        if post_count > 500:
            return "very active poster"
        if post_count > 100:
            return "regular poster"
        return "occasional poster"

    span_days = max(1, (max(timestamps) - min(timestamps)) / 86400)
    posts_per_week = (len(timestamps) / span_days) * 7
    if posts_per_week >= 5:
        return "posts daily"
    if posts_per_week >= 2:
        return "posts a few times a week"
    if posts_per_week >= 0.7:
        return "posts weekly"
    if posts_per_week >= 0.25:
        return "posts every couple weeks"
    return "posts occasionally"


def aggregate_ig_intel(parsed: dict | None) -> str:
    """Collapse a ``parse_ig_user_feed`` result into a single paragraph.

    <= 280 chars. ASCII only. No em-dashes. Injection-safe (no
    backticks / braces). Returns an empty string when there's nothing
    useful to say (e.g. no handle).
    """
    if not parsed or not parsed.get("handle"):
        return ""

    parts: list[str] = []

    if parsed.get("is_private"):
        return _strip_ascii(
            f"Private IG @{parsed['handle']}; "
            f"{parsed.get('post_count', 0)} posts, "
            f"{parsed.get('follower_count', 0)} followers."
        )[:MAX_SUMMARY_CHARS]

    aes = parsed.get("aesthetic_tags") or []
    if aes:
        parts.append("Aesthetic: " + ", ".join(aes) + ".")

    tags = parsed.get("common_hashtags") or []
    if tags:
        parts.append("Hashtags she repeats: " + ", ".join("#" + t for t in tags[:6]) + ".")

    posts = parsed.get("recent_posts") or []
    cadence = _post_frequency_label(parsed.get("post_count", 0), posts)
    parts.append(cadence.capitalize() + ".")

    followers = parsed.get("follower_count", 0)
    if followers:
        if followers > 50000:
            parts.append(f"Large audience ({followers} followers).")
        elif followers > 5000:
            parts.append(f"Mid-sized audience ({followers} followers).")

    summary = _strip_ascii(" ".join(parts))
    # Hard cap + avoid cutting mid-word
    if len(summary) > MAX_SUMMARY_CHARS:
        summary = summary[: MAX_SUMMARY_CHARS - 3].rsplit(" ", 1)[0] + "..."
    return summary
