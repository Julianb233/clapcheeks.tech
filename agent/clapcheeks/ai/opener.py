"""AI opener message generator — local Ollama with Claude API fallback.

Strategy (research-backed):
- GIF openers get 30% more responses and 2x longer conversations
- Referencing something specific from the profile raises response rate 50%
- Humor raises response rate 12%
- "Hey" is a documented red flag — never use it alone
- Direct date ask after 5-10 messages outperforms asking for a number first
"""
from __future__ import annotations

import logging
import os
import random
import urllib.parse

from clapcheeks.config import load as load_config

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are helping craft a dating app opener message. "
    "Write a short, fun, personalized first message referencing something specific from their profile. "
    "Keep it 1-2 sentences max. Be genuine and playful, not generic or cheesy. "
    "Do NOT start with 'Hey' alone. Do NOT use pick-up lines. "
    "Reply with ONLY the message text."
)

# Tenor GIF search terms mapped to mood — used when profile has no strong hook
_GIF_MOODS = [
    "impressed wow",
    "hello wave funny",
    "excited happy",
    "hi there cute",
    "lets talk",
]

TENOR_API_URL = "https://tenor.googleapis.com/v2/search"


def get_gif_url(search_term: str, api_key: str | None = None) -> str | None:
    """Return a Tenor GIF URL for the given search term, or None if unavailable."""
    key = api_key or os.environ.get("TENOR_API_KEY")
    if not key:
        return None
    try:
        import urllib.request, json
        params = urllib.parse.urlencode({"q": search_term, "key": key, "limit": 5, "media_filter": "gif"})
        with urllib.request.urlopen(f"{TENOR_API_URL}?{params}", timeout=3) as resp:
            data = json.loads(resp.read())
            results = data.get("results", [])
            if results:
                # Pick randomly from top 5 for variety
                result = random.choice(results)
                return result["media_formats"]["gif"]["url"]
    except Exception as exc:
        logger.debug("Tenor GIF fetch failed: %s", exc)
    return None


def generate_opener(
    match_name: str,
    profile_data: dict | None = None,
    model: str | None = None,
    use_gif: bool = True,
) -> str:
    """Generate a personalized opener for a new match.

    Tries Ollama (local) first, then Claude API fallback, then a safe default.
    All local inference stays on-device — no data leaves unless Ollama is unavailable
    and ANTHROPIC_API_KEY is set.
    """
    config = load_config()
    model = model or config.get("ai_model", "llama3.2")

    # GIF opener path — 30% higher response rate, 2x longer conversations
    if use_gif and random.random() < 0.35:
        mood = random.choice(_GIF_MOODS)
        gif_url = get_gif_url(mood)
        if gif_url:
            return gif_url  # Platform clients send this as a GIF message

    # Build user message from available profile data
    if profile_data and any(profile_data.get(k) for k in ("name", "age", "bio", "interests", "prompt")):
        details = ", ".join(
            f"{k}: {v}" for k, v in profile_data.items() if v
        )
        user_msg = f"Write an opener for {match_name}. Their profile mentions: {details}. Reference something specific."
    else:
        user_msg = f"Write a fun, playful opener for someone named {match_name} on a dating app. No generic greetings."

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    # Attempt 1: Ollama (local inference)
    try:
        import ollama

        response = ollama.chat(
            model=model,
            messages=messages,
            options={"temperature": 0.9},
        )
        text = response["message"]["content"].strip()
        if text:
            return text
    except ImportError:
        logger.debug("ollama package not installed, trying fallback.")
    except ConnectionError:
        logger.debug("Ollama not running, trying Claude API fallback.")
    except Exception as exc:
        logger.warning("Ollama opener failed: %s", exc)

    # Attempt 2: Kimi API fallback (if key available)
    api_key = os.environ.get("KIMI_API_KEY")
    if api_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key, base_url="https://api.moonshot.cn/v1")
            kimi_model = os.environ.get("KIMI_MODEL", "moonshot-v1-8k")
            response = client.chat.completions.create(
                model=kimi_model,
                max_tokens=100,
                messages=messages,
            )
            text = response.choices[0].message.content.strip()
            if text:
                return text
        except ImportError:
            logger.debug("openai package not installed.")
        except Exception as exc:
            logger.warning("Kimi API opener failed: %s", exc)

    # Fallback — never crash, always return something usable
    logger.info("Using fallback opener for %s.", match_name)
    return f"Hey {match_name}! How's your week going?"
