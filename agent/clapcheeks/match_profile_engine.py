"""Match Profile Engine — unified enrichment pipeline.

Combines all intelligence sources (platform profile, Instagram, zodiac,
comms style) into a single enriched contact dict ready for DB storage
and AI context generation.

Usage:
    from clapcheeks.match_profile_engine import MatchProfileEngine

    engine = MatchProfileEngine(enable_ig_scraping=True)
    enriched = engine.enrich(
        platform="hinge",
        raw_profile={"name": "Maya", "bio": "♑ | yoga & cats"},
        messages=[{"sender": "contact", "text": "heyy", "sent_at": "..."}],
        existing_contact=None,
    )
    context = engine.build_ai_context(enriched)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from clapcheeks import match_intel
from clapcheeks.ig_scraper import (
    extract_username_from_profile,
    scrape_profile,
    extract_ig_interests,
    profile_to_db_fields,
)
from clapcheeks.conversation.comms_profiler import (
    build_style_profile,
    format_style_for_prompt,
)

log = logging.getLogger(__name__)


class MatchProfileEngine:
    """Five-layer enrichment pipeline for dating contacts."""

    def __init__(self, enable_ig_scraping: bool = True):
        self.enable_ig_scraping = enable_ig_scraping

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def enrich(
        self,
        platform: str,
        raw_profile: dict | None = None,
        messages: list[dict] | None = None,
        existing_contact: dict | None = None,
    ) -> dict:
        """Run the full enrichment pipeline.

        Returns a dict with keys ready for upserting into
        clapcheeks_contact_profiles + related tables.
        """
        result: dict[str, Any] = {
            "platform": platform,
            "enriched_at": datetime.now(timezone.utc).isoformat(),
        }

        # Layer 1 — platform profile (name, age, bio, interests, zodiac)
        intel = match_intel.extract(raw_profile)
        result["intel"] = intel
        result["name"] = intel.get("name") or (raw_profile or {}).get("name")
        result["bio"] = (raw_profile or {}).get("bio", "")
        result["zodiac_sign"] = intel.get("zodiac")
        result["zodiac_source"] = "profile" if intel.get("zodiac") else None
        result["interests"] = list(intel.get("interests", []))

        # Layer 2 — Instagram enrichment
        ig_data: dict[str, Any] = {}
        if self.enable_ig_scraping:
            ig_username = extract_username_from_profile(raw_profile)
            if ig_username:
                log.info("Scraping IG profile: @%s", ig_username)
                ig_profile = scrape_profile(ig_username)
                if ig_profile:
                    ig_data = profile_to_db_fields(ig_profile)
                    # Prefer IG zodiac if platform didn't have one
                    if not result["zodiac_sign"] and ig_data.get("zodiac_sign"):
                        result["zodiac_sign"] = ig_data["zodiac_sign"]
                        result["zodiac_source"] = "instagram"
                    # Merge IG interests
                    ig_interests = extract_ig_interests(ig_profile.bio)
                    result["interests"] = _merge_interests(
                        result["interests"], ig_interests
                    )
        result["ig"] = ig_data

        # Layer 3 — communication style profiling
        style: dict[str, Any] = {}
        if messages:
            style = build_style_profile(messages)
        result["style"] = style
        result["style_db"] = _style_to_db(style, len(messages or []))

        # Layer 4 — merge with existing contact data (don't overwrite richer fields)
        if existing_contact:
            result = _merge_existing(result, existing_contact)

        # Layer 5 — compute completeness score
        result["completeness_score"] = _completeness(result)

        return result

    def build_ai_context(self, enriched: dict) -> str:
        """Generate a system-prompt block from enriched data."""
        parts: list[str] = []

        # Basic info
        name = enriched.get("name", "Unknown")
        parts.append(f"Contact: {name}")
        if enriched.get("platform"):
            parts.append(f"Platform: {enriched['platform']}")
        if enriched.get("zodiac_sign"):
            parts.append(f"Zodiac: {enriched['zodiac_sign']} (source: {enriched.get('zodiac_source', '?')})")

        # Interests
        interests = enriched.get("interests", [])
        if interests:
            parts.append(f"Interests: {', '.join(interests)}")

        # Platform intelligence
        intel = enriched.get("intel", {})
        intel_prompt = match_intel.format_for_system_prompt(intel)
        if intel_prompt:
            parts.append(f"\n{intel_prompt}")

        # Instagram context
        ig = enriched.get("ig", {})
        if ig.get("ig_username"):
            ig_parts = [f"Instagram: @{ig['ig_username']}"]
            if ig.get("ig_bio"):
                ig_parts.append(f"  Bio: {ig['ig_bio']}")
            if ig.get("ig_follower_count"):
                ig_parts.append(f"  Followers: {ig['ig_follower_count']}")
            parts.append("\n".join(ig_parts))

        # Communication style
        style = enriched.get("style", {})
        if style:
            style_prompt = format_style_for_prompt(style)
            if style_prompt:
                parts.append(f"\n{style_prompt}")

        return "\n".join(parts)


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _merge_interests(base: list[str], additions: list[str]) -> list[str]:
    """Union of interests, preserving order."""
    seen = set(i.lower() for i in base)
    merged = list(base)
    for item in additions:
        if item.lower() not in seen:
            seen.add(item.lower())
            merged.append(item)
    return merged


def _style_to_db(style: dict, message_count: int) -> dict:
    """Map comms_profiler output to clapcheeks_contact_style_profiles columns."""
    if not style:
        return {}
    return {
        "avg_message_length": style.get("avg_message_length", 0),
        "emoji_frequency": style.get("emoji_frequency", 0.0),
        "top_emojis": style.get("top_emojis", []),
        "humor_style": style.get("humor_style", "unknown"),
        "formality_level": round(style.get("formality_score", 0.5), 2),
        "energy_level": round(style.get("energy_score", 0.5), 2),
        "capitalization_style": style.get("capitalization", "standard"),
        "punctuation_style": style.get("punctuation", "standard"),
        "message_count_analyzed": message_count,
    }


def _merge_existing(enriched: dict, existing: dict) -> dict:
    """Merge with existing contact, preferring richer non-empty values."""
    for key in ("name", "bio", "zodiac_sign"):
        if not enriched.get(key) and existing.get(key):
            enriched[key] = existing[key]
    # Merge interests
    if existing.get("interests"):
        enriched["interests"] = _merge_interests(
            enriched.get("interests", []),
            existing.get("interests", []),
        )
    return enriched


def _completeness(enriched: dict) -> float:
    """Calculate a 0-1 completeness score for the contact profile."""
    checks = [
        bool(enriched.get("name")),
        bool(enriched.get("bio")),
        bool(enriched.get("zodiac_sign")),
        len(enriched.get("interests", [])) >= 2,
        bool(enriched.get("ig", {}).get("ig_username")),
        bool(enriched.get("style")),
        bool(enriched.get("platform")),
    ]
    return round(sum(checks) / len(checks), 2)
