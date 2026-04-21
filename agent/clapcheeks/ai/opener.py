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
    Injects the user's persona + extracted match intel (zodiac, interests, etc.)
    into the system + user prompts so every message is on-voice and personal.
    """
    from clapcheeks import persona as _persona
    from clapcheeks import match_intel as _intel

    config = load_config()
    model = model or config.get("ai_model", "llama3.2")

    # GIF opener path — 30% higher response rate, 2x longer conversations
    if use_gif and random.random() < 0.35:
        mood = random.choice(_GIF_MOODS)
        gif_url = get_gif_url(mood)
        if gif_url:
            return gif_url  # Platform clients send this as a GIF message

    intel = _intel.extract(profile_data) if profile_data else {}
    intel_block = _intel.format_for_system_prompt(intel)

    system = _persona.merge_into_system(SYSTEM_PROMPT)
    if intel_block:
        system = f"{system}\n\n{intel_block}"

    # Build user message (persona + intel already live in system — keep this tight)
    user_msg = f"Write an opener for {match_name}."
    if intel.get("prompt_themes"):
        user_msg += f" Reference: \"{intel['prompt_themes'][0]}\"."
    elif profile_data:
        details = ", ".join(f"{k}: {v}" for k, v in profile_data.items() if v)
        if details:
            user_msg += f" Profile: {details}."

    messages = [
        {"role": "system", "content": system},
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


# PHASE-E — AI-8319 — pipeline-gated opener.
def generate_opener_with_pipeline(
    match_name: str,
    profile_data: dict | None = None,
    model: str | None = None,
    use_gif: bool = True,
    user_id: str | None = None,
) -> list[str]:
    """Generate an opener, then run it through the persona + sanitize + split pipeline.

    Returns a list of 1-3 short messages ready to queue. If the raw draft fails
    validation, returns a safe persona-compliant fallback.
    """
    from clapcheeks.ai import drafter as _drafter

    raw = generate_opener(
        match_name=match_name,
        profile_data=profile_data,
        model=model,
        use_gif=use_gif,
    )

    # GIF URLs pass through untouched.
    if raw.startswith("http"):
        return [raw]

    result = _drafter.run_pipeline(
        raw_text=raw,
        user_id=user_id,
        conversation_stage="early",
        on_discard=lambda txt, errs: _drafter.log_discard_to_supabase(
            user_id, "opener", txt, errs
        ),
    )
    if result.ok and result.messages:
        return result.messages

    # Discarded — return a safe, persona-compliant fallback.
    logger.info("Opener discarded for %s: %s", match_name, result.errors)
    return [f"hey {match_name.lower()} how's your week"]


# PHASE-L - AI-8340 - freshness gate hook for high-score matches.
def check_and_refresh_ig_story(
    user_id: str,
    final_score: float | None = None,
    score_threshold: float = 0.85,
) -> dict[str, object]:
    """Before firing an opener on a high-score match, make sure the
    user's IG story presence is fresh. If stale, fires an IG story
    post from the content library first and returns info about what
    was posted so the caller can decide to delay the opener.

    Returns::

        {
          "fresh": bool,            # True if we don't need to wait
          "posted_story": bool,     # True if we just fired one
          "job_id": str | None,     # the agent_job waiting on delivery
          "reason": str,            # debug reason
        }

    The daemon caller should, if ``posted_story`` is True, sleep ~10
    min before actually sending the opener so the match's IG grid has
    had time to show the fresh story.
    """
    if user_id is None:
        return {"fresh": True, "posted_story": False, "job_id": None,
                "reason": "no_user"}
    if final_score is not None and final_score < score_threshold:
        return {"fresh": True, "posted_story": False, "job_id": None,
                "reason": "below_threshold"}

    try:
        from clapcheeks.content.publisher import (
            check_ig_freshness, post_library_item_now,
        )
    except Exception as exc:
        logger.debug("freshness check import failed: %s", exc)
        return {"fresh": True, "posted_story": False, "job_id": None,
                "reason": f"import_failed:{exc}"}

    try:
        status = check_ig_freshness(user_id)
    except Exception as exc:
        logger.warning("check_ig_freshness crashed: %s", exc)
        return {"fresh": True, "posted_story": False, "job_id": None,
                "reason": f"check_failed:{exc}"}

    if not status.get("is_stale"):
        return {"fresh": True, "posted_story": False, "job_id": None,
                "reason": "already_fresh"}

    # Pick the best unposted library row to fire.
    try:
        from clapcheeks.job_queue import _client as _svc_client
        c = _svc_client()
        resp = (
            c.table("clapcheeks_content_library")
            .select("id, category")
            .eq("user_id", user_id)
            .is_("posted_at", "null")
            .eq("post_type", "story")
            .limit(1)
            .execute()
        )
        rows = getattr(resp, "data", None) or []
    except Exception as exc:
        logger.warning("library lookup failed: %s", exc)
        return {"fresh": False, "posted_story": False, "job_id": None,
                "reason": f"library_lookup_failed:{exc}"}

    if not rows:
        return {"fresh": False, "posted_story": False, "job_id": None,
                "reason": "no_library_inventory"}

    pick = rows[0]
    out = post_library_item_now(user_id=user_id, content_library_id=pick["id"])
    return {
        "fresh": False,
        "posted_story": bool(out.get("ok")),
        "job_id": out.get("job_id"),
        "reason": out.get("reason", "fired"),
    }
