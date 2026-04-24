"""Instagram Direct Messages reader.

Reads Julian's IG DM inbox + thread history via the Chrome-extension
job queue (Phase M pattern from AI-8345). The VPS never calls
instagram.com directly — it enqueues a job describing the URL + headers
and the extension runs the fetch inside Julian's real browser session
(credentials: include, so the sessionid cookie rides through).

Endpoints used:
    GET /api/v1/direct_v2/inbox/        — list of threads (most recent first)
    GET /api/v1/direct_v2/threads/<id>/ — paginated thread detail

Required cookie set (already stored in clapcheeks_user_settings
.instagram_auth_token as JSON): sessionid, ds_user_id, csrftoken, mid, ig_did.
The extension rides all of them via credentials: 'include'; we only need
to set X-IG-App-ID + X-CSRFToken headers explicitly.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from clapcheeks.job_queue import enqueue_job, wait_for_completion

logger = logging.getLogger("clapcheeks.instagram_dm")

IG_WEB_BASE = "https://www.instagram.com"
IG_APP_ID = "936619743392459"  # public web-client app id

INBOX_PATH = "/api/v1/direct_v2/inbox/"
THREAD_PATH = "/api/v1/direct_v2/threads/{thread_id}/"


def _parse_stored_cookies(raw: str | None) -> dict[str, str]:
    """Parse the stored instagram_auth_token blob into a cookie dict.

    Accepts either a JSON object {"sessionid": "...", ...} or a raw
    semicolon-delimited cookie string. Returns empty dict on parse
    failure.
    """
    if not raw:
        return {}
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict):
                return {k: str(v) for k, v in obj.items() if v}
        except ValueError:
            logger.warning("instagram_auth_token JSON parse failed")
            return {}
    # Fallback: "k=v; k=v" string
    out: dict[str, str] = {}
    for part in raw.split(";"):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _ig_headers(cookies: dict[str, str]) -> dict[str, str]:
    csrf = cookies.get("csrftoken", "")
    return {
        "X-IG-App-ID": IG_APP_ID,
        "X-CSRFToken": csrf,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"{IG_WEB_BASE}/direct/inbox/",
        "Accept": "*/*",
    }


def enqueue_inbox(user_id: str, stored_token: str | None = None, limit: int = 20) -> str | None:
    """Enqueue an IG inbox fetch. Returns job_id."""
    cookies = _parse_stored_cookies(stored_token)
    headers = _ig_headers(cookies)
    url = f"{IG_WEB_BASE}{INBOX_PATH}?visual_message_return_type=unseen&persistentBadging=true&limit={limit}"
    return enqueue_job(
        user_id=user_id,
        job_type="ig_dm_inbox",
        platform="instagram",
        url=url,
        method="GET",
        headers=headers,
    )


def enqueue_thread(user_id: str, thread_id: str, stored_token: str | None = None, limit: int = 50) -> str | None:
    """Enqueue a single-thread message fetch. Returns job_id."""
    if not thread_id:
        raise ValueError("thread_id is required")
    cookies = _parse_stored_cookies(stored_token)
    headers = _ig_headers(cookies)
    url = f"{IG_WEB_BASE}{THREAD_PATH.format(thread_id=thread_id)}?limit={limit}"
    return enqueue_job(
        user_id=user_id,
        job_type="ig_dm_thread",
        platform="instagram",
        url=url,
        method="GET",
        headers=headers,
    )


def _extract_body(result: dict | None) -> Any:
    if not result:
        return None
    if isinstance(result, dict) and "body" in result:
        return result.get("body")
    return result


def parse_inbox(result: dict | None) -> list[dict]:
    """Normalize the IG inbox response into a simple thread list."""
    body = _extract_body(result) or {}
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            return []
    if not isinstance(body, dict):
        return []

    inbox = body.get("inbox") or {}
    threads = inbox.get("threads") or []
    out: list[dict] = []
    for t in threads:
        users = t.get("users") or []
        usernames = [u.get("username") for u in users if u.get("username")]
        full_names = [u.get("full_name") for u in users if u.get("full_name")]
        last_msg = t.get("last_permanent_item") or {}
        out.append({
            "thread_id": t.get("thread_id") or t.get("thread_v2_id"),
            "thread_title": t.get("thread_title") or ", ".join(full_names) or ", ".join(usernames),
            "usernames": usernames,
            "is_group": bool(t.get("is_group")),
            "has_unseen": (t.get("read_state") or 0) > 0 or bool(t.get("has_older")),
            "last_activity_at": t.get("last_activity_at"),
            "last_message_text": last_msg.get("text"),
            "last_message_type": last_msg.get("item_type"),
            "unread_count": t.get("read_state", 0),
        })
    return out


def parse_thread(result: dict | None) -> dict:
    """Normalize a thread response into {thread_id, messages: [...]}."""
    body = _extract_body(result) or {}
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            return {"thread_id": None, "messages": []}
    if not isinstance(body, dict):
        return {"thread_id": None, "messages": []}

    thread = body.get("thread") or {}
    items = thread.get("items") or []
    messages: list[dict] = []
    for it in items:
        messages.append({
            "item_id": it.get("item_id"),
            "user_id": it.get("user_id"),
            "type": it.get("item_type"),
            "text": it.get("text"),
            "timestamp_us": it.get("timestamp"),
        })
    return {
        "thread_id": thread.get("thread_id") or thread.get("thread_v2_id"),
        "thread_title": thread.get("thread_title"),
        "messages": list(reversed(messages)),  # oldest first
    }


def fetch_inbox_sync(user_id: str, stored_token: str | None, timeout_seconds: int = 300) -> list[dict]:
    """Enqueue + wait for IG inbox. Returns [] on timeout / no extension."""
    job_id = enqueue_inbox(user_id, stored_token)
    if not job_id:
        return []
    result = wait_for_completion(job_id, timeout_seconds=timeout_seconds)
    return parse_inbox(result)


def fetch_thread_sync(
    user_id: str,
    thread_id: str,
    stored_token: str | None,
    timeout_seconds: int = 300,
) -> dict:
    """Enqueue + wait for a single-thread fetch."""
    job_id = enqueue_thread(user_id, thread_id, stored_token)
    if not job_id:
        return {"thread_id": thread_id, "messages": []}
    result = wait_for_completion(job_id, timeout_seconds=timeout_seconds)
    return parse_thread(result)
