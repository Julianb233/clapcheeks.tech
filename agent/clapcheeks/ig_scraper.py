"""Instagram profile scraper for match enrichment.

Scrapes public Instagram profile data (bio, follower count, interests
from bio) to enrich contact profiles with social context. Does NOT
handle DMs — that's a separate integration path.

Methods:
    scrape_profile(username) → dict with profile fields
    extract_ig_interests(bio) → list of interest tags
    detect_zodiac_from_bio(bio) → zodiac sign or None

Rate limits: max 1 request per 5 seconds, max 60/hour.
Uses requests with mobile User-Agent to access ?__a=1 JSON endpoint.
Falls back to HTML scraping if JSON endpoint is blocked.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import requests

from clapcheeks.match_intel import sign_from_text

log = logging.getLogger(__name__)

# Rate limiting
_last_request_time: float = 0.0
_MIN_REQUEST_INTERVAL = 5.0  # seconds between requests

_MOBILE_UA = (
    "Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; "
    "samsung; SM-S908B; b0q; qcom; en_US; 458229258)"
)

_WEB_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.4 Mobile/15E148 Safari/604.1"
)


@dataclass
class IGProfile:
    """Scraped Instagram profile data."""
    username: str = ""
    full_name: str = ""
    bio: str = ""
    follower_count: int = 0
    following_count: int = 0
    post_count: int = 0
    is_private: bool = False
    profile_pic_url: str = ""
    external_url: str = ""
    is_verified: bool = False
    scraped_at: str = ""
    interests: list[str] = field(default_factory=list)
    zodiac_sign: str | None = None


def _rate_limit() -> None:
    """Enforce minimum interval between requests."""
    global _last_request_time
    now = time.monotonic()
    elapsed = now - _last_request_time
    if elapsed < _MIN_REQUEST_INTERVAL:
        time.sleep(_MIN_REQUEST_INTERVAL - elapsed)
    _last_request_time = time.monotonic()


def _extract_from_json(data: dict) -> IGProfile | None:
    """Extract profile from Instagram's JSON response."""
    user = data.get("graphql", {}).get("user") or data.get("user")
    if not user:
        return None

    bio = user.get("biography", "") or ""
    username = user.get("username", "")

    profile = IGProfile(
        username=username,
        full_name=user.get("full_name", ""),
        bio=bio,
        follower_count=user.get("edge_followed_by", {}).get("count", 0),
        following_count=user.get("edge_follow", {}).get("count", 0),
        post_count=user.get("edge_owner_to_timeline_media", {}).get("count", 0),
        is_private=user.get("is_private", False),
        profile_pic_url=user.get("profile_pic_url_hd", "") or user.get("profile_pic_url", ""),
        external_url=user.get("external_url", "") or "",
        is_verified=user.get("is_verified", False),
        scraped_at=datetime.now(timezone.utc).isoformat(),
    )

    profile.interests = extract_ig_interests(bio)
    profile.zodiac_sign = detect_zodiac_from_bio(bio)
    return profile


def _extract_from_html(html: str, username: str) -> IGProfile | None:
    """Fallback: extract profile data from HTML meta tags and shared data."""
    profile = IGProfile(
        username=username,
        scraped_at=datetime.now(timezone.utc).isoformat(),
    )

    # Try _sharedData JSON blob
    shared_match = re.search(
        r'window\._sharedData\s*=\s*({.+?});</script>', html
    )
    if shared_match:
        try:
            shared = json.loads(shared_match.group(1))
            user = (
                shared.get("entry_data", {})
                .get("ProfilePage", [{}])[0]
                .get("graphql", {})
                .get("user", {})
            )
            if user:
                return _extract_from_json({"graphql": {"user": user}})
        except (json.JSONDecodeError, IndexError, KeyError):
            pass

    # Fallback to meta tags
    desc_match = re.search(
        r'<meta\s+(?:property="og:description"|name="description")\s+content="([^"]*)"',
        html,
    )
    if desc_match:
        desc = desc_match.group(1)
        # Pattern: "1,234 Followers, 567 Following, 89 Posts - See Instagram photos..."
        nums = re.findall(r'([\d,]+)\s+(Followers?|Following|Posts?)', desc, re.I)
        for val, label in nums:
            num = int(val.replace(",", ""))
            label_lower = label.lower()
            if "follower" in label_lower:
                profile.follower_count = num
            elif "following" in label_lower:
                profile.following_count = num
            elif "post" in label_lower:
                profile.post_count = num

    title_match = re.search(r'<meta\s+property="og:title"\s+content="([^"]*)"', html)
    if title_match:
        title = title_match.group(1)
        # Pattern: "Full Name (@username) • Instagram photos and videos"
        name_match = re.match(r'^(.+?)\s*\(@', title)
        if name_match:
            profile.full_name = name_match.group(1).strip()

    bio_match = re.search(
        r'<meta\s+property="og:description"\s+content="[^"]*?-\s*(.+?)"', html
    )
    if bio_match:
        profile.bio = bio_match.group(1).strip()

    if profile.bio:
        profile.interests = extract_ig_interests(profile.bio)
        profile.zodiac_sign = detect_zodiac_from_bio(profile.bio)

    return profile


def scrape_profile(username: str) -> IGProfile | None:
    """Scrape a public Instagram profile by username.

    Returns IGProfile with bio, follower counts, interests, zodiac.
    Returns None if the profile can't be reached or is rate-limited.
    """
    username = username.lstrip("@").strip().lower()
    if not username or not re.match(r'^[a-z0-9._]+$', username):
        log.warning("Invalid IG username: %s", username)
        return None

    _rate_limit()

    session = requests.Session()

    # Attempt 1: web profile page (most reliable for public profiles)
    try:
        resp = session.get(
            f"https://www.instagram.com/{username}/",
            headers={"User-Agent": _WEB_UA, "Accept": "text/html"},
            timeout=15,
        )
        if resp.status_code == 200:
            profile = _extract_from_html(resp.text, username)
            if profile and (profile.full_name or profile.follower_count > 0):
                log.info("Scraped IG profile via HTML: @%s", username)
                return profile

        if resp.status_code == 404:
            log.info("IG profile not found: @%s", username)
            return None

    except requests.RequestException as e:
        log.warning("IG HTML scrape failed for @%s: %s", username, e)

    # Attempt 2: JSON endpoint (may be blocked)
    _rate_limit()
    try:
        resp = session.get(
            f"https://www.instagram.com/{username}/?__a=1&__d=dis",
            headers={
                "User-Agent": _MOBILE_UA,
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
            },
            timeout=15,
        )
        if resp.status_code == 200:
            try:
                data = resp.json()
                profile = _extract_from_json(data)
                if profile:
                    log.info("Scraped IG profile via JSON: @%s", username)
                    return profile
            except json.JSONDecodeError:
                pass

    except requests.RequestException as e:
        log.warning("IG JSON scrape failed for @%s: %s", username, e)

    log.warning("All IG scrape methods failed for @%s", username)
    return None


# ---------------------------------------------------------------------------
# Interest & zodiac extraction from IG bios
# ---------------------------------------------------------------------------

_IG_INTEREST_PATTERNS: dict[str, list[str]] = {
    "travel": ["travel", "wanderlust", "passport", "explore", "adventure", "nomad", "backpack"],
    "fitness": ["gym", "fitness", "lift", "crossfit", "yoga", "pilates", "marathon", "triathlete"],
    "food": ["foodie", "chef", "cook", "brunch", "wine", "coffee", "vegan", "plant-based"],
    "music": ["music", "concert", "festival", "dj", "guitar", "singer", "spotify", "band"],
    "art": ["artist", "painter", "gallery", "creative", "design", "photographer", "film"],
    "dogs": ["dog mom", "dog dad", "pup", "puppy", "fur baby", "rescue dog"],
    "cats": ["cat mom", "cat lady", "kitten", "rescue cat"],
    "outdoors": ["hiking", "surfing", "skiing", "camping", "climbing", "mountain", "beach"],
    "reading": ["bookworm", "reader", "book club", "bibliophile", "kindle"],
    "tech": ["engineer", "developer", "startup", "tech", "coding", "data"],
    "spirituality": ["manifest", "spiritual", "meditation", "mindful", "energy", "chakra", "crystals"],
    "fashion": ["fashion", "style", "vintage", "thrift", "streetwear"],
    "sports": ["basketball", "soccer", "football", "tennis", "volleyball"],
    "nightlife": ["dancing", "clubs", "party", "rave", "nightlife"],
}


def extract_ig_interests(bio: str | None) -> list[str]:
    """Extract interest tags from an Instagram bio."""
    if not bio:
        return []
    lower = bio.lower()
    hits: list[str] = []
    for tag, needles in _IG_INTEREST_PATTERNS.items():
        if any(n in lower for n in needles):
            hits.append(tag)
    return hits


def detect_zodiac_from_bio(bio: str | None) -> str | None:
    """Detect zodiac sign from IG bio text. Reuses match_intel's sign_from_text."""
    return sign_from_text(bio)


def extract_username_from_profile(raw: dict | None) -> str | None:
    """Try to find an Instagram username in a dating profile's bio/prompts.

    Looks for @username patterns or "ig: username" or "insta: username" patterns.
    """
    if not raw:
        return None

    subject = raw.get("subject") or raw.get("user") or raw
    bio = subject.get("bio") or ""
    prompts = subject.get("prompts") or []
    prompt_text = " ".join(
        p.get("answer", "") for p in prompts if isinstance(p, dict)
    )
    text_blob = f"{bio} {prompt_text}"

    if not text_blob.strip():
        return None

    # Pattern: @username (most common)
    at_match = re.search(r'@([a-zA-Z0-9._]{1,30})', text_blob)
    if at_match:
        username = at_match.group(1).lower()
        # Filter out common non-IG @ mentions
        if username not in ("gmail", "yahoo", "hotmail", "outlook", "icloud"):
            return username

    # Pattern: "ig: username" or "insta: username" or "instagram: username"
    ig_match = re.search(
        r'(?:ig|insta(?:gram)?)\s*[:/]\s*@?([a-zA-Z0-9._]{1,30})',
        text_blob,
        re.IGNORECASE,
    )
    if ig_match:
        return ig_match.group(1).lower()

    return None


def profile_to_db_fields(profile: IGProfile) -> dict:
    """Convert IGProfile to dict of DB column values for clapcheeks_contact_profiles."""
    return {
        "ig_username": profile.username,
        "ig_bio": profile.bio[:2000] if profile.bio else None,
        "ig_follower_count": profile.follower_count,
        "ig_following_count": profile.following_count,
        "ig_post_count": profile.post_count,
        "ig_is_private": profile.is_private,
        "ig_scraped_at": profile.scraped_at,
    }
