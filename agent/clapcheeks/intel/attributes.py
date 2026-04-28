"""AI-8814 — Match attribute extraction + tagging.

Extracts structured signals from match conversations and persists them to
``clapcheeks_matches.attributes`` (JSONB). The schema supports 6 categories:

    dietary   — food preferences, sobriety / alcohol stance
    allergy   — LIFE-SAFETY food allergies and medical intolerances
    schedule  — availability patterns, morning/night person, work hours
    lifestyle — hobbies, fitness, pets, smoking, religion
    logistics — distance, kids, living situation
    comms     — texting style, response speed, platform preferences

Every attribute carries:
    value               — human-readable label (e.g. "vegan", "morning person")
    confidence          — float 0.0–1.0 (self-reported by the model)
    source_msg_excerpt  — ≤100 char snippet from the triggering message
    source_msg_index    — index in the messages list

Operator overrides are stored in ``attributes._dismissed[]`` and respected on
subsequent extraction runs — dismissed values are never re-added.

Usage::

    from clapcheeks.intel.attributes import extract_attributes, merge_attributes
    delta   = extract_attributes(messages, prior=row.get("attributes"), persona=p)
    merged  = merge_attributes(row.get("attributes") or {}, delta)
    supabase.patch(match_id, {"attributes": merged, "attributes_updated_at": now})

AI-8814
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default category definitions — overridable via persona.attribute_categories
# ---------------------------------------------------------------------------

DEFAULT_CATEGORIES: dict[str, str] = {
    "dietary": (
        "Food preferences, diet restrictions, and alcohol/sobriety stance. "
        "Includes: vegan, vegetarian, pescatarian, dairy-free, gluten-free, halal, kosher, "
        "sober, sober-curious, dry January, alcohol-free, non-drinker. "
        "LIFE-SAFETY allergies go in the 'allergy' category instead."
    ),
    "allergy": (
        "LIFE-SAFETY food allergies and medical intolerances. "
        "Includes: nut allergy, peanut allergy, shellfish allergy, celiac disease, "
        "lactose intolerance with medical consequences, any self-reported allergy. "
        "These are rendered with a red warning treatment — only include if she explicitly "
        "described an allergy or intolerance, not just a dislike."
    ),
    "schedule": (
        "Availability patterns, work hours, and time orientation. "
        "Includes: morning person, night owl, early bird, 9-5, shift work, remote/WFH, "
        "in-office, weekend availability, travel cadence, timezone signals."
    ),
    "lifestyle": (
        "Hobbies, fitness level, pets, substance use, religion, personality type. "
        "Includes: gym-goer, runner, hiker, homebody, introvert, extrovert, "
        "has a dog, has a cat, smoker, non-smoker, 420-friendly, cannabis, "
        "Christian, Jewish, Muslim, Buddhist, and other religious affiliation mentions."
    ),
    "logistics": (
        "Practical life circumstances. "
        "Includes: distance/commute signals, has kids, doesn't want kids, wants kids, "
        "living with roommates, living alone, living with family."
    ),
    "comms": (
        "Communication style and platform preferences. "
        "Includes: slow texter, quick responder, prefers calls, voice notes, "
        "bad at texting, platform-specific preferences (Instagram DMs, Snapchat, etc.)."
    ),
}

# Minimum confidence to include in output (below this, attribute is discarded)
MIN_CONFIDENCE = 0.40

# Confidence threshold to escalate from haiku to sonnet
SONNET_ESCALATION_THRESHOLD = 0.70

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class AttributeItem:
    value: str
    confidence: float
    source_msg_excerpt: str
    source_msg_index: int

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "AttributeItem":
        return cls(
            value=str(d.get("value", "")),
            confidence=float(d.get("confidence", 0.0)),
            source_msg_excerpt=str(d.get("source_msg_excerpt", "")),
            source_msg_index=int(d.get("source_msg_index", -1)),
        )


@dataclass
class AttributeUpdate:
    dietary: list[AttributeItem] = field(default_factory=list)
    allergy: list[AttributeItem] = field(default_factory=list)
    schedule: list[AttributeItem] = field(default_factory=list)
    lifestyle: list[AttributeItem] = field(default_factory=list)
    logistics: list[AttributeItem] = field(default_factory=list)
    comms: list[AttributeItem] = field(default_factory=list)
    model_used: str = "haiku-4-5"
    avg_confidence: float = 0.0

    def all_items(self) -> list[tuple[str, AttributeItem]]:
        result = []
        for cat in ("allergy", "dietary", "schedule", "lifestyle", "logistics", "comms"):
            for item in getattr(self, cat, []):
                result.append((cat, item))
        return result

    def to_dict(self) -> dict:
        return {
            "dietary": [i.to_dict() for i in self.dietary],
            "allergy": [i.to_dict() for i in self.allergy],
            "schedule": [i.to_dict() for i in self.schedule],
            "lifestyle": [i.to_dict() for i in self.lifestyle],
            "logistics": [i.to_dict() for i in self.logistics],
            "comms": [i.to_dict() for i in self.comms],
            "model_used": self.model_used,
            "avg_confidence": self.avg_confidence,
        }


# ---------------------------------------------------------------------------
# Tool schema for Claude tool-use
# ---------------------------------------------------------------------------

def _build_attribute_item_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "value": {
                "type": "string",
                "description": "Short human-readable label (max 4 words)",
            },
            "confidence": {
                "type": "number",
                "description": "0.0-1.0. 1.0 = she explicitly stated it. 0.5 = inferred from context. Only include if >= 0.40.",
            },
            "source_msg_excerpt": {
                "type": "string",
                "description": "≤100 char verbatim excerpt from the message that triggered this attribute",
            },
            "source_msg_index": {
                "type": "integer",
                "description": "0-based index of the message in the messages array",
            },
        },
        "required": ["value", "confidence", "source_msg_excerpt", "source_msg_index"],
    }


def _build_tool_schema(categories: dict[str, str]) -> dict:
    """Build the Claude tool schema for attribute extraction."""
    cat_properties = {}
    for cat, description in categories.items():
        cat_properties[cat] = {
            "type": "array",
            "description": description,
            "items": _build_attribute_item_schema(),
        }

    return {
        "name": "extract_attributes",
        "description": (
            "Extract structured lifestyle/preference signals from a dating app conversation. "
            "Only extract attributes with explicit signal — do not infer. "
            "Return empty arrays for categories with no clear signal."
        ),
        "input_schema": {
            "type": "object",
            "properties": cat_properties,
            "required": list(categories.keys()),
        },
    }


# ---------------------------------------------------------------------------
# System prompt builder (cached via prompt caching)
# ---------------------------------------------------------------------------

def _build_system_prompt(categories: dict[str, str]) -> str:
    cat_json = json.dumps(categories, indent=2)
    return f"""You are an attribute extractor for a dating app co-pilot.

Your job: read a conversation between two people and extract structured lifestyle/preference signals about HER (the match, not the user).

CATEGORIES AND WHAT TO EXTRACT:
{cat_json}

EXTRACTION RULES:
1. EXPLICIT SIGNAL REQUIRED — only extract if she explicitly stated or strongly implied it. Do NOT infer from a single ambiguous mention.
   - GOOD: "I'm vegan" → dietary: vegan (confidence 1.0)
   - GOOD: "I don't drink at all" → dietary: alcohol-free (confidence 0.95)
   - BAD: "I love vegan restaurants" → NOT vegan (she likes eating at them, not her identity)
   - BAD: "I had a beer last week" + nothing else → do NOT infer drinker status
2. ALLERGY = LIFE-SAFETY. Only use the 'allergy' category for self-reported medical allergies or intolerances, not dislikes.
   - GOOD: "I'm allergic to nuts" → allergy: nut allergy
   - BAD: "I don't really like shellfish" → NOT an allergy
3. CONFIDENCE calibration:
   - 1.0: She literally said "I am X" or "I don't do X"
   - 0.8-0.9: Very clear, e.g. "I've been vegan for 5 years"
   - 0.6-0.7: Strongly implied by context
   - 0.4-0.5: Possible but uncertain — include only if you're reasonably confident
   - Below 0.4: Do NOT include
4. value should be SHORT (2-4 words max): "vegan", "morning person", "has a dog", "nut allergy"
5. source_msg_excerpt must be ≤100 chars verbatim from a her message
6. source_msg_index is 0-based index in the messages array
7. Return empty arrays [] for categories with no signal — never fabricate attributes
8. Do NOT label her with attributes from HIS messages

Analyze ONLY her messages for the extract."""


# ---------------------------------------------------------------------------
# Claude API call with prompt caching
# ---------------------------------------------------------------------------

def _call_claude_extract(
    messages: list[dict],
    categories: dict[str, str],
    model: str,
    api_key: str,
) -> dict | None:
    """Call Claude with tool-use to extract attributes. Returns the tool input dict or None."""
    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed — attribute extraction unavailable")
        return None

    client = anthropic.Anthropic(api_key=api_key)
    system_prompt = _build_system_prompt(categories)
    tool_schema = _build_tool_schema(categories)

    # Format messages for the API — include both sender labels
    formatted = []
    for i, msg in enumerate(messages):
        sender = msg.get("sender", "")
        body = msg.get("body") or msg.get("text") or msg.get("content") or ""
        if not body:
            continue
        label = "HER" if sender in ("her", "match", "incoming") else "HIM"
        formatted.append(f"[{i}] {label}: {body[:300]}")

    if not formatted:
        return None

    conversation_text = "\n".join(formatted)

    try:
        # System prompt uses cache_control for ~90% cost reduction on repeated calls
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},  # cache the big system prompt
                }
            ],
            tools=[tool_schema],
            tool_choice={"type": "tool", "name": "extract_attributes"},
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Here is the conversation ({len(formatted)} messages):\n\n"
                        f"{conversation_text}\n\n"
                        "Extract her attributes."
                    ),
                }
            ],
        )

        for block in response.content:
            if block.type == "tool_use" and block.name == "extract_attributes":
                return block.input

        logger.warning("extract_attributes: model did not call the tool")
        return None

    except Exception as exc:
        logger.warning("Claude extract call failed (%s): %s", model, exc)
        return None


# ---------------------------------------------------------------------------
# Parse and validate the model output
# ---------------------------------------------------------------------------

def _parse_extract_result(
    raw: dict,
    categories: dict[str, str],
) -> AttributeUpdate:
    """Parse the tool input dict into an AttributeUpdate. Filters low-confidence items."""
    update = AttributeUpdate()
    all_confidences: list[float] = []

    for cat in categories.keys():
        items_raw = raw.get(cat, []) or []
        parsed = []
        for item_raw in items_raw:
            if not isinstance(item_raw, dict):
                continue
            conf = float(item_raw.get("confidence", 0.0))
            if conf < MIN_CONFIDENCE:
                continue
            item = AttributeItem(
                value=str(item_raw.get("value", "")).strip()[:60],
                confidence=conf,
                source_msg_excerpt=str(item_raw.get("source_msg_excerpt", ""))[:100],
                source_msg_index=int(item_raw.get("source_msg_index", -1)),
            )
            if item.value:
                parsed.append(item)
                all_confidences.append(conf)

        if hasattr(update, cat):
            setattr(update, cat, parsed)

    update.avg_confidence = (
        sum(all_confidences) / len(all_confidences) if all_confidences else 0.0
    )
    return update


# ---------------------------------------------------------------------------
# Dismissed-value guard
# ---------------------------------------------------------------------------

def _get_dismissed_set(prior: dict | None) -> set[str]:
    """Return set of 'category:value' strings that the operator has dismissed."""
    if not prior:
        return set()
    dismissed = prior.get("_dismissed") or []
    return {
        f"{d.get('category', '')}:{d.get('value', '')}".lower()
        for d in dismissed
        if isinstance(d, dict)
    }


def _filter_dismissed(update: AttributeUpdate, dismissed: set[str]) -> AttributeUpdate:
    """Remove any attributes that the operator dismissed."""
    if not dismissed:
        return update

    for cat in ("dietary", "allergy", "schedule", "lifestyle", "logistics", "comms"):
        items = getattr(update, cat, [])
        filtered = [
            item for item in items
            if f"{cat}:{item.value}".lower() not in dismissed
        ]
        setattr(update, cat, filtered)

    return update


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------

def extract_attributes(
    messages: list[dict],
    prior: dict | None = None,
    persona: dict | None = None,
    api_key: str | None = None,
) -> AttributeUpdate:
    """Extract structured attributes from a conversation.

    Args:
        messages: List of message dicts with keys: sender ("her"/"us"), body/text/content.
        prior: Existing attributes JSONB from the match row (for dismissed-value guard).
        persona: User's persona dict (for persona.attribute_categories override).
        api_key: Anthropic API key. Reads ANTHROPIC_API_KEY env var if not provided.

    Returns:
        AttributeUpdate with extracted attributes (dismissed values filtered out).
        Returns empty AttributeUpdate if no API key is available.
    """
    key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        logger.warning("ANTHROPIC_API_KEY not set — attribute extraction skipped")
        return AttributeUpdate()

    # Categories from persona config or defaults
    categories = DEFAULT_CATEGORIES.copy()
    if persona and isinstance(persona, dict):
        custom_cats = persona.get("attribute_categories")
        if isinstance(custom_cats, dict) and custom_cats:
            categories = {**categories, **custom_cats}

    # Filter out messages with no meaningful content
    her_messages = [
        m for m in messages
        if m.get("sender") in ("her", "match", "incoming")
        and (m.get("body") or m.get("text") or m.get("content"))
    ]
    if not her_messages:
        logger.debug("extract_attributes: no her-messages found, skipping")
        return AttributeUpdate()

    dismissed = _get_dismissed_set(prior)

    # First attempt: haiku (fast + cheap)
    haiku_model = "claude-haiku-4-5"
    raw = _call_claude_extract(messages, categories, model=haiku_model, api_key=key)
    if raw is None:
        return AttributeUpdate()

    update = _parse_extract_result(raw, categories)
    update.model_used = haiku_model

    # Escalate to sonnet if confidence is low
    if update.avg_confidence < SONNET_ESCALATION_THRESHOLD and her_messages:
        logger.debug(
            "extract_attributes: haiku avg_confidence=%.2f < %.2f, escalating to sonnet",
            update.avg_confidence,
            SONNET_ESCALATION_THRESHOLD,
        )
        sonnet_model = "claude-sonnet-4-6"
        raw2 = _call_claude_extract(messages, categories, model=sonnet_model, api_key=key)
        if raw2 is not None:
            update = _parse_extract_result(raw2, categories)
            update.model_used = sonnet_model

    # Filter dismissed values before returning
    update = _filter_dismissed(update, dismissed)
    return update


# ---------------------------------------------------------------------------
# Merge: combine prior attributes with the new delta
# ---------------------------------------------------------------------------

def merge_attributes(prior: dict, delta: AttributeUpdate) -> dict:
    """Merge a new AttributeUpdate into the existing attributes JSONB.

    Strategy:
    - For each category, build a deduplicated dict keyed by value (lowercase).
    - New extractions override prior entries for the same value (fresher confidence).
    - Prior entries not covered by the delta are kept.
    - _dismissed and _extracted_at are carried over / updated.

    Returns the merged dict ready to write to Supabase.
    """
    from datetime import datetime, timezone

    merged: dict[str, Any] = {}

    # Carry over dismissed list unchanged
    merged["_dismissed"] = prior.get("_dismissed") or []
    merged["_extracted_at"] = datetime.now(tz=timezone.utc).isoformat()
    merged["_model_used"] = delta.model_used

    for cat in ("dietary", "allergy", "schedule", "lifestyle", "logistics", "comms"):
        prior_items: list[dict] = prior.get(cat) or []
        delta_items: list[AttributeItem] = getattr(delta, cat, [])

        # Build dict keyed by normalized value
        combined: dict[str, dict] = {
            item.get("value", "").lower(): item
            for item in prior_items
            if isinstance(item, dict) and item.get("value")
        }
        # Delta overrides prior (fresher extraction)
        for item in delta_items:
            combined[item.value.lower()] = item.to_dict()

        merged[cat] = list(combined.values())

    return merged


# ---------------------------------------------------------------------------
# Dismiss helper — called from API route on operator dismiss
# ---------------------------------------------------------------------------

def check_draft_attribute_conflicts(
    draft: str,
    attributes: dict | None,
) -> tuple[bool, list[str]]:
    """Check if a draft message conflicts with the match's known attributes.

    Returns (ok, conflicts). ok=False means the draft must be blocked.
    conflicts is a list of human-readable conflict descriptions.

    Attribute-conflict rules:
    - sober/alcohol-free → block any draft mentioning alcohol venues/drinks
    - celiac disease / gluten-free allergy → block drafts mentioning gluten foods
    - vegan → block drafts mentioning meat/animal products at restaurants
    - nut allergy → block drafts mentioning nuts/peanut products

    This function is intentionally conservative — it only fires on clear conflicts,
    not on ambiguous mentions. False negatives are safer than false positives here.
    """
    if not attributes or not draft:
        return True, []

    conflicts: list[str] = []
    draft_lower = draft.lower()

    # --- Sobriety/alcohol conflict ---
    ALCOHOL_KEYWORDS = {
        "bourbon", "whiskey", "whisky", "beer", "wine", "cocktail", "cocktails",
        "drink", "drinks", "drinking", "alcohol", "bar ", " bar", "speakeasy",
        "tequila", "vodka", "rum ", " rum ", "gin ", " gin ", "sake",
        "champagne", "prosecco", "brewery", "winery", "pub ",
    }
    is_sober = any(
        "sober" in str(item.get("value", "")).lower() or
        "alcohol-free" in str(item.get("value", "")).lower() or
        "alcohol free" in str(item.get("value", "")).lower() or
        "dry january" in str(item.get("value", "")).lower() or
        "non-drinker" in str(item.get("value", "")).lower()
        for item in (attributes.get("dietary") or [])
        if isinstance(item, dict)
    )
    if is_sober:
        hits = [kw.strip() for kw in ALCOHOL_KEYWORDS if kw.lower() in draft_lower]
        if hits:
            conflicts.append(
                f"sober/alcohol-free match: draft mentions alcohol ({', '.join(hits[:3])})"
            )

    # --- Celiac / gluten conflict ---
    GLUTEN_FOODS = {
        "pasta", "bread", "pizza", "wheat", "flour", "croissant", "bagel",
        "sandwich", "sub ", " sub,", "ramen", "udon", "soba", "dumpling",
        "dumplings", "crepe", "waffle", "pancake", "beer ", " beer",
    }
    is_celiac = any(
        "celiac" in str(item.get("value", "")).lower() or
        "gluten" in str(item.get("value", "")).lower()
        for item in (attributes.get("allergy") or [])
        if isinstance(item, dict)
    )
    if is_celiac:
        # Allow if draft mentions "gluten-free" as a positive
        if "gluten-free" not in draft_lower and "gluten free" not in draft_lower:
            hits = [kw.strip() for kw in GLUTEN_FOODS if kw.lower() in draft_lower]
            if hits:
                conflicts.append(
                    f"celiac/gluten-free match: draft suggests gluten food ({', '.join(hits[:3])})"
                )

    # --- Vegan conflict ---
    MEAT_FOODS = {
        "steak", "burger", "burgers", "chicken ", " chicken", "meat ", " meat",
        "bacon", "pork ", " pork", "beef ", " beef", "lamb ", " lamb",
        "seafood", "sushi", "sashimi", "steakhouse", "bbq", "barbeque",
        "barbecue", "ribs ",
    }
    is_vegan = any(
        "vegan" in str(item.get("value", "")).lower()
        for item in (attributes.get("dietary") or [])
        if isinstance(item, dict)
    )
    if is_vegan:
        # Allow if draft mentions "vegan" affirmatively
        if "vegan" not in draft_lower and "plant" not in draft_lower:
            hits = [kw.strip() for kw in MEAT_FOODS if kw.lower() in draft_lower]
            if hits:
                conflicts.append(
                    f"vegan match: draft suggests non-vegan food ({', '.join(hits[:3])})"
                )

    # --- Nut allergy conflict ---
    NUT_KEYWORDS = {
        "nut ", " nut", "nuts", "peanut", "peanuts", "almond", "almonds",
        "cashew", "cashews", "walnut", "walnuts", "pecan", "pecans",
        "pistachio", "pistachios", "hazelnut", "hazelnuts",
        "peanut butter", "pad thai",  # pad thai traditionally has peanuts
    }
    is_nut_allergy = any(
        "nut allergy" in str(item.get("value", "")).lower() or
        "peanut allergy" in str(item.get("value", "")).lower() or
        "nut-free" in str(item.get("value", "")).lower()
        for item in (attributes.get("allergy") or [])
        if isinstance(item, dict)
    )
    if is_nut_allergy:
        # Allow if draft says "nut-free"
        if "nut-free" not in draft_lower and "nut free" not in draft_lower:
            hits = [kw.strip() for kw in NUT_KEYWORDS if kw.lower() in draft_lower]
            if hits:
                conflicts.append(
                    f"nut allergy match: draft mentions nuts ({', '.join(hits[:3])})"
                )

    return (len(conflicts) == 0), conflicts


def dismiss_attribute(
    current_attributes: dict,
    category: str,
    value: str,
) -> dict:
    """Add a dismiss entry and remove the attribute from the category list.

    Returns the updated attributes dict (caller must write to Supabase).
    """
    from datetime import datetime, timezone

    updated = dict(current_attributes)

    # Add to _dismissed
    dismissed: list[dict] = list(updated.get("_dismissed") or [])
    dismissed.append({
        "category": category,
        "value": value,
        "dismissed_at": datetime.now(tz=timezone.utc).isoformat(),
    })
    updated["_dismissed"] = dismissed

    # Remove from the category list
    cat_items: list[dict] = list(updated.get(category) or [])
    updated[category] = [
        item for item in cat_items
        if str(item.get("value", "")).lower() != value.lower()
    ]

    return updated
