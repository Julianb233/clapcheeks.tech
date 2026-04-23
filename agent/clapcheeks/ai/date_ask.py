"""AI date-ask and re-engagement generator — Ollama first, Kimi fallback.

Research-backed:
- Asking for a phone number before proposing a date = 60% chance date never happens
- Direct date ask after 5-10 good messages is optimal
- Slow responder re-engagement after 48h silence boosts response 23%
"""
from __future__ import annotations

import logging
import os
import time

from clapcheeks.config import load as load_config

logger = logging.getLogger(__name__)

DATE_ASK_SYSTEM = (
    "You are helping craft a direct date invitation on a dating app. "
    "Write a short, confident, casual message proposing a specific date (drinks, coffee, etc). "
    "Do NOT ask for their phone number. Go straight to suggesting a meetup. "
    "Keep it 1-2 sentences. Be direct but not pushy. "
    "Reply with ONLY the message text."
)

REENGAGEMENT_SYSTEM = (
    "You are helping re-engage a dating app conversation that went quiet. "
    "Write a short, light, playful message to restart the conversation. "
    "Do NOT be desperate, needy, or passive-aggressive. Keep it fun and low-pressure. "
    "1 sentence max. Reply with ONLY the message text."
)

_PLATFORM_TONE = {
    "hinge": "Keep it casual and warm — Hinge conversations tend to be more relaxed.",
    "bumble": "Be slightly more direct — Bumble users appreciate confidence.",
    "tinder": "Keep it fun and playful — Tinder conversations are lighter.",
}


def should_ask_for_date(message_count: int, last_message_ts: float) -> bool:
    """Return True if conversation is ripe for a date ask.

    Criteria: at least 7 messages exchanged and conversation still active
    (last message within 72 hours).
    """
    if message_count < 7:
        return False
    if last_message_ts <= 0:
        return False
    hours_since = (time.time() - last_message_ts) / 3600
    return hours_since < 72


def _call_llm(system: str, user_msg: str, model: str | None = None) -> str | None:
    """Ollama first, Kimi fallback. Returns generated text or None.

    Auto-injects the user persona into the system prompt — callers can still
    add match-intel blocks by composing the `system` arg themselves.
    """
    from clapcheeks import persona as _persona

    config = load_config()
    model = model or config.get("ai_model", "llama3.2")

    system = _persona.merge_into_system(system)

    # Attempt 1: Ollama
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]
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
        logger.debug("Ollama not running, trying Kimi API fallback.")
    except Exception as exc:
        logger.warning("Ollama date_ask failed: %s", exc)

    # Attempt 2: Kimi API
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
            logger.warning("Kimi API date_ask failed: %s", exc)

    return None


def generate_date_ask(
    match_name: str,
    platform: str = "tinder",
    profile_data: dict | None = None,
    slot_context: str | None = None,
) -> str:
    """Generate a direct date-ask message. Never asks for a phone number.

    If `slot_context` is provided (from calendar.slots.propose_slots_for_ai),
    the AI is instructed to offer those exact time windows. Also extracts
    match intel (zodiac, interests) from profile_data and injects it.
    """
    from clapcheeks import match_intel as _intel

    tone = _PLATFORM_TONE.get(platform, "")
    intel = _intel.extract(profile_data) if profile_data else {}
    intel_block = _intel.format_for_system_prompt(intel)

    system = DATE_ASK_SYSTEM
    if intel_block:
        system = f"{system}\n\n{intel_block}"

    user_msg = (
        f"Write a date invitation for {match_name} on {platform}. "
        f"{tone} "
    )
    if slot_context:
        user_msg += (
            f"Offer exactly these time windows (pick the 2-3 best ones, phrase\n"
            f"them naturally): {slot_context}. Ask which one works for them. "
        )
    else:
        user_msg += "Suggest drinks or coffee this week with specific day options. "

    result = _call_llm(system, user_msg)
    if result:
        return result

    # Safe fallback — always return something usable
    logger.info("Using fallback date ask for %s.", match_name)
    if slot_context:
        # Strip the "Available: " prefix the slots module adds
        stripped = slot_context.replace("Available: ", "", 1)
        return f"We should grab a drink. I'm free {stripped} — any of those work?"
    return "We should grab drinks this week - are you free Thursday or Friday?"


def generate_reengagement(match_name: str, days_silent: int) -> str:
    """Generate a light re-engagement for conversations gone quiet 48h+."""
    user_msg = (
        f"Write a re-engagement message for {match_name}. "
        f"The conversation has been quiet for {days_silent} days. "
        f"Be light and fun, not desperate."
    )

    result = _call_llm(REENGAGEMENT_SYSTEM, user_msg)
    if result:
        return result

    logger.info("Using fallback reengagement for %s.", match_name)
    return f"still alive over there"


# PHASE-E — AI-8319 — pipeline-gated date ask + reengagement.
def generate_date_ask_with_pipeline(
    match_name: str,
    platform: str = "tinder",
    profile_data: dict | None = None,
    slot_context: str | None = None,
    user_id: str | None = None,
) -> list[str]:
    """Generate a date ask and route through sanitize + validate + split."""
    from clapcheeks.ai import drafter as _drafter

    raw = generate_date_ask(
        match_name=match_name,
        platform=platform,
        profile_data=profile_data,
        slot_context=slot_context,
    )
    result = _drafter.run_pipeline(
        raw_text=raw,
        user_id=user_id,
        conversation_stage="mid",
        on_discard=lambda txt, errs: _drafter.log_discard_to_supabase(
            user_id, platform, txt, errs
        ),
    )
    if result.ok and result.messages:
        return result.messages

    logger.info("Date ask discarded: %s", result.errors)
    return ["we should grab drinks this week. thursday or friday?"]


def generate_reengagement_with_pipeline(
    match_name: str,
    days_silent: int,
    user_id: str | None = None,
) -> list[str]:
    """Generate a reengagement and route through the pipeline."""
    from clapcheeks.ai import drafter as _drafter

    raw = generate_reengagement(match_name=match_name, days_silent=days_silent)
    result = _drafter.run_pipeline(
        raw_text=raw,
        user_id=user_id,
        conversation_stage="mid",
        on_discard=lambda txt, errs: _drafter.log_discard_to_supabase(
            user_id, "reengagement", txt, errs
        ),
    )
    if result.ok and result.messages:
        return result.messages

    logger.info("Reengagement discarded: %s", result.errors)
    return ["still alive over there"]
