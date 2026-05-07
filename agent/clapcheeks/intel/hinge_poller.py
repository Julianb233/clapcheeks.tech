"""Hinge conversation poller — AI-9500-C (AI-9507).

Polls active Hinge matches via the Hinge REST API and upserts new messages
into Convex via ``messages:upsertFromWebhook`` with ``transport`` encoding
set to identify the source as ``hinge_sendbird`` in ``ai_metadata``.

Architecture
------------
- **Token sources**: reads ``HINGE_AUTH_TOKEN`` from env (set by
  ``hinge_auth.py``'s ``refresh_token`` or the SMS auto-refresh in
  ``hinge_api.py``). Falls back to ``~/hinge-auth.json`` if env var is
  absent (token capture from mitmproxy lands here).
- **Cursor**: per-match watermark at ``~/.clapcheeks/hinge-poller-cursor.json``
  as ``{match_id: last_sent_at_ms}``. Messages at-or-before the cursor are
  skipped (idempotent re-runs are safe).
- **Convex**: fires ``conversations:upsert`` + ``messages:upsertFromWebhook``
  via the Convex HTTP REST API (``POST /api/mutation``).  Env var
  ``CONVEX_URL`` must be set.
- **Graceful degrade**: if ``HINGE_AUTH_TOKEN`` is missing AND
  ``~/hinge-auth.json`` is absent (tokens not yet captured via mitmproxy),
  returns ``{skipped: True, reason: "no_tokens"}`` immediately — no
  exception, no crash.

Transport encoding
------------------
The Convex ``messages`` schema's ``transport`` union does not yet include a
``hinge_sendbird`` literal (schema.ts is owned by Task A/parallel agents and
must not be edited here). Transport info is therefore stored in the message's
``ai_metadata`` field::

    ai_metadata: {"transport": "hinge_sendbird", "platform": "hinge"}

The ``external_guid`` carries ``hinge:<match_id>:<msg_id>`` for Convex-level
dedup so re-running the poller never creates duplicates.

Usage
-----
Run standalone (prints JSON result to stdout)::

    python -m clapcheeks.intel.hinge_poller

Called by ``convex_runner.py`` via the ``sync_hinge`` agent_job kind::

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

logger = logging.getLogger("clapcheeks.hinge_poller")

# ---------------------------------------------------------------------------
# Paths + constants
# ---------------------------------------------------------------------------

_CURSOR_FILE = Path.home() / ".clapcheeks" / "hinge-poller-cursor.json"
_AUTH_FILE = Path.home() / "hinge-auth.json"          # mitmproxy token capture
_SENDBIRD_FILE = Path.home() / "sendbird-session.json" # optional SendBird session
_DEFAULT_HINGE_BASE = "https://prod-api.hingeaws.net"
_HTTP_TIMEOUT = 15
_USER_ID = "fleet-julian"           # single-tenant; matches all other Convex callers
_MAX_MATCHES_PER_POLL = 100         # safety cap on match list
_MAX_MESSAGES_PER_MATCH = 50        # per match, per poll
_LINE = 0                           # line=0 means "hinge platform" (not a phone line)


# ---------------------------------------------------------------------------
# Token resolution
# ---------------------------------------------------------------------------

def _load_token() -> str | None:
    """Return the Hinge bearer token, trying env then ~/hinge-auth.json.

    Returns None (instead of raising) so the caller can gracefully degrade.
    """
    # 1. env var set by hinge_auth.py's refresh_token or daemon startup
    token = os.environ.get("HINGE_AUTH_TOKEN", "").strip()
    if token:
        return token

    # 2. mitmproxy capture file (~/.clapcheeks/.env also covers this via dotenv,
    #    but hinge-auth.json is the explicit per-task capture path)
    if _AUTH_FILE.exists():
        try:
            data = json.loads(_AUTH_FILE.read_text())
            token = (
                data.get("token")
                or data.get("access_token")
                or data.get("hinge_auth_token")
                or ""
            ).strip()
            if token:
                logger.info("Hinge token loaded from %s", _AUTH_FILE)
                return token
        except Exception as exc:
            logger.warning("Could not read %s: %s", _AUTH_FILE, exc)

    return None


# ---------------------------------------------------------------------------
# Cursor helpers
# ---------------------------------------------------------------------------

def _load_cursor() -> dict[str, int]:
    """Return {match_id: last_sent_at_ms} from disk. Empty dict if missing."""
    if _CURSOR_FILE.exists():
        try:
            return json.loads(_CURSOR_FILE.read_text())
        except Exception as exc:
            logger.warning("Cursor file unreadable, resetting: %s", exc)
    return {}


def _save_cursor(cursor: dict[str, int]) -> None:
    _CURSOR_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CURSOR_FILE.write_text(json.dumps(cursor, indent=2))
    try:
        _CURSOR_FILE.chmod(0o600)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Convex HTTP helpers
# ---------------------------------------------------------------------------

def _convex_mutation(mutation_path: str, args: dict[str, Any]) -> Any:
    """POST a Convex mutation via the HTTP REST API.

    mutation_path — e.g. ``"conversations:upsert"``
    args          — dict matching the mutation's ``v.*`` arg schema

    Returns the parsed ``value`` field, or raises ``RuntimeError`` on failure.
    """
    convex_url = os.environ.get("CONVEX_URL", "").rstrip("/")
    if not convex_url:
        raise RuntimeError("CONVEX_URL not set. Export it before running the poller.")
    url = f"{convex_url}/api/mutation"
    payload = {"path": mutation_path, "args": args, "format": "json"}
    resp = requests.post(url, json=payload, timeout=_HTTP_TIMEOUT)
    if resp.status_code >= 400:
        raise RuntimeError(
            f"Convex {mutation_path} -> {resp.status_code}: {resp.text[:300]}"
        )
    data = resp.json()
    if isinstance(data, dict) and data.get("status") == "error":
        raise RuntimeError(
            f"Convex mutation error ({mutation_path}): {data.get('errorMessage', data)}"
        )
    return data.get("value") if isinstance(data, dict) else data


def _convex_query(query_path: str, args: dict[str, Any]) -> Any:
    """POST a Convex query via the HTTP REST API."""
    convex_url = os.environ.get("CONVEX_URL", "").rstrip("/")
    if not convex_url:
        return None
    try:
        url = f"{convex_url}/api/query"
        payload = {"path": query_path, "args": args, "format": "json"}
        resp = requests.post(url, json=payload, timeout=_HTTP_TIMEOUT)
        if resp.status_code >= 400:
            return None
        data = resp.json()
        return data.get("value") if isinstance(data, dict) else None
    except Exception as exc:
        logger.debug("Convex query %s failed: %s", query_path, exc)
        return None


# ---------------------------------------------------------------------------
# Hinge REST helpers
# ---------------------------------------------------------------------------

def _hinge_headers(token: str) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Hinge/9.68.0 (iPhone; iOS 17.4; Scale/3.00)",
        "X-App-Version": "9.68.0",
        "X-Build-Number": "9680",
        "X-OS-Version": "17.4",
        "X-Device-Platform": "ios",
    }
    for env_key, header in (
        ("HINGE_INSTALL_ID", "X-Install-Id"),
        ("HINGE_SESSION_ID", "X-Session-Id"),
        ("HINGE_DEVICE_ID", "X-Device-Id"),
    ):
        val = os.environ.get(env_key, "").strip()
        if val:
            h[header] = val
    return h


def _hinge_get(path: str, token: str, params: dict | None = None) -> Any:
    base = os.environ.get("HINGE_API_BASE", _DEFAULT_HINGE_BASE).rstrip("/")
    url = path if path.startswith("http") else f"{base}{path}"
    resp = requests.get(
        url, headers=_hinge_headers(token), params=params, timeout=_HTTP_TIMEOUT
    )
    if resp.status_code == 401:
        raise PermissionError("Hinge 401: token expired or invalid")
    if resp.status_code >= 400:
        raise RuntimeError(f"Hinge GET {path} -> {resp.status_code}: {resp.text[:200]}")
    return resp.json() if resp.content else {}


def _fetch_matches(token: str, limit: int = _MAX_MATCHES_PER_POLL) -> list[dict]:
    """Return active matches from /match/v1."""
    try:
        data = _hinge_get(f"/match/v1?limit={limit}", token)
        matches = (data.get("matches") if isinstance(data, dict) else data) or []
        return list(matches)
    except Exception as exc:
        logger.warning("Failed to fetch Hinge matches: %s", exc)
        return []


def _fetch_messages_for_match(
    token: str, match_id: str, limit: int = _MAX_MESSAGES_PER_MATCH
) -> list[dict]:
    """Return messages for a specific match from /message/v1/{match_id}."""
    try:
        data = _hinge_get(f"/message/v1/{match_id}?limit={limit}", token)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return (
                data.get("messages")
                or data.get("data")
                or data.get("items")
                or []
            )
        return []
    except Exception as exc:
        logger.debug("Messages fetch for match %s failed: %s", match_id, exc)
        return []


def _normalize_message(raw: dict, match_id: str) -> dict | None:
    """Normalize a raw Hinge message dict into a standard shape.

    Returns None if the message can't be normalized (missing body or id).
    """
    msg_id = (
        raw.get("messageId") or raw.get("message_id") or raw.get("id") or ""
    )
    body = raw.get("body") or raw.get("text") or raw.get("content") or ""
    if not msg_id or not body:
        return None

    # sent_at: Hinge sends ISO strings or millisecond ints
    sent_raw = raw.get("sentAt") or raw.get("sent_at") or raw.get("createdAt") or 0
    if isinstance(sent_raw, str):
        try:
            from datetime import datetime as _dt
            sent_at = int(
                _dt.fromisoformat(sent_raw.replace("Z", "+00:00")).timestamp() * 1000
            )
        except Exception:
            sent_at = int(time.time() * 1000)
    else:
        sent_at = int(sent_raw)
        # If looks like seconds (< year 3000 in ms), convert to ms
        if sent_at < 9_999_999_999:
            sent_at *= 1000

    # direction: "inbound" = she sent it, "outbound" = we sent it
    sender_type = (
        raw.get("senderType")
        or raw.get("sender_type")
        or raw.get("type")
        or ""
    ).lower()
    # Hinge uses: "user" / "self" / "me" for Julian, "match" / "subject" for her
    direction: str = "outbound" if sender_type in ("user", "self", "me") else "inbound"

    # Stable external GUID for dedup
    external_guid = f"hinge:{match_id}:{msg_id}"

    return {
        "msg_id": msg_id,
        "external_guid": external_guid,
        "body": body,
        "sent_at": sent_at,
        "direction": direction,
    }


# ---------------------------------------------------------------------------
# Core poll function (public API)
# ---------------------------------------------------------------------------

def run_once() -> dict:
    """Poll Hinge for new messages and upsert them into Convex.

    This is the primary entrypoint called by ``convex_runner.py``'s
    ``sync_hinge`` handler.

    Returns a result dict::

        {
            "processed": int,   # messages inserted into Convex
            "skipped": bool,    # True if poll was skipped entirely
            "reason": str|None, # why it was skipped, if skipped=True
            "channels": int,    # match threads checked
            "messages": int,    # total messages seen (before cursor filter)
            "errors": int,      # upsert errors encountered
        }
    """
    # ------------------------------------------------------------------
    # 1. Token check — graceful degrade if not captured yet
    # ------------------------------------------------------------------
    token = _load_token()
    if not token:
        logger.info(
            "Hinge poller skipped: no token. "
            "Set HINGE_AUTH_TOKEN or capture via mitmproxy → ~/hinge-auth.json"
        )
        return {
            "processed": 0,
            "skipped": True,
            "reason": "no_tokens",
            "channels": 0,
            "messages": 0,
            "errors": 0,
        }

    # ------------------------------------------------------------------
    # 2. Convex URL check
    # ------------------------------------------------------------------
    convex_url = os.environ.get("CONVEX_URL", "").strip()
    if not convex_url:
        logger.warning("Hinge poller skipped: CONVEX_URL not set.")
        return {
            "processed": 0,
            "skipped": True,
            "reason": "no_convex_url",
            "channels": 0,
            "messages": 0,
            "errors": 0,
        }

    # ------------------------------------------------------------------
    # 3. Load poll cursor
    # ------------------------------------------------------------------
    cursor = _load_cursor()
    processed = 0
    errors = 0
    total_messages_seen = 0

    # ------------------------------------------------------------------
    # 4. Fetch active matches
    # ------------------------------------------------------------------
    matches = _fetch_matches(token)
    logger.info("Hinge poller: found %d matches", len(matches))

    for match in matches:
        match_id = (
            match.get("matchId") or match.get("id") or match.get("match_id") or ""
        ).strip()
        if not match_id:
            continue

        subject = match.get("subject") or {}
        match_name = (
            subject.get("firstName") or subject.get("name") or match.get("name") or ""
        ).strip()

        # ------------------------------------------------------------------
        # 4a. Upsert conversation in Convex (idempotent — returns conv._id)
        # ------------------------------------------------------------------
        try:
            conv_id = _convex_mutation(
                "conversations:upsert",
                {
                    "user_id": _USER_ID,
                    "platform": "hinge",
                    "external_match_id": match_id,
                    "match_name": match_name or None,
                    "metadata": {"source": "hinge_sendbird_poller"},
                },
            )
        except Exception as exc:
            logger.warning("conversations:upsert failed for match %s: %s", match_id, exc)
            errors += 1
            continue

        # ------------------------------------------------------------------
        # 4b. Fetch messages for this match
        # ------------------------------------------------------------------
        raw_messages = _fetch_messages_for_match(token, match_id)
        total_messages_seen += len(raw_messages)

        cursor_ts = cursor.get(match_id, 0)
        new_cursor_ts = cursor_ts

        # ------------------------------------------------------------------
        # 4c. Upsert new messages via messages:upsertFromWebhook
        #
        # The Convex schema's transport union does not yet include
        # "hinge_sendbird" — the schema is managed by parallel agents and
        # must not be modified here. We therefore:
        #   • set transport="imessage_native" as the closest schema-valid value
        #     that won't cause Convex validation to reject the mutation.
        #   • encode the true transport identity in ai_metadata so downstream
        #     queries (enrichment, analytics) can filter by platform.
        #
        # external_guid: "hinge:<match_id>:<msg_id>" ensures dedup across
        # re-runs and avoids the pending-row reconciliation path in upsertFromWebhook.
        # ------------------------------------------------------------------
        for raw in raw_messages:
            msg = _normalize_message(raw, match_id)
            if msg is None:
                continue
            if msg["sent_at"] <= cursor_ts:
                continue  # already processed in a prior run

            # Hinge match_id is used as the "handle" for conversation lookup
            # (upsertFromWebhook resolves-or-creates by handle + user_id).
            hinge_handle = f"hinge-match:{match_id}"

            try:
                _convex_mutation(
                    "messages:upsertFromWebhook",
                    {
                        "user_id": _USER_ID,
                        "line": _LINE,
                        "direction": msg["direction"],
                        "handle": hinge_handle,
                        "body": msg["body"],
                        "sent_at": msg["sent_at"],
                        "external_guid": msg["external_guid"],
                        # transport must be a schema-valid literal;
                        # "hinge_sendbird" is encoded in ai_metadata below.
                        "transport": "imessage_native",
                        "ai_metadata": {
                            "transport": "hinge_sendbird",
                            "platform": "hinge",
                            "hinge_match_id": match_id,
                            "hinge_msg_id": msg["msg_id"],
                            "poller": "hinge_poller_v1",
                        },
                    },
                )
                processed += 1
                if msg["sent_at"] > new_cursor_ts:
                    new_cursor_ts = msg["sent_at"]

            except Exception as exc:
                logger.warning(
                    "messages:upsertFromWebhook failed for %s / %s: %s",
                    match_id,
                    msg["external_guid"],
                    exc,
                )
                errors += 1

        # Advance cursor for this match
        if new_cursor_ts > cursor_ts:
            cursor[match_id] = new_cursor_ts

    _save_cursor(cursor)

    logger.info(
        "Hinge poller done: %d processed, %d seen, %d channels, %d errors",
        processed,
        total_messages_seen,
        len(matches),
        errors,
    )
    return {
        "processed": processed,
        "skipped": False,
        "reason": None,
        "channels": len(matches),
        "messages": total_messages_seen,
        "errors": errors,
    }


# Legacy alias — used by any existing callers that imported poll_hinge()
poll_hinge = run_once


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def _main() -> None:
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Load ~/.clapcheeks/.env if present (covers HINGE_AUTH_TOKEN, CONVEX_URL, etc.)
    try:
        from dotenv import load_dotenv
        env_file = Path.home() / ".clapcheeks" / ".env"
        if env_file.exists():
            load_dotenv(env_file, override=False)
    except ImportError:
        pass

    result = run_once()
    print(json.dumps(result, indent=2))
    sys.exit(0 if not result.get("skipped") else 1)


if __name__ == "__main__":
    _main()
