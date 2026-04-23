"""Phase L (AI-8340) - Auto-categorize uploaded media into persona categories.

Thin wrapper over ``clapcheeks.photos.vision.analyze_photo`` that maps
the vision tag dict into one of the six persona content_library
categories. The dashboard uploader calls ``categorize_with_vision`` so
the user doesn't have to manually tag every image.

Categories
----------
Pulled from persona.content_library.categories (user 9c848c51-...):

  beach_house_work_from_home     - laptop + coastal backdrop, brand
                                   "I work from paradise"
  beach_active                   - surf, run, yoga, pickleball
  dog_faith                      - dog w/ Julian, cross necklace, church
  entrepreneur_behind_scenes     - desk, whiteboard, client screen
  ted_talk_speaking              - stage, podium, mic
  food_drinks_mission_beach      - wine, sushi, tacos, coffee shop

We do NOT try to be clever about ambiguity. The classifier returns one
category + a confidence in [0, 1]. The dashboard can show both and let
the user overrule.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("clapcheeks.content.categorize")

PERSONA_CATEGORY_KEYS: tuple[str, ...] = (
    "beach_house_work_from_home",
    "beach_active",
    "dog_faith",
    "entrepreneur_behind_scenes",
    "ted_talk_speaking",
    "food_drinks_mission_beach",
)

# Scoring rules per category. We score against the vision tag dict by
# awarding points for each matching signal. The category with the
# highest score wins; ties go to the order listed here.
#
# Keys in each rule:
#   activities / locations / food_signals / travel_signals /
#   notable_details - list of substrings; a match anywhere awards
#   that many points.
#   aesthetic / energy / solo_vs_group - expected exact token (lowercase).

_RULES: dict[str, dict[str, Any]] = {
    "beach_house_work_from_home": {
        "activities": {"laptop": 3, "posing": 1, "work": 3, "typing": 2},
        "locations": {"home": 2, "beach": 3, "outdoors": 1, "pool": 2},
        "notable_details": {"laptop": 3, "ocean_view": 2, "palm": 1, "coffee": 1},
    },
    "beach_active": {
        "activities": {
            "surfing": 4, "running": 3, "yoga": 3, "hiking": 2,
            "beach": 3, "swimming": 3, "volleyball": 2, "pickleball": 3,
            "paddleboard": 3, "kayak": 2, "active": 2,
        },
        "locations": {"beach": 3, "outdoors": 2, "pool": 1, "mountain": 1},
        "aesthetic": "athletic",
        "energy": "high",
    },
    "dog_faith": {
        "notable_details": {
            "dog_present": 5, "dog": 4, "cross": 4, "church": 4,
            "bible": 3, "necklace": 2,
        },
        "activities": {"dog_walking": 5, "church": 4, "prayer": 3},
        "locations": {"church": 4, "outdoors": 1, "home": 1},
    },
    "entrepreneur_behind_scenes": {
        "activities": {
            "typing": 3, "work": 3, "laptop": 3, "meeting": 3,
            "whiteboard": 3, "presentation": 2, "posing": 1,
        },
        "locations": {"office": 4, "home": 2, "co-working": 3, "coworking": 3},
        "notable_details": {
            "laptop": 3, "whiteboard": 3, "monitor": 2, "screen": 2,
            "desk": 2, "post-it": 2,
        },
    },
    "ted_talk_speaking": {
        "activities": {
            "speaking": 5, "presentation": 4, "public_speaking": 5,
            "teaching": 3, "posing": 1, "event": 3,
        },
        "locations": {"stage": 5, "conference": 4, "auditorium": 4, "event": 3},
        "notable_details": {
            "microphone": 4, "mic": 4, "podium": 4, "stage": 4,
            "audience": 3, "ted": 5,
        },
    },
    "food_drinks_mission_beach": {
        "activities": {"dining": 3, "drinking": 3, "brunch": 3, "coffee": 2},
        "locations": {"restaurant": 4, "bar": 3, "cafe": 3, "coffee_shop": 3},
        "food_signals": {
            "wine": 3, "cocktail": 3, "coffee": 2, "sushi": 3,
            "pizza": 2, "brunch": 3, "taco": 3, "beer": 2,
        },
    },
}


def _score_category(tags: dict[str, Any], rule: dict[str, Any]) -> float:
    """Return accumulated score for ``rule`` against ``tags``.

    Matches ``rule[key]`` substrings against the lowercased tokens in
    ``tags[key]``. For scalar fields (aesthetic/energy/solo_vs_group)
    an exact match adds 2 points.
    """
    score = 0.0
    for list_key in ("activities", "locations", "food_signals",
                     "travel_signals", "notable_details"):
        expected = rule.get(list_key)
        if not expected:
            continue
        tokens = tags.get(list_key) or []
        if isinstance(tokens, str):
            tokens = [tokens]
        normalized = [str(t).strip().lower() for t in tokens if t]
        for needle, pts in expected.items():
            needle_l = needle.lower()
            for tok in normalized:
                if needle_l in tok:
                    score += float(pts)
                    break

    for scalar_key in ("aesthetic", "energy", "solo_vs_group"):
        expected = rule.get(scalar_key)
        if not expected:
            continue
        actual = (tags.get(scalar_key) or "").strip().lower()
        if actual and expected.lower() in actual:
            score += 2.0

    return score


def classify_from_tags(tags: dict[str, Any]) -> tuple[str, float]:
    """Pick the best persona category for a vision tag dict.

    Returns ``(category, confidence)`` where confidence is in [0, 1].
    If nothing scores above zero we return
    ``("entrepreneur_behind_scenes", 0.0)`` so the dashboard can still
    display a default, but the upload UI should prompt the user to
    confirm.
    """
    if not tags:
        return "entrepreneur_behind_scenes", 0.0

    scored = []
    for cat in PERSONA_CATEGORY_KEYS:
        rule = _RULES.get(cat, {})
        s = _score_category(tags, rule)
        scored.append((cat, s))

    scored.sort(key=lambda kv: (-kv[1], PERSONA_CATEGORY_KEYS.index(kv[0])))
    best_cat, best_score = scored[0]

    total = sum(max(0.0, s) for _, s in scored) or 1.0
    confidence = round(min(1.0, best_score / total), 3) if best_score > 0 else 0.0
    return best_cat, confidence


def categorize_with_vision(
    photo_url_or_path: str,
    analyze_fn=None,
) -> dict[str, Any]:
    """Run Claude Vision on a photo and pick a persona category.

    Returns::

        {
          "category": "beach_active",
          "confidence": 0.61,
          "target_time_of_day": "golden_hour",
          "tags": { ...raw vision tag dict... }
        }

    ``analyze_fn`` lets tests inject a fake so we don't call the API.
    """
    if analyze_fn is None:
        from clapcheeks.photos.vision import analyze_photo as analyze_fn  # type: ignore

    try:
        tags = analyze_fn(photo_url_or_path) or {}
    except Exception as exc:
        log.warning("vision call failed for %s: %s", photo_url_or_path, exc)
        tags = {}

    category, confidence = classify_from_tags(tags)

    # Derive a reasonable time-of-day hint from the tags. This is
    # cosmetic - the scheduler treats everything as "anytime" unless
    # the user overrides.
    time_of_day = _guess_time_of_day(tags)

    return {
        "category": category,
        "confidence": confidence,
        "target_time_of_day": time_of_day,
        "tags": tags,
    }


def _guess_time_of_day(tags: dict[str, Any]) -> str:
    notable = [str(t).lower() for t in (tags.get("notable_details") or [])]
    activities = [str(t).lower() for t in (tags.get("activities") or [])]

    if any("sunset" in t or "golden" in t for t in notable):
        return "golden_hour"
    if any("coffee" in t or "brunch" in t for t in activities + notable):
        return "workday"
    if any("wine" in t or "cocktail" in t or "bar" in t for t in notable):
        return "evening"
    return "anytime"
