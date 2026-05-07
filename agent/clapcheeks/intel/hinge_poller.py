"""Hinge SendBird message poller — AI-9500-C (AI-9507).

Polls the Hinge /match/v1 + SendBird /message/v1/<match_id> endpoints for
new conversations and messages, then pushes each message to Convex via the
messages:upsertFromWebhook mutation.

Graceful degrade
----------------
If neither HINGE_AUTH_TOKEN (env var) nor ~/hinge-auth.json are present the
function returns ``{"skipped": True, "reason": "no_tokens"}`` immediately —
tokens are captured via mitmproxy and may not exist on a fresh Mac Mini setup.

Cursor
------
Incremental polling is tracked in ``~/.clapcheeks/hinge-poller-cursor.json``::

    {"<match_id>": <last_sent_at_ms>, ...}

Only messages with ``sent_at > cursor[match_id]`` are forwarded to Convex.

Transport encoding
------------------
The Convex messages.transport schema only accepts the iMessage-family literals
(bluebubbles, pypush, applescript, sms, imessage_native).  Hinge messages use
``transport="imessage_native"`` as the schema-valid value and store the real
transport identity in ``ai_metadata.transport = "hinge_sendbird"``.

Usage
-----
    python -m clapcheeks.intel.hinge_poller   # single poll cycle, prints JSON
    from clapcheeks.intel.hinge_poller import run_once
    result = run_once()
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger("clapcheeks.intel.hinge_poller")

_HTTP_TIMEOUT = 15
_USER_ID = "fleet-julian"
_HINGE_BASE = "https://prod-api.hingeaws.net"
_CURSOR_PATH = Path.home() / ".clapcheeks" / "hinge-poller-cursor.json"


# ---------------------------------------------------------------------------
# Token loading
# ---------------------------------------------------------------------------

def _load_token() -> str | None:
    """Return the Hinge Bearer token, or None if unavailable."""
    # 1. Env var (highest priority — overrides everything)
    token = os.environ.get("HINGE_AUTH_TOKEN", "").strip()
    if token:
        return token

    # 2. ~/.clapcheeks/hinge-auth.json  (written by hinge_auth.py or mitmproxy)
    auth_file = Path.home() / ".clapcheeks" / "hinge-auth.json"
    if auth_file.exists():
        try:
            data = json.loads(auth_file.read_text())
            token = (data.get("token") or data.get("access_token") or "").strip()
            if token:
                return token
        except Exception as exc:
            logger.warning("Failed to read hinge-auth.json: %s", exc)

    # 3. Legacy location: ~/hinge-auth.json
    legacy = Path.home() / "hinge-auth.json"
    if legacy.exists():
        try:
            data = json.loads(legacy.read_text())
            token = (data.get("token") or data.get("access_token") or "").strip()
            if token:
                return token
        except Exception as exc:
            logger.warning("Failed to read ~/hinge-auth.json: %s", exc)

    return None


# ---------------------------------------------------------------------------
# Cursor helpers
# ---------------------------------------------------------------------------

def _load_cursor() -> dict:
    if _CURSOR_PATH.exists():
        try:
            return json.loads(_CURSOR_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_cursor(cursor: dict) -> None:
    _CURSOR_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CURSOR_PATH.write_text(json.dumps(cursor))


# ---------------------------------------------------------------------------
# Hinge API helpers
# ---------------------------------------------------------------------------

def _hinge_get(path: str, token: str, params: dict | None = None) -> Any:
    url = f"{_HINGE_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    resp = requests.get(url, headers=headers, params=params, timeout=_HTTP_TIMEOUT)
    if resp.status_code == 401:
        raise RuntimeError("Hinge token expired (401)")
    if resp.status_code >= 400:
        raise RuntimeError(f"Hinge API {path} -> {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def _list_matches(token: str) -> list[dict]:
    """Return list of active Hinge matches."""
    try:
        data = _hinge_get("/match/v1", token)
        # API returns {"matches": [...]} or a list directly
        if isinstance(data, list):
            return data
        return data.get("matches") or data.get("data") or []
    except Exception as exc:
        logger.error("Failed to list Hinge matches: %s", exc)
        return []


def _get_messages(match_id: str, token: str) -> list[dict]:
    """Return messages for a single match in ascending sent_at order."""
    try:
        data = _hinge_get(f"/message/v1/{match_id}", token)
        if isinstance(data, list):
            msgs = data
        else:
            msgs = data.get("messages") or data.get("data") or []
        # Sort ascending so we process oldest → newest
        return sorted(msgs, key=lambda m: m.get("sent_at") or m.get("timestamp") or 0)
    except Exception as exc:
        logger.error("Failed to fetch messages for match %s: %s", match_id, exc)
        return []


# ---------------------------------------------------------------------------
# Convex helpers
# ---------------------------------------------------------------------------

def _convex_url() -> str:
    url = os.environ.get("CONVEX_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("CONVEX_URL not set")
    return url


def _convex_mutation(path: str, args: dict) -> Any:
    url = f"{_convex_url()}/api/mutation"
    payload = {"path": path, "args": args, "format": "json"}
    resp = requests.post(url, json=payload, timeout=_HTTP_TIMEOUT)
    if resp.status_code >= 400:
        raise RuntimeError(f"Convex mutation {path} -> {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if isinstance(data, dict) and data.get("status") == "error":
        raise RuntimeError(f"Convex error ({path}): {data.get('errorMessage', data)}")
    return data.get("value") if isinstance(data, dict) else data


def _upsert_conversation(match_id: str, match_name: str | None, photo_url: str | None) -> str:
    """Ensure the conversation row exists; return the Convex _id."""
    conv_id = _convex_mutation(
        "conversations:upsert",
        {
            "user_id": _USER_ID,
            "platform": "hinge",
            "external_match_id": match_id,
            "match_name": match_name,
            "match_photo_url": photo_url,
            "metadata": {"source": "hinge_sendbird_poller"},
        },
    )
    return str(conv_id)


def _post_message(
    match_id: str,
    conversation_id: str,
    msg: dict,
) -> None:
    """Push a single message to Convex via messages:upsertFromWebhook.

    Transport schema workaround
    ---------------------------
    The Convex schema only accepts iMessage-family transport literals.
    We use ``imessage_native`` as the schema-valid value and encode the
    real transport identity in ``ai_metadata``.
    """
    # Determine direction: if the message sender is the user (me) → outbound
    sender = msg.get("sender") or msg.get("from_user") or msg.get("from") or ""
    direction = "outbound" if str(sender).lower() in ("me", "user", "self", _USER_ID) else "inbound"

    # Timestamp — Hinge API may return ms or seconds
    raw_ts = msg.get("sent_at") or msg.get("timestamp") or time.time()
    if raw_ts < 1e12:  # seconds → ms
        raw_ts = int(raw_ts * 1000)
    sent_at_ms = int(raw_ts)

    body = msg.get("body") or msg.get("text") or msg.get("content") or ""
    external_guid = msg.get("id") or msg.get("message_id") or f"{match_id}:{sent_at_ms}"

    # Synthetic handle: encode the hinge match_id so the mutation can
    # create/find the conversation even though there's no phone number.
    handle = f"hinge-match:{match_id}"

    _convex_mutation(
        "messages:upsertFromWebhook",
        {
            "user_id": _USER_ID,
            "line": handle,
            "direction": direction,
            "handle": handle,
            "body": body,
            "sent_at": sent_at_ms,
            "external_guid": external_guid,
            # Schema-valid transport literal
            "transport": "imessage_native",
            "ai_metadata": {
                "transport": "hinge_sendbird",
                "platform": "hinge",
                "match_id": match_id,
                "conversation_id": conversation_id,
                "raw_sender": sender,
            },
        },
    )


# ---------------------------------------------------------------------------
# Main polling function
# ---------------------------------------------------------------------------

def run_once() -> dict:
    """Poll Hinge for new messages and push to Convex.

    Returns a result dict::

        {
            "processed": int,   # messages posted to Convex
            "matches_checked": int,
            "skipped": bool,    # True if no tokens available
            "reason": str | None,
            "error": str | None,
        }
    """
    token = _load_token()
    if not token:
        logger.info("No Hinge auth token found — graceful degrade")
        return {
            "processed": 0,
            "matches_checked": 0,
            "skipped": True,
            "reason": "no_tokens",
            "error": None,
        }

    cursor = _load_cursor()
    processed = 0
    matches_checked = 0
    errors: list[str] = []

    try:
        matches = _list_matches(token)
    except RuntimeError as exc:
        return {
            "processed": 0,
            "matches_checked": 0,
            "skipped": False,
            "reason": None,
            "error": str(exc),
        }

    for match in matches:
        match_id = str(match.get("matchId") or match.get("id") or "")
        if not match_id:
            continue

        matches_checked += 1
        match_name = match.get("name") or match.get("displayName")
        photos = match.get("photos") or []
        photo_url = photos[0].get("url") if photos else None

        # Ensure conversation exists in Convex
        try:
            conv_id = _upsert_conversation(match_id, match_name, photo_url)
        except Exception as exc:
            logger.error("upsert_conversation failed for %s: %s", match_id, exc)
            errors.append(f"upsert:{match_id}:{exc}")
            continue

        # Fetch messages and filter to new ones
        messages = _get_messages(match_id, token)
        last_seen = cursor.get(match_id, 0)
        new_msgs = [
            m for m in messages
            if (m.get("sent_at") or m.get("timestamp") or 0) > last_seen
        ]

        for msg in new_msgs:
            try:
                _post_message(match_id, conv_id, msg)
                raw_ts = msg.get("sent_at") or msg.get("timestamp") or 0
                if raw_ts < 1e12:
                    raw_ts = int(raw_ts * 1000)
                cursor[match_id] = max(cursor.get(match_id, 0), int(raw_ts))
                processed += 1
            except Exception as exc:
                logger.error("Failed to post message for match %s: %s", match_id, exc)
                errors.append(f"msg:{match_id}:{exc}")

    _save_cursor(cursor)

    result: dict = {
        "processed": processed,
        "matches_checked": matches_checked,
        "skipped": False,
        "reason": None,
        "error": "; ".join(errors) if errors else None,
    }
    logger.info("Hinge poll complete: %s", result)
    return result


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Load ~/.clapcheeks/.env if present
    try:
        from dotenv import load_dotenv
        env_file = Path.home() / ".clapcheeks" / ".env"
        if env_file.exists():
            load_dotenv(env_file, override=False)
    except ImportError:
        pass

    result = run_once()
    print(json.dumps(result, indent=2))
    sys.exit(0 if not result.get("error") else 1)
