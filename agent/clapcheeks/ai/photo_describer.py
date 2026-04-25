"""Vision-analyze profile photos via Ollama (llama3.2-vision).

Takes a list of photo URLs (or local paths), runs each through the
vision model, returns one-line descriptive tags per photo. Used to
inject what's actually IN her photos (yoga pose, dog, beach, ski trip)
into the reply prompt — not just URLs the LLM can't see.

Cached in clapcheeks_matches.match_intel JSONB so we don't re-describe
on every reply.
"""
from __future__ import annotations

import base64
import io
import logging
import os
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "llama3.2-vision:latest")
DESCRIBE_PROMPT = (
    "Describe this dating-app profile photo in ONE compact sentence. "
    "Focus on what she's doing or what's notable: setting, activity, "
    "energy, anything quirky. No commentary on appearance. "
    "Output ONLY the sentence, no preamble."
)
MAX_BYTES = 5 * 1024 * 1024  # 5MB cap


def _download(url: str, timeout: int = 15) -> bytes | None:
    try:
        if not urlparse(url).scheme:
            # Local file path
            with open(url, "rb") as fh:
                return fh.read()[:MAX_BYTES]
        r = requests.get(url, timeout=timeout, stream=True)
        if r.status_code >= 400:
            logger.debug("photo download %s -> %d", url[:60], r.status_code)
            return None
        return r.content[:MAX_BYTES]
    except Exception as exc:
        logger.debug("photo download failed: %s", exc)
        return None


def describe_photo(image_url_or_bytes: str | bytes, timeout: int = 30) -> str | None:
    """Return one-line description, or None on failure."""
    try:
        import ollama
    except ImportError:
        logger.debug("ollama package not installed; cannot describe photos")
        return None

    raw = image_url_or_bytes if isinstance(image_url_or_bytes, bytes) else _download(image_url_or_bytes)
    if not raw:
        return None

    try:
        b64 = base64.b64encode(raw).decode()
        resp = ollama.chat(
            model=VISION_MODEL,
            messages=[{
                "role": "user",
                "content": DESCRIBE_PROMPT,
                "images": [b64],
            }],
            options={"temperature": 0.3},
        )
        text = resp.get("message", {}).get("content", "").strip()
        return text or None
    except Exception as exc:
        logger.warning("vision describe failed: %s", exc)
        return None


def describe_photos(urls: list[str], max_photos: int = 5, timeout: int = 30) -> list[str]:
    """Return one description per URL (skips failures). Capped at max_photos."""
    out: list[str] = []
    for u in urls[:max_photos]:
        desc = describe_photo(u, timeout=timeout)
        if desc:
            out.append(desc)
    return out


def enrich_match_profile(match_profile: dict, max_photos: int = 5) -> dict:
    """Populate match_profile['subject']['photo_descriptions'] in-place
    by running each photo URL through the vision model. Returns the
    modified dict for chaining.

    Looks up cached descriptions in match_profile['match_intel']['photo_descriptions']
    first to avoid redundant inference.
    """
    cached = (match_profile.get("match_intel") or {}).get("photo_descriptions")
    if cached:
        # Use the cache
        match_profile.setdefault("subject", {})["photo_descriptions"] = cached
        return match_profile

    subject = match_profile.get("subject") or {}
    photos = subject.get("photos") or []
    urls: list[str] = []
    for p in photos:
        if isinstance(p, str):
            urls.append(p)
        elif isinstance(p, dict):
            u = p.get("cdnUrl") or p.get("url")
            if u:
                urls.append(u)

    descs = describe_photos(urls, max_photos=max_photos)
    if descs:
        subject["photo_descriptions"] = descs
        match_profile["subject"] = subject
        # Also stash on match_intel so the next call hits the cache
        match_profile.setdefault("match_intel", {})["photo_descriptions"] = descs
    return match_profile
