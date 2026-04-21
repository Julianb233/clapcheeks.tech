"""Phase B: Claude Vision analysis for match photos (AI-8316).

For every photo on a clapcheeks_matches row, run Claude Vision and extract
structured signals (activities, locations, food, aesthetic, energy,
solo/group, travel, notable details). Aggregate across all her photos
into a short natural-language ``vision_summary`` that feeds the Phase I
rule-based scorer and the opener-drafting prompt.

Design notes
------------
* Uses the ``anthropic`` Python SDK against ``claude-sonnet-4-6`` (cheap
  + fast for vision, per Phase B brief).
* Batches up to 3 photos per API call (one request with 3 image blocks)
  to cut per-photo overhead roughly 3x.
* Deduplicates by SHA-256 of the photo URL so re-runs on the same match
  don't burn tokens re-analyzing the same image.
* Summaries are <= 280 chars, ASCII only (no em-dashes, curly quotes,
  ellipses), and factual — no attractiveness judgments, no guesses at
  intent. Phase I scoring interprets the signals.
* Prompt is hard-coded and capped: if Claude returns anything the parser
  can't read, we return an empty tag dict rather than raising, so the
  daemon keeps running.

Public API
----------
``analyze_photo(photo_url_or_path)`` -> dict with structured tags for one
image. Cheap wrapper that calls the batch API with a single image.

``analyze_photos_batch(urls)`` -> list[dict] parallel-aligned to ``urls``.
Internally chunks into groups of 3 images per Claude request.

``aggregate_vision(photo_results)`` -> str, 2-3 sentence summary <= 280
chars, ASCII only.

``photo_hash(url)`` -> str, stable identifier used for dedupe in
``clapcheeks_photo_scores``.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

log = logging.getLogger("clapcheeks.photos.vision")

VISION_MODEL = os.environ.get("CLAPCHEEKS_VISION_MODEL", "claude-sonnet-4-6")

# Claude 4.5/4.6 Sonnet Vision input pricing as of 2026-04 — roughly
# $3/1M input tokens. One image is ~1600 tokens at 1092x1092 tile size,
# so ~$0.005/image. We keep the number conservative (0.003) per the
# Phase B brief.
COST_PER_IMAGE_USD = 0.003

# Batch size per Claude Vision call (the brief specifies 3)
BATCH_SIZE = 3

# Tag keys returned per photo — canonical schema.
TAG_KEYS = (
    "activities",
    "locations",
    "food_signals",
    "aesthetic",
    "energy",
    "solo_vs_group",
    "travel_signals",
    "notable_details",
)

EMPTY_TAGS: dict[str, Any] = {
    "activities": [],
    "locations": [],
    "food_signals": [],
    "aesthetic": None,
    "energy": None,
    "solo_vs_group": None,
    "travel_signals": [],
    "notable_details": [],
}

# Banned characters in vision summaries — em-dash, en-dash, ellipsis,
# curly quotes, bullets. Replace with ASCII or strip.
_SCRUB = {
    "\u2014": " ",     # em-dash
    "\u2013": "-",     # en-dash
    "\u2018": "'",     # curly open single
    "\u2019": "'",     # curly close single
    "\u201c": '"',     # curly open double
    "\u201d": '"',     # curly close double
    "\u2026": ".",     # ellipsis
    "\u2022": "*",     # bullet
    "\u00a0": " ",     # nbsp
}


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

def photo_hash(url_or_path: str) -> str:
    """Stable SHA-256 hex digest of a photo URL/path. Used for dedupe."""
    h = hashlib.sha256()
    h.update(str(url_or_path).encode("utf-8"))
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Image loading
# ---------------------------------------------------------------------------

def _load_image_bytes(url_or_path: str) -> tuple[bytes, str]:
    """Return (image_bytes, media_type) for a URL or local path.

    Raises on network / file errors so the batch call can fall back.
    """
    if url_or_path.startswith(("http://", "https://")):
        import requests

        resp = requests.get(url_or_path, timeout=20)
        resp.raise_for_status()
        data = resp.content
        media = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        if media not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
            media = "image/jpeg"
        return data, media

    p = Path(url_or_path)
    if not p.exists():
        raise FileNotFoundError(f"Image not found: {url_or_path}")
    ext = p.suffix.lower().lstrip(".")
    media = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
    }.get(ext, "image/jpeg")
    return p.read_bytes(), media


def _image_block(url_or_path: str) -> dict | None:
    """Build an Anthropic vision image block from a URL or path.

    Returns ``None`` on load failure (so batch keeps going).
    """
    try:
        data, media = _load_image_bytes(url_or_path)
    except Exception as exc:
        log.warning("vision: failed to load %s (%s)", url_or_path, exc)
        return None

    b64 = base64.b64encode(data).decode("ascii")
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media,
            "data": b64,
        },
    }


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

def _build_prompt(n_images: int) -> str:
    """Prompt for a Claude Vision call with ``n_images`` image blocks."""
    schema = (
        '{"activities": ["..."], "locations": ["..."], '
        '"food_signals": ["..."], "aesthetic": "...", "energy": "...", '
        '"solo_vs_group": "solo|group|pair|unknown", '
        '"travel_signals": ["..."], "notable_details": ["..."]}'
    )
    return (
        f"You are analyzing {n_images} dating app profile photo(s) for structured "
        "signals. Return ONE JSON array with exactly "
        f"{n_images} object(s), one per image in the order shown. "
        "Do not add commentary, do not wrap in code fences, just raw JSON.\n\n"
        "For each image, return this exact schema:\n"
        f"{schema}\n\n"
        "Rules:\n"
        "- Be factual. Describe what is visibly in the photo. Do not judge "
        "attractiveness. Do not guess at intent or personality.\n"
        "- 'activities': short nouns for what is happening (examples: "
        '"hiking", "yoga", "beach", "gym", "surfing", "running", "dog_walking", '
        '"dining", "drinking", "dancing", "travel", "posing").\n'
        "- 'locations': scene type (examples: 'outdoors', 'beach', 'mountain', "
        "'restaurant', 'bar', 'home', 'gym', 'city', 'pool', 'airport').\n"
        "- 'food_signals': if food/drinks are visible (examples: 'wine', "
        "'cocktail', 'coffee', 'sushi', 'pizza', 'brunch'). Empty list if none.\n"
        "- 'aesthetic': one word (athletic, fashionable, casual, glam, "
        "natural, edgy, preppy, bohemian).\n"
        "- 'energy': one word (high, medium, chill, serious, playful).\n"
        "- 'solo_vs_group': 'solo', 'pair', 'group', or 'unknown'.\n"
        "- 'travel_signals': markers of travel (examples: 'airport', "
        "'passport', 'beach_abroad', 'landmark', 'hotel_pool'). Empty if none.\n"
        "- 'notable_details': anything else a reader would notice in 1-3 "
        "items (examples: 'dog_present', 'book', 'tattoo_arm', 'sunset', "
        "'concert', 'event'). Keep it short.\n\n"
        "Return ONLY the JSON array."
    )


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def _parse_vision_response(text: str, expected_n: int) -> list[dict]:
    """Parse Claude's response into ``expected_n`` tag dicts.

    Tolerant to code-fence wrapping, trailing commentary, and missing
    fields. Returns at most ``expected_n`` dicts padded with EMPTY_TAGS
    if Claude returns fewer.
    """
    if not text:
        return [dict(EMPTY_TAGS) for _ in range(expected_n)]

    s = text.strip()
    # Strip code fences if present
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)

    # Find first '[' through matching ']'
    start = s.find("[")
    end = s.rfind("]")
    if start >= 0 and end > start:
        s = s[start : end + 1]

    try:
        data = json.loads(s)
    except Exception as exc:
        log.warning("vision: JSON parse failed (%s); text=%r", exc, text[:200])
        return [dict(EMPTY_TAGS) for _ in range(expected_n)]

    # Normalize to list
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        return [dict(EMPTY_TAGS) for _ in range(expected_n)]

    out: list[dict] = []
    for i in range(expected_n):
        raw = data[i] if i < len(data) and isinstance(data[i], dict) else {}
        row = dict(EMPTY_TAGS)
        for key in TAG_KEYS:
            if key in raw:
                v = raw[key]
                if key in ("activities", "locations", "food_signals",
                           "travel_signals", "notable_details"):
                    if isinstance(v, list):
                        row[key] = [str(x).strip().lower() for x in v if x]
                    elif isinstance(v, str) and v.strip():
                        row[key] = [v.strip().lower()]
                    else:
                        row[key] = []
                elif key in ("aesthetic", "energy", "solo_vs_group"):
                    row[key] = str(v).strip().lower() if v else None
        out.append(row)
    return out


# ---------------------------------------------------------------------------
# Claude Vision batch call
# ---------------------------------------------------------------------------

def _call_claude_vision_batch(urls: list[str]) -> list[dict]:
    """Run a single Claude Vision call on up to BATCH_SIZE images.

    Returns a list parallel to ``urls``. On any failure returns a list of
    EMPTY_TAGS so the daemon keeps going.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log.warning("vision: ANTHROPIC_API_KEY not set; returning empty tags")
        return [dict(EMPTY_TAGS) for _ in urls]

    try:
        import anthropic
    except ImportError:
        log.warning("vision: anthropic SDK not installed; returning empty tags")
        return [dict(EMPTY_TAGS) for _ in urls]

    blocks: list[dict] = []
    kept: list[int] = []  # indices we successfully loaded
    for i, url in enumerate(urls):
        block = _image_block(url)
        if block is not None:
            blocks.append(block)
            kept.append(i)

    if not blocks:
        return [dict(EMPTY_TAGS) for _ in urls]

    prompt = _build_prompt(len(blocks))
    content = blocks + [{"type": "text", "text": prompt}]

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=VISION_MODEL,
            max_tokens=900,
            messages=[{"role": "user", "content": content}],
        )
        text = response.content[0].text if response.content else ""
    except Exception as exc:
        log.warning("vision: Claude API call failed (%s)", exc)
        return [dict(EMPTY_TAGS) for _ in urls]

    parsed = _parse_vision_response(text, len(blocks))

    # Re-align to original ``urls`` indices: loaded images -> parsed;
    # skipped images -> EMPTY_TAGS.
    out: list[dict] = [dict(EMPTY_TAGS) for _ in urls]
    for j, orig_idx in enumerate(kept):
        if j < len(parsed):
            out[orig_idx] = parsed[j]
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_photo(photo_url_or_path: str) -> dict:
    """Analyze a single photo. Wraps the batch call with n=1.

    Returns a dict with the canonical TAG_KEYS schema. Never raises.
    """
    results = _call_claude_vision_batch([photo_url_or_path])
    return results[0] if results else dict(EMPTY_TAGS)


def analyze_photos_batch(urls: list[str]) -> list[dict]:
    """Analyze ``urls`` in chunks of BATCH_SIZE.

    Returns a list aligned 1:1 with ``urls``. Never raises.
    """
    out: list[dict] = []
    for i in range(0, len(urls), BATCH_SIZE):
        chunk = urls[i : i + BATCH_SIZE]
        out.extend(_call_claude_vision_batch(chunk))
    return out


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------

def _scrub_unicode(s: str) -> str:
    """Remove/replace the banned characters (em-dash etc.) + non-ASCII bytes."""
    for k, v in _SCRUB.items():
        s = s.replace(k, v)
    # Drop anything else outside ASCII printable
    s = "".join(c if 32 <= ord(c) < 127 else " " for c in s)
    # Collapse runs of whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _top_tags(tag_lists: list[list[str]], limit: int = 4) -> list[str]:
    """Rank tags across N photos by frequency, return top ``limit``."""
    counts: dict[str, int] = {}
    for lst in tag_lists:
        for t in lst or []:
            if not t:
                continue
            counts[t] = counts.get(t, 0) + 1
    return [t for t, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def _mode(values: list[str | None]) -> str | None:
    """Most-common non-null string (ties broken alphabetically)."""
    counts: dict[str, int] = {}
    for v in values:
        if not v:
            continue
        counts[v] = counts.get(v, 0) + 1
    if not counts:
        return None
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def aggregate_vision(photo_results: list[dict]) -> str:
    """Summarize N photo tag dicts into a short natural-language blurb.

    Returns <= 280 chars, ASCII only, 2-3 simple sentences, no AI-ish
    phrasing (no em-dashes, no "it seems", no "the photos show"). Meant
    to read like a friend describing the profile in a sentence.
    """
    if not photo_results:
        return ""

    activities = _top_tags([r.get("activities", []) for r in photo_results], 4)
    locations = _top_tags([r.get("locations", []) for r in photo_results], 3)
    food = _top_tags([r.get("food_signals", []) for r in photo_results], 3)
    travel = _top_tags([r.get("travel_signals", []) for r in photo_results], 2)
    notable = _top_tags([r.get("notable_details", []) for r in photo_results], 3)
    aesthetic = _mode([r.get("aesthetic") for r in photo_results])
    energy = _mode([r.get("energy") for r in photo_results])
    solo_group = _mode([r.get("solo_vs_group") for r in photo_results])

    parts: list[str] = []

    # Sentence 1: who + vibe
    lead_bits: list[str] = []
    if aesthetic:
        lead_bits.append(aesthetic)
    if energy and energy != aesthetic:
        lead_bits.append(f"{energy} energy")
    if solo_group == "group":
        lead_bits.append("often in groups")
    elif solo_group == "pair":
        lead_bits.append("often with a friend")
    if lead_bits:
        parts.append(f"Reads {', '.join(lead_bits)}.")

    # Sentence 2: what she does
    activity_bits: list[str] = []
    if activities:
        activity_bits.append(", ".join(activities))
    if locations:
        if activity_bits:
            activity_bits.append(f"scenes include {', '.join(locations)}")
        else:
            activity_bits.append(f"often shot at {', '.join(locations)}")
    if activity_bits:
        parts.append(f"Active with {'; '.join(activity_bits)}.")

    # Sentence 3: extras — travel, food, pets
    extra_bits: list[str] = []
    if travel:
        extra_bits.append(f"travel signals: {', '.join(travel)}")
    if food:
        extra_bits.append(f"food: {', '.join(food)}")
    if notable:
        extra_bits.append(f"notable: {', '.join(notable)}")
    if extra_bits:
        parts.append(_scrub_unicode("; ".join(extra_bits)) + ".")

    summary = " ".join(parts)
    summary = _scrub_unicode(summary)

    # Hard cap at 280 chars — trim at last sentence boundary if possible
    if len(summary) > 280:
        trimmed = summary[:280]
        last_period = trimmed.rfind(".")
        if last_period > 180:
            summary = trimmed[: last_period + 1]
        else:
            summary = trimmed.rstrip() + "."

    return summary


# ---------------------------------------------------------------------------
# Cost tracking helper
# ---------------------------------------------------------------------------

def estimate_cost_usd(n_photos: int) -> float:
    """Rough cost for analyzing ``n_photos`` with Claude Vision."""
    return round(n_photos * COST_PER_IMAGE_USD, 4)
