"""Deterministic feature extraction for Phase H preference learner.

Takes whatever Phase A + Phase B + Phase C + Phase I have written on a
clapcheeks_matches row and converts it into a flat ``{feature_name: float}``
dict with ~50-80 features. The output is suitable as input for the trainer
and for the serialized inference path.

Privacy: NO raw photos, bio text, names, or free-form strings are stored.
Tags are one-hot, vision-summary tokens are bag-of-words on a curated
vocabulary, and bios contribute via a small set of signal regexes that
also power Phase I scoring — never raw characters.

All outputs are numeric (0/1 or normalized float in [0, 1]); the trainer
does not normalize again, so this is the one place feature scale is set.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable


# ---------------------------------------------------------------------------
# Curated vocabularies — intentionally fixed lists so that training + serving
# features line up byte-for-byte. Adding entries is a breaking change (must
# retrain). Removing is fine (old models just ignore missing keys).
# ---------------------------------------------------------------------------

BODY_TAGS: tuple[str, ...] = (
    "fit", "thin", "athletic", "active",
    "curvy", "plus_size", "overweight",
)

ACTIVITY_TAGS: tuple[str, ...] = (
    "beach", "surfing", "yoga", "gym", "outdoors", "hiking", "running",
    "volleyball", "travel", "coffee", "wine", "dancing", "concert",
    "brunch", "pool", "boat", "festival", "clubbing",
)

VISION_VOCAB: tuple[str, ...] = (
    "beach", "gym", "yoga", "sunset", "city", "mountain", "pool",
    "restaurant", "bar", "club", "concert", "festival", "hike", "run",
    "surf", "boat", "ski", "snow", "dog", "cat", "friend_group",
    "solo", "couple_pose", "bikini", "athleisure", "dress_up", "casual",
    "formal", "tattoo", "no_tattoo", "piercing", "smile", "serious",
)

# Ranked casual-intent tiers — mirror clapcheeks.scoring.detect_casual_intent
# but stored as a numeric score so the model can weight it directly.
CASUAL_INTENT_SCORE = {
    "strong": 3.0,
    "medium": 2.0,
    "none": 1.0,
    "inverse": 0.0,
}


_DOG_RE = re.compile(r"\b(dog|puppy|pup|fur[- ]?baby|golden retriever|labrador)\b", re.IGNORECASE)
_CHRISTIAN_RE = re.compile(r"\b(christian|jesus|church|faith|bible|\bchrist\b)\b", re.IGNORECASE)
_ENTREPRENEUR_RE = re.compile(r"\b(entrepreneur|founder|ceo|business owner|self[- ]employed|start[- ]?up)\b", re.IGNORECASE)
_AMBITION_RE = re.compile(
    r"\b(ambitious|driven|goal[- ]oriented|hustl|grinding|10x|career[- ]driven|"
    r"building something|on a mission|chasing (goals|dreams)|going places)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_tags(raw: Any) -> list[str]:
    """Accept list / dict / JSON-string / CSV-string tag blobs."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(t).strip().lower() for t in raw if t]
    if isinstance(raw, dict):
        tags = raw.get("tags")
        if isinstance(tags, list):
            return [str(t).strip().lower() for t in tags if t]
        return [k.strip().lower() for k, v in raw.items() if v]
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        if s.startswith("[") or s.startswith("{"):
            try:
                return _normalize_tags(json.loads(s))
            except Exception:
                pass
        return [t.strip().lower() for t in s.split(",") if t.strip()]
    return []


def _clamp(value: float, lo: float, hi: float) -> float:
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value


def _detect_casual_intent_tier(summary: str | None) -> str:
    if not summary:
        return "none"
    try:
        # Lazy import — avoid circular: scoring imports features only in the
        # trainer via trainer.fit/blend, not here.
        from clapcheeks.scoring import detect_casual_intent

        tier, _ = detect_casual_intent(summary)
        return tier
    except Exception:
        return "none"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def feature_keys() -> list[str]:
    """Ordered list of every feature name produced by ``extract_features``.

    Used by the trainer to keep training + inference matrices aligned.
    """
    keys: list[str] = [
        "age_norm",
        "age_in_range",
        "distance_norm",
        "distance_in_range",
        "height_norm",
        "height_in_range",
        "casual_intent_score",
        "christian_signal",
        "entrepreneur_signal",
        "ambition_signal",
        "dog_signal",
        "ig_post_count_norm",
        "ig_following_norm",
        "ig_follower_norm",
        "vision_token_count_norm",
        "photo_count_norm",
        "bio_len_norm",
        "has_instagram",
        "has_vision_summary",
        "rule_final_score",
    ]
    keys += [f"body_{t}" for t in BODY_TAGS]
    keys += [f"activity_{t}" for t in ACTIVITY_TAGS]
    keys += [f"vision_{t}" for t in VISION_VOCAB]
    return keys


def extract_features(
    match: dict,
    vision_summary: str | None = None,
    ig_intel: dict | None = None,
) -> dict[str, float]:
    """Flatten a match row into a numeric feature dict.

    Both ``vision_summary`` and ``ig_intel`` can also be pulled from the
    match row itself; explicit args win for callers that have them in
    memory (e.g. right after Phase B / Phase C write).
    """
    feats: dict[str, float] = {k: 0.0 for k in feature_keys()}

    # --- Age (0 .. 1 over 18..60) + in-range indicator -------------------
    age = match.get("age")
    try:
        age_int = int(age) if age is not None else None
    except (TypeError, ValueError):
        age_int = None
    if age_int is not None:
        feats["age_norm"] = _clamp((age_int - 18) / 42.0, 0.0, 1.0)
        feats["age_in_range"] = 1.0 if 21 <= age_int <= 33 else 0.0

    # --- Distance (0 .. 1 over 0..50mi) + in-range -----------------------
    dist = match.get("distance_miles")
    try:
        dist_f = float(dist) if dist is not None else None
    except (TypeError, ValueError):
        dist_f = None
    if dist_f is not None and dist_f >= 0:
        feats["distance_norm"] = _clamp(1.0 - (dist_f / 50.0), 0.0, 1.0)
        feats["distance_in_range"] = 1.0 if dist_f <= 15 else 0.0

    # --- Height ----------------------------------------------------------
    height = match.get("height_in")
    if height is None:
        intel = match.get("match_intel") or {}
        if isinstance(intel, str):
            try:
                intel = json.loads(intel)
            except Exception:
                intel = {}
        if isinstance(intel, dict):
            height = intel.get("height_in") or intel.get("height_inches")
    try:
        h_int = int(height) if height is not None else None
    except (TypeError, ValueError):
        h_int = None
    if h_int is not None:
        feats["height_norm"] = _clamp((h_int - 55) / 20.0, 0.0, 1.0)
        feats["height_in_range"] = 1.0 if 63 <= h_int <= 69 else 0.0

    # --- Casual intent tier ---------------------------------------------
    # Leave as 0.0 when the bio is missing entirely so that truly-empty
    # rows remain all-zero feature vectors (the model reads that as "no
    # signal" and the feature bucket never gets the 'none' baseline).
    bio_for_intent = match.get("bio")
    if bio_for_intent:
        tier = _detect_casual_intent_tier(bio_for_intent)
        feats["casual_intent_score"] = CASUAL_INTENT_SCORE.get(tier, 1.0) / 3.0

    # --- Bio signal regexes ---------------------------------------------
    bio = match.get("bio") or ""
    if _CHRISTIAN_RE.search(bio):
        feats["christian_signal"] = 1.0
    if _ENTREPRENEUR_RE.search(bio):
        feats["entrepreneur_signal"] = 1.0
    if _AMBITION_RE.search(bio):
        feats["ambition_signal"] = 1.0
    if _DOG_RE.search(bio):
        feats["dog_signal"] = 1.0

    feats["bio_len_norm"] = _clamp(len(bio) / 500.0, 0.0, 1.0)

    # --- Body + activity + vision tags ----------------------------------
    vision_raw = vision_summary if vision_summary is not None else match.get("vision_summary")
    vision_tags = set(_normalize_tags(vision_raw))
    for tag in BODY_TAGS:
        if tag in vision_tags:
            feats[f"body_{tag}"] = 1.0
    for tag in ACTIVITY_TAGS:
        if tag in vision_tags:
            feats[f"activity_{tag}"] = 1.0
    for tag in VISION_VOCAB:
        if tag in vision_tags:
            feats[f"vision_{tag}"] = 1.0
    feats["vision_token_count_norm"] = _clamp(len(vision_tags) / 20.0, 0.0, 1.0)
    feats["has_vision_summary"] = 1.0 if vision_tags else 0.0

    # --- IG intel --------------------------------------------------------
    ig = ig_intel if ig_intel is not None else match.get("instagram_intel") or {}
    if isinstance(ig, str):
        try:
            ig = json.loads(ig)
        except Exception:
            ig = {}
    if isinstance(ig, dict) and ig:
        feats["has_instagram"] = 1.0
        feats["ig_post_count_norm"] = _clamp(float(ig.get("post_count") or 0) / 500.0, 0.0, 1.0)
        feats["ig_following_norm"] = _clamp(float(ig.get("following_count") or 0) / 2000.0, 0.0, 1.0)
        feats["ig_follower_norm"] = _clamp(float(ig.get("follower_count") or 0) / 10000.0, 0.0, 1.0)
        # Merge IG interest tags into activity one-hots
        for tag in _normalize_tags(ig.get("interests") or ig.get("tags")):
            if tag in ACTIVITY_TAGS:
                feats[f"activity_{tag}"] = 1.0

    # --- Photo count -----------------------------------------------------
    photos = match.get("photos_jsonb") or []
    if isinstance(photos, str):
        try:
            photos = json.loads(photos)
        except Exception:
            photos = []
    if isinstance(photos, list):
        feats["photo_count_norm"] = _clamp(len(photos) / 9.0, 0.0, 1.0)

    # --- Rule-based score (Phase I) feedback loop ------------------------
    rule = match.get("final_score")
    try:
        if rule is not None:
            feats["rule_final_score"] = _clamp(float(rule), 0.0, 1.0)
    except (TypeError, ValueError):
        pass

    return feats


def features_to_vector(feats: dict[str, float], keys: Iterable[str] | None = None) -> list[float]:
    """Convert a feature dict to an ordered list of floats using ``keys``.

    Missing keys -> 0.0. Unknown keys in ``feats`` are ignored.
    """
    order = list(keys) if keys is not None else feature_keys()
    return [float(feats.get(k, 0.0)) for k in order]
