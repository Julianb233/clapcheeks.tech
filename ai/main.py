"""Outward AI Service — coaching, reply suggestions, and analytics insights."""
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
import anthropic

load_dotenv()

app = FastAPI(title="Outward AI", version="0.1.0")

_client: anthropic.Anthropic | None = None

def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
        _client = anthropic.Anthropic(api_key=key)
    return _client


@app.get("/health")
def health():
    key_set = bool(os.environ.get("ANTHROPIC_API_KEY"))
    return {"status": "ok", "claude_configured": key_set}


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
    """Generate personalized AI coaching tips based on user's dating analytics."""
    client = get_client()

    match_rate = round(req.matches / max(req.swipes, 1) * 100, 1)
    conv_rate = round(req.conversations / max(req.matches, 1) * 100, 1)
    date_rate = round(req.dates / max(req.conversations, 1) * 100, 1)
    cost_per_date = round(req.money_spent / max(req.dates, 1), 2) if req.dates > 0 else 0

    prompt = f"""You are a dating coach AI. Analyze these stats and give exactly 3 specific, actionable tips.

Stats:
- Total swipes: {req.swipes}
- Matches: {req.matches} ({match_rate}% match rate)
- Conversations started: {req.conversations} ({conv_rate}% of matches)
- Dates booked: {req.dates} ({date_rate}% conversation-to-date rate)
- Money spent: ${req.money_spent:.2f} (${cost_per_date:.2f} per date)
- Best performing app: {req.top_app}

Give 3 specific coaching tips. Be direct, honest, and data-driven. Format as a JSON array of strings. Return ONLY the JSON array, no other text."""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}]
    )

    import json
    try:
        tips = json.loads(response.content[0].text)
    except Exception:
        # Fallback: split by newline if JSON parse fails
        tips = [line.strip("- ").strip() for line in response.content[0].text.split("\n") if line.strip()][:3]

    return {
        "tips": tips,
        "conversion_rate": date_rate,
        "cost_per_date": cost_per_date,
        "match_rate": match_rate,
    }


class ReplyRequest(BaseModel):
    platform: str  # tinder | bumble | hinge | imessage
    conversation: list[dict]
    style_description: str
    contact_name: str | None = None


@app.post("/reply/suggest")
async def suggest_reply(req: ReplyRequest):
    """Suggest a reply to a dating app conversation in the user's voice."""
    client = get_client()

    name = req.contact_name or "them"
    platform_context = {
        "tinder": "Tinder match",
        "bumble": "Bumble match",
        "hinge": "Hinge match",
        "imessage": "text conversation",
    }.get(req.platform, "dating app match")

    system = f"""You are helping craft a reply to a {platform_context} named {name}.
Writing style to match: {req.style_description or 'casual, genuine, conversational'}
Keep replies short (1-2 sentences). Be natural and engaging, not overly eager.
Respond with ONLY the reply text — no quotes, no explanation, no preamble."""

    # Convert conversation to Claude message format
    messages = []
    for msg in req.conversation:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role not in ("user", "assistant"):
            role = "user"
        messages.append({"role": role, "content": content})

    # If no conversation, generate an opener
    if not messages:
        messages = [{"role": "user", "content": f"Write an opening message to {name} on {platform_context}. Be specific and genuine."}]

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150,
        system=system,
        messages=messages,
    )

    return {"suggestion": response.content[0].text.strip()}
