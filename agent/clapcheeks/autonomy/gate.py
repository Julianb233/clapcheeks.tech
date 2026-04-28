"""AI-8809 — AI active gate.

Single entry point: ``is_ai_active(supabase, user_id, match_id) -> bool``.

Queries the ``clapcheeks_ai_effective_state`` view which merges:
  - ``clapcheeks_user_settings.ai_active``          (master user switch)
  - ``clapcheeks_user_settings.ai_paused_until``    (snooze timer)
  - ``clapcheeks_matches.ai_active``                (per-match override)

Returns ``True``  — agent may act.
Returns ``False`` — agent must stay silent (observation mode).

A missing row (new user, no settings yet) defaults to ``True`` so the agent
works out of the box without requiring an explicit setup step.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("clapcheeks.autonomy.gate")


def is_ai_active(
    supabase: Any,
    user_id: str,
    match_id: str,
) -> bool:
    """Return True if the AI agent is allowed to act for this match.

    Args:
        supabase: A Supabase client instance (from ``supabase-py`` or the
                  ``supabase`` package) that can call ``.table()`` or
                  ``.from_()``.
        user_id:  The user's UUID string.
        match_id: The match's UUID string.

    Returns:
        bool — True if active, False if paused/disabled.
    """
    if not user_id or not match_id:
        logger.debug("gate: missing user_id or match_id — defaulting to active")
        return True

    try:
        resp = (
            supabase
            .from_("clapcheeks_ai_effective_state")
            .select("is_active, ai_paused_until, ai_paused_reason")
            .eq("user_id", user_id)
            .eq("match_id", match_id)
            .single()
            .execute()
        )
        row = resp.data if hasattr(resp, "data") else resp
        if not row:
            # No row = new match or new user. Default to active.
            logger.debug(
                "gate: no row for user=%s match=%s — defaulting to active",
                user_id, match_id,
            )
            return True

        active = bool(row.get("is_active", True))
        if not active:
            until = row.get("ai_paused_until")
            reason = row.get("ai_paused_reason") or "no reason given"
            logger.info(
                "gate: AI PAUSED for user=%s match=%s | reason=%r until=%s",
                user_id, match_id, reason, until,
            )
        return active

    except Exception as exc:
        # Never block the agent due to a gate lookup failure. Log and allow.
        logger.warning(
            "gate: lookup failed for user=%s match=%s — defaulting to active. err=%s",
            user_id, match_id, exc,
        )
        return True
