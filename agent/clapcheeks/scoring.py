"""Phase I: Rule-based match scoring (location + criteria + casual intent).

Scores every match in [0.0, 1.0] the moment Phase A syncs it, so the dashboard
can sort by `final_score` without waiting on ML. Phase H will later train a
learner on top of these rule-based scores.

Rules + weights are sourced from Supabase:
    clapcheeks_user_settings.persona.ranking_weights
for user 9c848c51-8996-4f1f-9dbf-50128e3408ea.

final_score = 0.35 * location_score + 0.65 * criteria_score
If ANY dealbreaker flag is hit -> final_score = 0.0 and flags are captured.
Casual-intent signals contribute up to +18 points into criteria_score.

Usage:
    from clapcheeks.scoring import score_match
    result = score_match(match_row, persona)
    # result = {location_score, criteria_score, final_score,
    #          dealbreaker_flags, scoring_reason, distance_miles}

CLI:
    python3 -m clapcheeks.scoring --score-all --user-id <uuid>
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("clapcheeks.scoring")

# ---------------------------------------------------------------------------
# Constants derived from the saved ranking_weights
# ---------------------------------------------------------------------------

# Theoretical max for normalization — used to convert accumulated criteria
# points into a [0, 1] criteria_score.
#
# Breakdown (with persona values as of 2026-04-20):
#   age_in_range                 +20
#   height_in_range              +10
#   body_type_match (up to 4)    +32  (8 per match, 4 preferred body tags)
#   activity_signals (up to 8)   +32  (4 per signal, 8 preferred activity tags)
#   ambition_signal               +4
#   christian_signal              +5
#   entrepreneur_signal           +6
#   dog_owner                     +5
#   casual_intent (strong)       +18
# ------------------------------------
# theoretical_max              = 132
#
# The persona brief mentioned ~105; the current preferred_tags + activity
# preferred lists are longer than the brief assumed (4 body tags, 8 activities),
# so the true ceiling is 132. We cap normalization at 1.0 regardless.
CRITERIA_THEORETICAL_MAX = 132.0

# Casual-intent point scale
CASUAL_INTENT_POINTS = {"strong": 18, "medium": 10, "none": 0, "inverse": -25}


# ---------------------------------------------------------------------------
# Distance
# ---------------------------------------------------------------------------

def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in miles between two lat/lng points."""
    R_MI = 3958.7613  # Earth radius in miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R_MI * c


def resolve_distance_miles(match_row: dict, persona: dict) -> float | None:
    """Pick the best-available distance in miles.

    Preference order:
      1. match_row["distance_miles"] (already set by Tinder/Hinge API)
      2. match_intel.distance_miles
      3. match_intel.distance_km -> convert
      4. haversine(anchor, match_row.lat/lng)
      5. None if we can't compute
    """
    d = match_row.get("distance_miles")
    if d is not None:
        try:
            return float(d)
        except (TypeError, ValueError):
            pass

    intel = match_row.get("match_intel") or {}
    if isinstance(intel, str):
        try:
            intel = json.loads(intel)
        except Exception:
            intel = {}

    for key in ("distance_miles", "distance_mi"):
        if key in intel and intel[key] is not None:
            try:
                return float(intel[key])
            except (TypeError, ValueError):
                pass

    if "distance_km" in intel and intel["distance_km"] is not None:
        try:
            return float(intel["distance_km"]) * 0.621371
        except (TypeError, ValueError):
            pass

    lat = match_row.get("latitude") or match_row.get("lat") or intel.get("lat")
    lng = match_row.get("longitude") or match_row.get("lng") or intel.get("lng")
    loc_cfg = (persona or {}).get("location") or {}
    a_lat = loc_cfg.get("anchor_lat")
    a_lng = loc_cfg.get("anchor_lng")

    if lat is not None and lng is not None and a_lat is not None and a_lng is not None:
        try:
            return haversine_miles(float(a_lat), float(a_lng), float(lat), float(lng))
        except (TypeError, ValueError):
            return None

    return None


def score_location(distance_miles: float | None, persona: dict) -> float:
    """Return [0, 1] score based on distance to the anchor.

    Piecewise linear against persona.location config:
      - <= full_score (5mi default)                  -> 1.0
      - full_score -> soft_drop (5..15 default)      -> linear 1.0 -> 0.3
      - soft_drop  -> hard_cutoff (15..30 default)   -> linear 0.3 -> 0.1
      - > hard_cutoff                                -> 0.0
      - unknown (None)                               -> 0.0
    """
    if distance_miles is None or distance_miles < 0:
        return 0.0

    loc = (persona or {}).get("location") or {}
    full = float(loc.get("max_miles_full_score", 5))
    soft = float(loc.get("max_miles_soft_drop", 15))
    hard = float(loc.get("max_miles_hard_cutoff", 30))

    d = float(distance_miles)
    if d <= full:
        return 1.0
    if d <= soft:
        if soft <= full:
            return 1.0
        frac = (d - full) / (soft - full)
        return 1.0 - frac * 0.7
    if d <= hard:
        if hard <= soft:
            return 0.3
        frac = (d - soft) / (hard - soft)
        return 0.3 - frac * 0.2
    return 0.0


# ---------------------------------------------------------------------------
# Criteria
# ---------------------------------------------------------------------------

_STRONG_PATTERNS = [
    r"here for a good time not a long time",
    r"just looking to have fun",
    r"\bno strings\b|\bnsa\b",
    r"in town for the weekend|visiting (san diego|sd|town)|\bvisiting\b",
    r"not looking for anything serious",
    r"open relationship|\benm\b|\bpoly\b|polyamor",
    r"down for whatever",
    r"short[- ]?term",
    r"something casual|casual only|casual vibes?|just casual",
    r"traveling|traveling through|\btrip\b|in town for",
]
_MEDIUM_PATTERNS = [
    r"new (to|in) (sd|san diego|town|the area)",
    r"solo traveling|travel(l)?ing solo",
    r"bachelorette|girls trip|girls'? weekend",
    r"just moved (here|to)",
    r"vacation( vibes?)?",
]
_INVERSE_PATTERNS = [
    r"looking for (something )?(serious|my person|long[- ]?term|something real|forever)",
    r"not here for hookups?|no hookups?",
    r"here for something real",
    r"if you'?re not serious,? swipe left",
    r"relationship only|marriage minded",
    r"something serious",
]

_STRONG_RE = [re.compile(p, re.IGNORECASE) for p in _STRONG_PATTERNS]
_MEDIUM_RE = [re.compile(p, re.IGNORECASE) for p in _MEDIUM_PATTERNS]
_INVERSE_RE = [re.compile(p, re.IGNORECASE) for p in _INVERSE_PATTERNS]

_KIDS_RE = re.compile(
    r"\b(my (kid|kids|son|daughter|child(ren)?)|mom of|mother of|#momlife|"
    r"i have (a |two |three |)(kid|kids|son|daughter|children)|"
    r"single mom|single mum|kids? are my world)",
    re.IGNORECASE,
)
_DRUG_RE = re.compile(
    r"\b(420( friendly)?|smoke weed|stoner|wake[- ]?n[- ]?bake|wake and bake|"
    r"cocaine|\bblow\b|\bmdma\b|\bmolly\b|drug (friendly|buddy)|"
    r"snort|user of drugs)\b",
    re.IGNORECASE,
)
_CHRISTIAN_RE = re.compile(
    r"\b(christian|jesus|follower of christ|god first|kingdom minded|"
    r"church|faith[- ]centered|\bchrist\b|bible|proverbs \d+:|"
    r"jer(emiah)? 29:11|phil(ippians)? \d+:\d+)\b",
    re.IGNORECASE,
)
_ENTREPRENEUR_RE = re.compile(
    r"\b(entrepreneur|founder|ceo|co[- ]?founder|business owner|"
    r"self[- ]employed|my own business|own company|start[- ]?up)\b",
    re.IGNORECASE,
)
_AMBITION_RE = re.compile(
    r"\b(driven|ambitious|goal[- ]oriented|hustl(e|er|ing)|"
    r"building something|on a mission|10x|going places|grinding|"
    r"chasing (goals|dreams)|career[- ]driven)\b",
    re.IGNORECASE,
)
_DOG_RE = re.compile(
    r"\b(my dog|dog mom|dog owner|pup parent|fur mom|fur baby|"
    r"golden retriever|labrador|\bpuppy\b|dog is my (kid|baby|world|everything|whole world))\b",
    re.IGNORECASE,
)
_TATTOO_RE = re.compile(
    r"\b(tattooed|heavily tattooed|full[- ]sleeve|sleeves? (tattoo|of tattoos)|"
    r"tatted up|full body tattoos|neck tattoo|face tattoo|lots of ink)\b",
    re.IGNORECASE,
)
_SMOKING_RE = re.compile(
    r"\b(smoker|smoking|cigarette|marlboro|vaper|vaping|juul|dab pen)\b",
    re.IGNORECASE,
)


def _normalize_tags(raw: Any) -> list[str]:
    """Vision summary / intel tags can arrive as a list, a JSON string, or CSV."""
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


def _gather_text(match_row: dict) -> str:
    """Concatenate every text field we'll regex against."""
    parts: list[str] = []
    for k in ("bio", "job", "school", "match_name", "name"):
        v = match_row.get(k)
        if v:
            parts.append(str(v))

    prompts = match_row.get("prompts_jsonb") or match_row.get("prompts")
    if isinstance(prompts, str):
        try:
            prompts = json.loads(prompts)
        except Exception:
            prompts = []
    if isinstance(prompts, list):
        for p in prompts:
            if isinstance(p, dict):
                q = p.get("question") or p.get("q")
                a = p.get("answer") or p.get("a")
                if q:
                    parts.append(str(q))
                if a:
                    parts.append(str(a))
            elif isinstance(p, str):
                parts.append(p)

    intel = match_row.get("match_intel") or {}
    if isinstance(intel, str):
        try:
            intel = json.loads(intel)
        except Exception:
            intel = {}
    if isinstance(intel, dict):
        for k in (
            "relationship_goals",
            "intentions",
            "tinder_relationship_goals",
            "hinge_intentions",
            "looking_for",
            "dating_intent",
        ):
            v = intel.get(k)
            if v:
                parts.append(str(v))

    ig = match_row.get("instagram_intel") or {}
    if isinstance(ig, str):
        try:
            ig = json.loads(ig)
        except Exception:
            ig = {}
    if isinstance(ig, dict):
        bio = ig.get("bio") or ig.get("instagram_bio")
        if bio:
            parts.append(str(bio))

    return "\n".join(parts)


def detect_casual_intent(text: str) -> tuple[str, list[str]]:
    """Return (tier, matched_phrases) where tier in {strong, medium, none, inverse}.

    Inverse wins over strong (if she explicitly says she wants long-term,
    don't boost even if she also travels). Strong beats medium.
    """
    inverse_hits = [r.pattern for r in _INVERSE_RE if r.search(text)]
    if inverse_hits:
        return "inverse", inverse_hits

    strong_hits = [r.pattern for r in _STRONG_RE if r.search(text)]
    if strong_hits:
        return "strong", strong_hits

    medium_hits = [r.pattern for r in _MEDIUM_RE if r.search(text)]
    if medium_hits:
        return "medium", medium_hits

    return "none", []


def detect_dealbreakers(match_row: dict) -> list[str]:
    """Return list of dealbreaker flag names that fired on this match."""
    flags: list[str] = []

    text = _gather_text(match_row)
    vision_tags = _normalize_tags(match_row.get("vision_summary"))

    if _KIDS_RE.search(text):
        flags.append("bio_mentions_kids")

    if _DRUG_RE.search(text):
        flags.append("drug_signals")

    # Tattoo dealbreaker: either vision tag says so OR bio explicitly does
    tattoo_direct_tags = {
        "excessive_tattoos", "heavily_tattooed", "full_sleeve_tattoos",
        "face_tattoo", "neck_tattoo",
    }
    has_tattoo_tag = any(
        t in tattoo_direct_tags or (
            "tattoo" in t and any(mod in t for mod in ("excessive", "heavy", "full"))
        )
        for t in vision_tags
    )
    if has_tattoo_tag:
        flags.append("excessive_tattoos")
    elif _TATTOO_RE.search(text):
        flags.append("excessive_tattoos")

    smoking_tags = {"smoking", "smoker", "cigarette", "vaping", "vape"}
    if any(t in smoking_tags for t in vision_tags):
        flags.append("smoking_in_photos")
    elif _SMOKING_RE.search(text):
        flags.append("smoking_in_photos")

    return flags


def score_criteria(match_row: dict, persona: dict) -> tuple[float, dict]:
    """Return (criteria_score in [0,1], breakdown dict).

    Accumulates integer points per rule in ranking_weights, then normalizes
    against CRITERIA_THEORETICAL_MAX, capped at 1.0 and floored at 0.0.
    """
    rules = (((persona or {}).get("criteria") or {}).get("rules")) or {}
    breakdown: dict[str, int] = {}
    reasons: list[str] = []

    # No rules configured -> no criteria signal at all (not even defaults).
    # This lets callers pass an empty persona to get a pure location score.
    if not rules:
        return 0.0, {"points": 0, "breakdown": breakdown, "reasons": reasons}

    # --- Age ---
    age_cfg = rules.get("age_in_range") or {}
    age_range = age_cfg.get("range") or [21, 33]
    age_pts = int(age_cfg.get("points", 20))
    age_penalty = int(age_cfg.get("outside_penalty", -40))
    age = match_row.get("age")
    if age is not None:
        try:
            age_int = int(age)
            if age_range[0] <= age_int <= age_range[1]:
                breakdown["age_in_range"] = age_pts
                reasons.append(f"age {age_int} in range")
            else:
                breakdown["age_in_range"] = age_penalty
                reasons.append(f"age {age_int} outside range")
        except (TypeError, ValueError):
            pass

    # --- Height ---
    h_cfg = rules.get("height_in_range") or {}
    h_range = h_cfg.get("range_in") or [63, 69]
    h_pts = int(h_cfg.get("points", 10))
    h_pen = int(h_cfg.get("outside_penalty", -5))
    h_missing = int(h_cfg.get("missing_penalty", 0))
    height = match_row.get("height_in") or match_row.get("height_inches")
    if height is None:
        intel = match_row.get("match_intel") or {}
        if isinstance(intel, str):
            try:
                intel = json.loads(intel)
            except Exception:
                intel = {}
        if isinstance(intel, dict):
            height = intel.get("height_in") or intel.get("height_inches")
    if height is not None:
        try:
            h_int = int(height)
            if h_range[0] <= h_int <= h_range[1]:
                breakdown["height_in_range"] = h_pts
                reasons.append(f"height {h_int}in in range")
            else:
                breakdown["height_in_range"] = h_pen
                reasons.append(f"height {h_int}in outside range")
        except (TypeError, ValueError):
            breakdown["height_in_range"] = h_missing
    else:
        breakdown["height_in_range"] = h_missing

    # --- Body type match (vision tags vs preferred) ---
    bt_cfg = rules.get("body_type_match") or {}
    bt_preferred = set(
        t.lower() for t in bt_cfg.get("preferred_tags", ["fit", "thin", "athletic", "active"])
    )
    bt_pts_per = int(bt_cfg.get("points_per_match", 8))
    vision_tags = _normalize_tags(match_row.get("vision_summary"))
    vision_tag_set = set(vision_tags)
    body_hits = bt_preferred & vision_tag_set
    if body_hits:
        breakdown["body_type_match"] = bt_pts_per * len(body_hits)
        reasons.append(f"body: {', '.join(sorted(body_hits))}")

    # --- Activity signals (vision + IG) ---
    act_cfg = rules.get("activity_signals") or {}
    act_preferred = set(
        t.lower() for t in act_cfg.get(
            "preferred",
            ["beach", "surfing", "yoga", "gym", "outdoors", "hiking", "running", "volleyball"],
        )
    )
    act_pts_per = int(act_cfg.get("points_per_signal", 4))

    ig_tags: list[str] = []
    ig = match_row.get("instagram_intel") or {}
    if isinstance(ig, str):
        try:
            ig = json.loads(ig)
        except Exception:
            ig = {}
    if isinstance(ig, dict):
        ig_tags = _normalize_tags(ig.get("interests") or ig.get("tags"))

    activity_hits = act_preferred & (vision_tag_set | set(ig_tags))
    if activity_hits:
        breakdown["activity_signals"] = act_pts_per * len(activity_hits)
        reasons.append(f"activities: {', '.join(sorted(activity_hits))}")

    # --- Positive bonuses (text regex) ---
    bonuses = rules.get("positive_bonuses") or {}
    text = _gather_text(match_row)

    if _CHRISTIAN_RE.search(text):
        pts = int((bonuses.get("christian_signal") or {}).get("points", 5))
        breakdown["christian_signal"] = pts
        reasons.append("Christian signal")

    if _ENTREPRENEUR_RE.search(text):
        pts = int((bonuses.get("entrepreneur_signal") or {}).get("points", 6))
        breakdown["entrepreneur_signal"] = pts
        reasons.append("entrepreneur")

    if _AMBITION_RE.search(text):
        pts = int((bonuses.get("ambition_signals") or {}).get("points", 4))
        breakdown["ambition_signals"] = pts
        reasons.append("ambition signal")

    dog_in_vision = any("dog" in t for t in vision_tag_set)
    if dog_in_vision or _DOG_RE.search(text):
        pts = int((bonuses.get("dog_owner") or {}).get("points", 5))
        breakdown["dog_owner"] = pts
        reasons.append("dog owner")

    # --- Casual intent (the big one) ---
    tier, _matched = detect_casual_intent(text)
    if tier != "none":
        pts = CASUAL_INTENT_POINTS[tier]
        breakdown[f"casual_intent_{tier}"] = pts
        if tier == "strong":
            reasons.append("casual intent (strong)")
        elif tier == "medium":
            reasons.append("casual intent (medium)")
        elif tier == "inverse":
            reasons.append("serious-only (inverse)")

    total = sum(breakdown.values())
    score = max(0.0, min(1.0, total / CRITERIA_THEORETICAL_MAX))
    return score, {"points": total, "breakdown": breakdown, "reasons": reasons}


# ---------------------------------------------------------------------------
# Top-level score_match
# ---------------------------------------------------------------------------

def score_match(
    match_row: dict,
    persona: dict,
    *,
    preference_model_v: dict | None = None,
    n_decisions: int = 0,
) -> dict:
    """Score a single match row against a persona's ranking_weights.

    Args:
        match_row: dict with any of {age, bio, prompts_jsonb, vision_summary,
            match_intel, instagram_intel, distance_miles, latitude, longitude,
            height_in, ...}. Unknown fields are ignored; missing fields are
            treated as neutral except where rules define explicit penalties.
        persona: dict from clapcheeks_user_settings.persona. Both shapes are
            accepted: persona["ranking_weights"]["location"|"criteria"] or
            persona["location"|"criteria"] directly.
        preference_model_v: PHASE-H — serialized ML model from
            clapcheeks_user_settings.preference_model_v. If provided AND
            ``n_decisions`` puts the user into a non-zero blend band the
            model score is mixed with the rule score via
            clapcheeks.ml.trainer.blend_with_rules.
        n_decisions: PHASE-H — how many decisions the user has logged.
            Drives the blend band. Defaults to 0 so legacy callers get
            pure rule-based scoring.

    Returns:
        {
            "location_score":     float in [0, 1],
            "criteria_score":     float in [0, 1],
            "final_score":        float in [0, 1],   # 0.0 if dealbreaker
            "dealbreaker_flags":  list[str],
            "scoring_reason":     str,               # human-readable
            "distance_miles":     float | None,
            "model_score":        float | None,      # PHASE-H
            "rule_score":         float,             # PHASE-H: unblended
        }
    """
    # Accept persona["ranking_weights"] wrapper or the weights dict directly.
    if persona and "ranking_weights" in persona:
        weights = persona["ranking_weights"]
    else:
        weights = persona or {}

    flags = detect_dealbreakers(match_row)

    distance = resolve_distance_miles(match_row, weights)
    loc_score = score_location(distance, weights)
    loc_weight = float((weights.get("location") or {}).get("location_weight", 0.35))

    crit_score, crit_detail = score_criteria(match_row, weights)
    crit_weight = float((weights.get("criteria") or {}).get("criteria_weight", 0.65))

    if flags:
        rule_final = 0.0
    else:
        rule_final = loc_weight * loc_score + crit_weight * crit_score
        rule_final = max(0.0, min(1.0, rule_final))

    # PHASE-H — blend in the ML preference score when a model is available.
    # Dealbreakers still hard-floor the final score so the model cannot undo
    # kid / drug / smoking / tattoo auto-passes.
    model_score: float | None = None
    final = rule_final
    if preference_model_v and not flags:
        try:
            # Lazy import keeps scoring.py light for callers that never need
            # the ML path (unit tests, the rule-only rescore CLI, etc.).
            from clapcheeks.ml.features import extract_features
            from clapcheeks.ml.trainer import blend_with_rules, score_with_model

            feats = extract_features(match_row)
            # Feed the rule score into the feature dict so the model can learn
            # "when rule says yes, I tend to like" without duplicating work.
            feats["rule_final_score"] = rule_final
            model_score = score_with_model(feats, preference_model_v)
            if model_score is not None:
                final = blend_with_rules(rule_final, model_score, n_decisions)
        except Exception as exc:
            # Never fail Phase I because the ML module blew up — degrade
            # gracefully to the pure rule-based score.
            log.debug("score_match: ML blend skipped (%s)", exc)
            model_score = None
            final = rule_final

    reason_parts: list[str] = []
    if distance is not None:
        reason_parts.append(f"{distance:.1f}mi")
    reason_parts.extend(crit_detail["reasons"])
    if flags:
        reason_parts.append(f"DEALBREAKER: {', '.join(flags)}")
    if model_score is not None:
        reason_parts.append(f"ml={model_score:.2f}")

    if reason_parts:
        reason = " + ".join(reason_parts) + f" -> {final:.2f}"
    else:
        reason = f"no signals -> {final:.2f}"

    return {
        "location_score": round(loc_score, 4),
        "criteria_score": round(crit_score, 4),
        "final_score": round(final, 4),
        "dealbreaker_flags": flags,
        "scoring_reason": reason,
        "distance_miles": round(distance, 2) if distance is not None else None,
        # PHASE-H blend fields — None when no model or insufficient decisions.
        "model_score": round(model_score, 4) if model_score is not None else None,
        "rule_score": round(rule_final, 4),
        # Debug-only; NOT persisted to DB unless the caller asks
        "_criteria_breakdown": crit_detail["breakdown"],
        "_criteria_points": crit_detail["points"],
    }


# ---------------------------------------------------------------------------
# Persona loader
# ---------------------------------------------------------------------------

def _load_env_from_web_dotenv() -> None:
    """Best-effort: source web/.env.local so Supabase URL / key env vars work."""
    candidates = [
        Path(__file__).resolve().parents[2] / "web" / ".env.local",
        Path.cwd() / "web" / ".env.local",
        Path.home() / ".clapcheeks" / ".env",
    ]
    for env_file in candidates:
        if not env_file.exists():
            continue
        try:
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))
        except Exception:
            continue


def _supabase_creds() -> tuple[str, str]:
    _load_env_from_web_dotenv()
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Supabase creds not found (set SUPABASE_URL/SUPABASE_SERVICE_KEY or "
            "NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)"
        )
    return url, key


def load_persona(user_id: str) -> dict:
    """Fetch the persona (incl. ranking_weights) for a user from Supabase."""
    import requests

    url, key = _supabase_creds()
    resp = requests.get(
        f"{url}/rest/v1/clapcheeks_user_settings",
        params={"user_id": f"eq.{user_id}", "select": "persona"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=15,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        raise RuntimeError(f"No clapcheeks_user_settings row for user {user_id}")
    persona = rows[0].get("persona") or {}
    if "ranking_weights" not in persona:
        raise RuntimeError(
            f"Persona for user {user_id} is missing ranking_weights. "
            "Seed it before running scoring."
        )
    return persona


# PHASE-H — Model + decision-count loader shared by the daemon + CLI.
def load_preference_model(user_id: str) -> tuple[dict | None, int]:
    """Fetch ``(preference_model_v, n_decisions)`` for ``user_id``.

    Returns ``(None, 0)`` when no model has been trained yet or when any
    Supabase round-trip fails — Phase I degrades to pure rules in that
    case. Never raises; ML is strictly best-effort.
    """
    import requests

    try:
        url, key = _supabase_creds()
    except Exception as exc:
        log.debug("load_preference_model: creds unavailable (%s)", exc)
        return None, 0

    try:
        resp = requests.get(
            f"{url}/rest/v1/clapcheeks_user_settings",
            params={
                "user_id": f"eq.{user_id}",
                "select": "preference_model_v",
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json() or []
        model_v = rows[0].get("preference_model_v") if rows else None
    except Exception as exc:
        log.debug("load_preference_model: settings fetch failed (%s)", exc)
        model_v = None

    try:
        # HEAD + Prefer: count=exact returns the Content-Range header with total.
        resp = requests.get(
            f"{url}/rest/v1/clapcheeks_swipe_decisions",
            params={"user_id": f"eq.{user_id}", "select": "id", "limit": "1"},
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Prefer": "count=exact",
            },
            timeout=10,
        )
        total = 0
        if resp.status_code < 300:
            content_range = resp.headers.get("Content-Range") or ""
            if "/" in content_range:
                tail = content_range.rsplit("/", 1)[-1]
                if tail and tail != "*":
                    try:
                        total = int(tail)
                    except ValueError:
                        total = 0
    except Exception as exc:
        log.debug("load_preference_model: decision count failed (%s)", exc)
        total = 0

    return model_v, total


# ---------------------------------------------------------------------------
# Batch scoring (used by daemon + CLI)
# ---------------------------------------------------------------------------

def score_all_unscored(
    user_id: str,
    persona: dict | None = None,
    limit: int = 500,
    include_rescore: bool = False,
    *,
    preference_model_v: dict | None = None,
    n_decisions: int | None = None,
) -> dict:
    """Score every match where final_score IS NULL (or all matches with include_rescore).

    ``preference_model_v`` and ``n_decisions`` are PHASE-H hooks — when
    omitted the scorer auto-loads them once per call. Callers that already
    have them in memory (e.g. the scoring daemon thread caching the model)
    can pass them in to skip the round-trip.

    Returns {scanned, scored, skipped, errors}.
    """
    import requests

    url, key = _supabase_creds()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    if persona is None:
        persona = load_persona(user_id)

    # PHASE-H — load the ML model + decision count if not pre-supplied.
    if preference_model_v is None and n_decisions is None:
        try:
            preference_model_v, n_decisions = load_preference_model(user_id)
        except Exception as exc:
            log.debug("score_all_unscored: model load failed (%s)", exc)
            preference_model_v, n_decisions = None, 0
    if n_decisions is None:
        n_decisions = 0

    query = {
        "user_id": f"eq.{user_id}",
        "select": (
            "id,user_id,platform,match_id,match_name,name,age,bio,"
            "photos_jsonb,prompts_jsonb,job,school,instagram_handle,"
            "birth_date,zodiac,match_intel,vision_summary,instagram_intel,"
            "status,final_score,distance_miles"
        ),
        "limit": str(limit),
    }
    if not include_rescore:
        query["final_score"] = "is.null"

    resp = requests.get(
        f"{url}/rest/v1/clapcheeks_matches",
        params=query,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    resp.raise_for_status()
    matches = resp.json()

    stats = {"scanned": len(matches), "scored": 0, "skipped": 0, "errors": 0}

    for m in matches:
        try:
            result = score_match(
                m,
                persona,
                preference_model_v=preference_model_v,
                n_decisions=n_decisions,
            )
            patch = {
                "location_score": result["location_score"],
                "criteria_score": result["criteria_score"],
                "final_score": result["final_score"],
                "dealbreaker_flags": result["dealbreaker_flags"],
                "scoring_reason": result["scoring_reason"],
                "distance_miles": result["distance_miles"],
                "scored_at": datetime.now(timezone.utc).isoformat(),
            }
            r = requests.patch(
                f"{url}/rest/v1/clapcheeks_matches",
                params={"id": f"eq.{m['id']}"},
                headers=headers,
                json=patch,
                timeout=15,
            )
            if r.status_code >= 300:
                log.error("PATCH failed for %s: %s %s", m["id"], r.status_code, r.text[:200])
                stats["errors"] += 1
            else:
                stats["scored"] += 1
                log.info(
                    "Scored %s (%s): %.2f [%s]",
                    m.get("name") or m.get("match_name") or m["id"][:8],
                    m.get("platform"),
                    result["final_score"],
                    result["scoring_reason"],
                )
        except Exception as exc:
            log.error("Scoring failed for match %s: %s", m.get("id"), exc)
            stats["errors"] += 1

    return stats


def score_match_by_id(match_id: str, user_id: str | None = None) -> dict | None:
    """Load a single match by id, score it, and PATCH the row.

    Used by the daemon right after Phase A inserts a match, and by the
    rescore path when Phase B updates vision_summary.
    """
    import requests

    url, key = _supabase_creds()
    headers_get = {"apikey": key, "Authorization": f"Bearer {key}"}
    params = {
        "id": f"eq.{match_id}",
        "select": (
            "id,user_id,platform,match_id,match_name,name,age,bio,"
            "photos_jsonb,prompts_jsonb,job,school,instagram_handle,"
            "birth_date,zodiac,match_intel,vision_summary,instagram_intel,"
            "status,final_score,distance_miles"
        ),
    }
    resp = requests.get(
        f"{url}/rest/v1/clapcheeks_matches",
        params=params,
        headers=headers_get,
        timeout=15,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        return None

    row = rows[0]
    target_user = user_id or row.get("user_id")
    if not target_user:
        log.error("score_match_by_id: no user_id for match %s", match_id)
        return None

    persona = load_persona(target_user)
    # PHASE-H — load ML model + decision count; falls back to pure rules.
    try:
        preference_model_v, n_decisions = load_preference_model(target_user)
    except Exception:
        preference_model_v, n_decisions = None, 0
    result = score_match(
        row,
        persona,
        preference_model_v=preference_model_v,
        n_decisions=n_decisions,
    )

    patch_headers = {
        **headers_get,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    patch = {
        "location_score": result["location_score"],
        "criteria_score": result["criteria_score"],
        "final_score": result["final_score"],
        "dealbreaker_flags": result["dealbreaker_flags"],
        "scoring_reason": result["scoring_reason"],
        "distance_miles": result["distance_miles"],
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.patch(
        f"{url}/rest/v1/clapcheeks_matches",
        params={"id": f"eq.{match_id}"},
        headers=patch_headers,
        json=patch,
        timeout=15,
    )
    r.raise_for_status()
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m clapcheeks.scoring",
        description="Rule-based match scoring (Phase I)",
    )
    parser.add_argument(
        "--score-all",
        action="store_true",
        help="Score every match where final_score IS NULL for --user-id",
    )
    parser.add_argument(
        "--rescore-all",
        action="store_true",
        help="Rescore every match for --user-id (includes already-scored)",
    )
    parser.add_argument("--user-id", required=True, help="auth.users.id")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    if not (args.score_all or args.rescore_all):
        parser.error("Pass --score-all or --rescore-all")

    persona = load_persona(args.user_id)
    stats = score_all_unscored(
        args.user_id,
        persona=persona,
        limit=args.limit,
        include_rescore=args.rescore_all,
    )
    print(json.dumps(stats, indent=2))
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
