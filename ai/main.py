"""Outward AI Service — handles coaching, reply suggestions, and analytics insights."""
import os
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Outward AI", version="0.1.0")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


@app.get("/health")
def health():
    return {"status": "ok"}


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
    # TODO: call Claude API with user's metrics, return structured coaching tips
    return {
        "tips": [
            "Your match rate is 12% — try updating your first photo",
            "You spend an average of $45 per date — consider coffee dates first",
            "Your Hinge response rate is 3x better than Tinder — focus there",
        ],
        "conversion_rate": round(req.dates / max(req.matches, 1) * 100, 1),
        "cost_per_date": round(req.money_spent / max(req.dates, 1), 2),
    }


class ReplyRequest(BaseModel):
    platform: str  # tinder | bumble | hinge | imessage
    conversation: list[dict]
    style_description: str
    contact_name: str | None = None


@app.post("/reply/suggest")
async def suggest_reply(req: ReplyRequest):
    """Suggest a reply to a dating app conversation."""
    # TODO: call Claude API
    return {"suggestion": "Hey! How was your weekend?"}
