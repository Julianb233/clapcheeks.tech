"""Re-engagement sequences for cold matches.

A match is "cold" if:
- Last message was sent by us (they haven't replied)
- 3+ days have passed since our last message

Re-engagement strategy by days since last message:
- Day 3-5:  Light bump -- casual, low-pressure ("Hey, still around?")
- Day 6-10: Conversation restart -- new topic, fresh energy
- Day 11+:  Final attempt -- genuine, slightly vulnerable ("I know it's been a while...")
- Day 15+:  Archive -- stop trying, mark as dormant

Uses the same AI service as ConversationManager but with stage=REENGAGEMENT.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests

from clapcheeks.conversation.state import get_conversation, update_conversation

logger = logging.getLogger(__name__)

CONVERSATIONS_DIR = Path.home() / ".clapcheeks" / "conversations"


@dataclass
class ColdMatch:
    match_id: str
    name: str
    platform: str
    days_cold: int
    last_message_was_ours: bool
    conversation_snapshot: list[dict] = field(default_factory=list)


def find_cold_matches(state_dir: Path | None = None) -> list[ColdMatch]:
    """Scan local conversation state files for matches that have gone cold.

    Reads from ~/.clapcheeks/conversations/ directory (JSON state files per match).
    Each file has: match_id, name, platform, messages list with timestamps.
    A match is cold when last message role == "assistant" and timestamp > 3 days ago.
    """
    conv_dir = state_dir or CONVERSATIONS_DIR
    if not conv_dir.exists():
        return []

    cold: list[ColdMatch] = []
    now = time.time()
    three_days = 3 * 86400

    for f in conv_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        match_id = data.get("match_id", f.stem)
        name = data.get("name", "them")
        platform = data.get("platform", "")
        messages = data.get("messages", [])

        if not messages:
            continue

        last_msg = messages[-1]
        last_role = last_msg.get("role", "")
        last_ts = last_msg.get("timestamp", 0)

        # Only cold if we sent the last message and 3+ days have passed
        if last_role != "assistant":
            continue
        if last_ts <= 0:
            continue

        elapsed = now - last_ts
        if elapsed < three_days:
            continue

        days_cold = int(elapsed / 86400)

        # Check conversation state for dormant flag
        state = get_conversation(match_id)
        if state.get("dormant"):
            continue

        cold.append(ColdMatch(
            match_id=match_id,
            name=name,
            platform=platform,
            days_cold=days_cold,
            last_message_was_ours=True,
            conversation_snapshot=messages[-3:],
        ))

    cold.sort(key=lambda m: m.days_cold)
    return cold


def get_reengagement_stage(days_cold: int) -> str:
    """Returns: 'bump' | 'restart' | 'final' | 'archive'"""
    if days_cold >= 15:
        return "archive"
    if days_cold >= 11:
        return "final"
    if days_cold >= 6:
        return "restart"
    return "bump"


def generate_reengagement_message(
    match: ColdMatch,
    ai_url: str,
    style: str = "casual, direct, genuine",
) -> str | None:
    """Call AI service to generate a re-engagement message appropriate to stage.

    Returns None for 'archive' stage (no message should be sent).
    """
    stage = get_reengagement_stage(match.days_cold)
    if stage == "archive":
        return None

    stage_descriptions = {
        "bump": "a light, casual bump -- low-pressure, brief, like 'Hey, still around?'",
        "restart": "a conversation restart -- new topic, fresh energy, don't reference the silence",
        "final": "a final genuine attempt -- slightly vulnerable, honest about the gap",
    }

    system_context = (
        f"This match has gone {match.days_cold} days without responding. "
        f"Generate {stage_descriptions[stage]}. "
        f"Their name is {match.name}. Keep it short (1-2 sentences max). "
        f"Do NOT be needy or guilt-trip."
    )

    payload = {
        "platform": match.platform,
        "conversation": match.conversation_snapshot,
        "style_description": style,
        "system_context": system_context,
        "reengagement_stage": stage,
    }

    try:
        resp = requests.post(f"{ai_url}/reply/suggest", json=payload, timeout=15)
        resp.raise_for_status()
        return resp.json().get("suggestion", "").strip() or None
    except Exception as exc:
        logger.warning("AI reengagement call failed for %s: %s", match.name, exc)
        return None


def run_reengagement_pass(platform_clients: dict, config: dict) -> dict:
    """Find all cold matches, generate re-engagement messages, send them.

    Args:
        platform_clients: {platform_name: client_instance}
        config: must include 'ai_service_url'; optionally 'dry_run'

    Returns: {checked, sent, archived, errors}
    """
    ai_url = config.get("ai_service_url", "http://localhost:8000")
    dry_run = config.get("dry_run", False)

    results = {"checked": 0, "sent": 0, "archived": 0, "errors": 0}

    cold_matches = find_cold_matches()
    results["checked"] = len(cold_matches)

    for match in cold_matches:
        stage = get_reengagement_stage(match.days_cold)

        # Archive dormant matches
        if stage == "archive":
            update_conversation(match.match_id, dormant=True)
            results["archived"] += 1
            logger.info("Archived cold match %s (%d days)", match.name, match.days_cold)
            continue

        # Only send if we have a client for this platform
        client = platform_clients.get(match.platform)
        if not client:
            continue

        message = generate_reengagement_message(match, ai_url)
        if not message:
            results["errors"] += 1
            continue

        if dry_run:
            logger.info(
                "[DRY RUN] Would re-engage %s (%s, %d days, stage=%s): %s",
                match.name, match.platform, match.days_cold, stage, message,
            )
            results["sent"] += 1
            continue

        try:
            if client.send_message(match.match_id, message):
                update_conversation(match.match_id, last_ts=time.time())
                results["sent"] += 1
                logger.info(
                    "Re-engaged %s (%s, %d days, stage=%s)",
                    match.name, match.platform, match.days_cold, stage,
                )
            else:
                results["errors"] += 1
        except Exception as exc:
            logger.error("Failed to re-engage %s: %s", match.name, exc)
            results["errors"] += 1

    return results
