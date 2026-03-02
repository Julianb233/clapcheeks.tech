"""AI opener message generator — local Ollama with Claude API fallback."""
from __future__ import annotations

import logging
import os

from clapcheeks.config import load as load_config

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are helping craft a dating app opener message. "
    "Write a short, fun, personalized first message. "
    "Keep it 1-2 sentences max. Be genuine and playful, not generic or cheesy. "
    "Reply with ONLY the message text."
)


def generate_opener(
    match_name: str,
    profile_data: dict | None = None,
    model: str | None = None,
) -> str:
    """Generate a personalized opener for a new match.

    Tries Ollama (local) first, then Claude API fallback, then a safe default.
    All local inference stays on-device — no data leaves unless Ollama is unavailable
    and ANTHROPIC_API_KEY is set.
    """
    config = load_config()
    model = model or config.get("ai_model", "llama3.2")

    # Build user message from available profile data
    if profile_data and any(profile_data.get(k) for k in ("name", "age", "bio", "interests")):
        details = ", ".join(
            f"{k}: {v}" for k, v in profile_data.items() if v
        )
        user_msg = f"Write an opener for {match_name}. Their profile mentions: {details}."
    else:
        user_msg = f"Write a fun opener for someone named {match_name} on Tinder."

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

    # Attempt 2: Claude API fallback (if key available)
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            import anthropic

            client = anthropic.Anthropic()
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=100,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = response.content[0].text.strip()
            if text:
                return text
        except ImportError:
            logger.debug("anthropic package not installed.")
        except Exception as exc:
            logger.warning("Claude API opener failed: %s", exc)

    # Fallback — never crash, always return something usable
    logger.info("Using fallback opener for %s.", match_name)
    return f"Hey {match_name}! How's your week going?"
