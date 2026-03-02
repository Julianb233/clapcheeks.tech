"""Clapcheeks AI Service — coaching, reply suggestions, date planning.

Uses Kimi (Moonshot AI) via OpenAI-compatible API.
"""
import json
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

app = FastAPI(title="Clapcheeks AI", version="0.3.0")

KIMI_MODEL = os.environ.get("KIMI_MODEL", "moonshot-v1-8k")

_client: OpenAI | None = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        key = os.environ.get("KIMI_API_KEY", "")
        if not key:
            raise HTTPException(status_code=503, detail="KIMI_API_KEY not configured")
        _client = OpenAI(api_key=key, base_url="https://api.moonshot.cn/v1")
    return _client


def chat(system: str, user: str, max_tokens: int = 500) -> str:
    resp = get_client().chat.completions.create(
        model=KIMI_MODEL,
        max_tokens=max_tokens,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    return resp.choices[0].message.content.strip()


def chat_with_history(system: str, messages: list[dict], max_tokens: int = 200) -> str:
    resp = get_client().chat.completions.create(
        model=KIMI_MODEL,
        max_tokens=max_tokens,
        messages=[{"role": "system", "content": system}] + messages,
    )
    return resp.choices[0].message.content.strip()


@app.get("/health")
def health():
    return {"status": "ok", "provider": "kimi", "model": KIMI_MODEL, "configured": bool(os.environ.get("KIMI_API_KEY"))}


class PhotoScoreRequest(BaseModel):
    image_base64: str
    filename: str = "photo.jpg"


@app.post("/photos/score")
async def score_photo_endpoint(req: PhotoScoreRequest):
    """Score a dating profile photo using Kimi vision or PIL heuristics."""
    import base64
    import tempfile
    from pathlib import Path

    # Decode image to a temp file
    try:
        img_bytes = base64.b64decode(req.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    suffix = Path(req.filename).suffix or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(img_bytes)
        tmp_path = tmp.name

    try:
        from clapcheeks.photos.scorer import score_photo, PhotoScore
        result = score_photo(tmp_path)
        return {
            "filename": req.filename,
            "score": result.score,
            "face_score": result.face_score,
            "smile_score": result.smile_score,
            "background_score": result.background_score,
            "lighting_score": result.lighting_score,
            "solo_score": result.solo_score,
            "tips": result.tips,
        }
    except FileNotFoundError:
        raise HTTPException(status_code=400, detail="Could not process image")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        Path(tmp_path).unlink(missing_ok=True)


class CoachingRequest(BaseModel):
    user_id: str
    swipes: int
    matches: int
    conversations: int
    dates: int
    money_spent: float
    top_app: str


@app.post("/coaching/analyze")
async def analyze_and_coach(req: CoachingRequest):
    match_rate = round(req.matches / max(req.swipes, 1) * 100, 1)
    conv_rate = round(req.conversations / max(req.matches, 1) * 100, 1)
    date_rate = round(req.dates / max(req.conversations, 1) * 100, 1)
    cost_per_date = round(req.money_spent / max(req.dates, 1), 2) if req.dates > 0 else 0

    prompt = f"""Dating stats:
- Swipes: {req.swipes}, Matches: {req.matches} ({match_rate}% rate)
- Conversations: {req.conversations} ({conv_rate}% of matches)
- Dates: {req.dates} ({date_rate}% conv-to-date rate)
- Spent: ${req.money_spent:.2f} (${cost_per_date:.2f}/date), Best app: {req.top_app}

Give exactly 3 specific, data-driven coaching tips. Return ONLY a JSON array of 3 strings."""

    text = chat(system="You are a data-driven dating coach. Return only valid JSON arrays.", user=prompt, max_tokens=400)
    try:
        clean = text.strip().strip("```json").strip("```").strip()
        tips = json.loads(clean)
        if not isinstance(tips, list):
            raise ValueError
    except Exception:
        tips = [l.strip("- •").strip() for l in text.split("\n") if l.strip()][:3]

    return {"tips": tips[:3], "conversion_rate": date_rate, "cost_per_date": cost_per_date, "match_rate": match_rate}


class ReplyRequest(BaseModel):
    platform: str
    conversation: list[dict]
    style_description: str
    contact_name: str | None = None
    calendar_context: str | None = None
    persuasion_context: str | None = None


@app.post("/reply/suggest")
async def suggest_reply(req: ReplyRequest):
    name = req.contact_name or "them"
    platform_label = {"tinder": "Tinder", "bumble": "Bumble", "hinge": "Hinge", "imessage": "iMessage"}.get(req.platform, req.platform)

    system_parts = [
        f"You are helping craft a reply to a {platform_label} match named {name}.",
        f"Style: {req.style_description or 'casual, genuine, conversational'}",
        "Keep it short (1-2 sentences). Be natural, not desperate.",
    ]
    if req.calendar_context:
        system_parts.append(f"Calendar availability: {req.calendar_context}. Naturally weave in a date suggestion if appropriate.")
    if req.persuasion_context:
        system_parts.append(f"\nPersuasion framework:\n{req.persuasion_context}")
    system_parts.append("Reply with ONLY the message text — no quotes, no preamble.")
    system = "\n".join(system_parts)

    messages = []
    for msg in req.conversation:
        role = msg.get("role", "user")
        if role not in ("user", "assistant"):
            role = "user"
        messages.append({"role": role, "content": msg.get("content", "")})

    if not messages:
        messages = [{"role": "user", "content": f"Write a genuine opening message to {name} on {platform_label}."}]

    return {"suggestion": chat_with_history(system=system, messages=messages, max_tokens=150)}


class DateSuggestRequest(BaseModel):
    match_name: str
    platform: str
    conversation: list[dict]
    free_slots: list[dict]
    user_location: str | None = None
    preferences: str | None = None


@app.post("/date/suggest")
async def suggest_date(req: DateSuggestRequest):
    slots_text = "\n".join(f"  - {s.get('label', s.get('start', ''))}" for s in req.free_slots[:5])
    location = req.user_location or "your city"
    prefs = req.preferences or "casual, fun, not too formal"
    conv_summary = "\n".join(f"  {m['role']}: {m['content']}" for m in req.conversation[-4:]) if req.conversation else "  (no messages yet)"

    prompt = f"""Plan a date with {req.match_name} from {req.platform}.

Recent conversation:
{conv_summary}

Your available times:
{slots_text or '  (check your calendar)'}

Location: {location} | Preferences: {prefs}

Return JSON with:
{{"message": "natural message suggesting one specific time+place", "venue_suggestions": ["venue1", "venue2", "venue3"], "recommended_slot": "best slot label", "date_type": "coffee|drinks|dinner|activity"}}

Return ONLY valid JSON."""

    text = chat(system="You help plan first dates. Be specific and casual. Return only valid JSON.", user=prompt, max_tokens=400)
    try:
        clean = text.strip().strip("```json").strip("```").strip()
        result = json.loads(clean)
    except Exception:
        result = {
            "message": f"Hey {req.match_name}, want to grab coffee this week? I'm free {req.free_slots[0].get('label', 'soon') if req.free_slots else 'sometime'}",
            "venue_suggestions": ["coffee shop", "wine bar", "park walk"],
            "recommended_slot": req.free_slots[0].get("label", "") if req.free_slots else "",
            "date_type": "coffee",
        }
    return result
