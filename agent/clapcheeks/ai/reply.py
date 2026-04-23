"""AI reply generator — Ollama first, Claude API second, Kimi third, safe fallback last.

Research-backed:
- Ask for a date after ~7 messages, skip asking for phone number first
  (60% chance date never happens if you ask for number before date)
- Reference something specific from their messages
- Keep messages short (1-2 sentences max)
- Dating app messages under 160 chars get 2x more responses
"""
from __future__ import annotations

import logging
import os

from clapcheeks.config import load as load_config

logger = logging.getLogger(__name__)

_PLATFORM_TONE = {
    "tinder": "Keep it playful and fun — Tinder conversations are lighter, humor works best.",
    "bumble": "Be slightly more direct and confident — Bumble users appreciate straightforwardness.",
    "hinge": "Keep it casual and warm — Hinge conversations tend to be more relaxed and genuine.",
    "imessage": "Match their energy — iMessage is personal, mirror their texting style closely.",
}

REPLY_SYSTEM = (
    "You are helping craft a reply in a dating app conversation. "
    "Research-backed strategy: "
    "Ask for a date after ~7 messages. Skip asking for phone number first "
    "(60% chance date never happens if you ask for number before date). "
    "Reference something specific from their messages. "
    "Keep messages short — 1-2 sentences max, under 160 characters. "
    "Never be creepy, desperate, or aggressive. "
    "Reply with ONLY the message text."
)


def generate_reply(
    conversation_history: list[dict],
    platform: str,
    style: str = "casual",
    match_profile: dict | None = None,
) -> str:
    """Generate a reply given conversation history and platform.

    Fallback chain: Ollama -> Claude API -> Kimi API -> safe string.
    Injects user persona + match intel (zodiac, interests) into the system
    prompt. Pass `match_profile` (raw rec/user dict) to enable intel.
    """
    from clapcheeks import persona as _persona
    from clapcheeks import match_intel as _intel

    config = load_config()
    model = config.get("ai_model", "llama3.2")

    platform_key = platform.lower()
    tone = _PLATFORM_TONE.get(platform_key, "")

    system = REPLY_SYSTEM
    if tone:
        system += f"\nPlatform tone for {platform}: {tone}"
    system = _persona.merge_into_system(system)

    if match_profile:
        intel = _intel.extract(match_profile)
        intel_block = _intel.format_for_system_prompt(intel)
        if intel_block:
            system = f"{system}\n\n{intel_block}"

    # Format conversation into a readable prompt
    convo_lines = []
    for msg in conversation_history[-10:]:
        role = "You" if msg.get("role") == "assistant" else "Them"
        convo_lines.append(f"{role}: {msg.get('content', '')}")
    convo_text = "\n".join(convo_lines)

    user_msg = f"Conversation so far:\n{convo_text}\n\nWrite a reply."

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]

    # Attempt 1: Ollama (local)
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
        logger.debug("ollama package not installed, trying Claude API fallback.")
    except ConnectionError:
        logger.debug("Ollama not running, trying Claude API fallback.")
    except Exception as exc:
        logger.warning("Ollama reply failed: %s", exc)

    # Attempt 2: Claude API (preferred API fallback for replies)
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=200,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = response.content[0].text.strip()
            if text:
                return text
        except ImportError:
            logger.debug("anthropic package not installed.")
        except Exception as exc:
            logger.warning("Claude API reply failed: %s", exc)

    # Attempt 3: Kimi API
    kimi_key = os.environ.get("KIMI_API_KEY")
    if kimi_key:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=kimi_key, base_url="https://api.moonshot.cn/v1")
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
            logger.warning("Kimi API reply failed: %s", exc)

    # Attempt 4: Safe fallback
    logger.info("Using safe fallback reply.")
    return "haha that's awesome"


# PHASE-E — AI-8319 — pipeline-gated reply.
def generate_reply_with_pipeline(
    conversation_history: list[dict],
    platform: str,
    style: str = "casual",
    match_profile: dict | None = None,
    user_id: str | None = None,
) -> list[str]:
    """Generate a reply, then sanitize + validate + split into message array.

    Returns a list of 1-3 short messages ready to queue. Falls back to a safe
    persona-compliant reply on discard.
    """
    from clapcheeks.ai import drafter as _drafter

    raw = generate_reply(
        conversation_history=conversation_history,
        platform=platform,
        style=style,
        match_profile=match_profile,
    )

    # Infer stage — < 3 messages = early
    stage = "early" if len(conversation_history) < 3 else "mid"

    result = _drafter.run_pipeline(
        raw_text=raw,
        user_id=user_id,
        conversation_stage=stage,
        on_discard=lambda txt, errs: _drafter.log_discard_to_supabase(
            user_id, platform, txt, errs
        ),
    )
    if result.ok and result.messages:
        return result.messages

    logger.info("Reply discarded: %s", result.errors)
    return ["haha that's awesome"]
