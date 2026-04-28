"""Phase L (AI-8340) - IG posting publisher (Phase M queue-backed).

Drains rows from ``clapcheeks_posting_queue`` whose ``scheduled_for``
has passed and ``status = 'pending'``. For each due row we:

1. Generate a signed Supabase Storage URL for the media_path so the
   extension can download it from the user's Chrome session.
2. Enqueue an ``ig_post_story`` agent_job via ``enqueue_job`` with
   ``platform='instagram'``. The extension drains the job, performs the
   story upload with ``credentials: 'include'`` so the IG session
   cookie rides through, and POSTs the response back to
   ``/api/ingest/api-result``.
3. Flip the posting_queue row to ``in_progress`` and store the
   agent_job_id so the next tick can reconcile.
4. On the next tick (or via a wait), if the agent_job completes we
   mark the content_library row ``posted_at=now()`` and the queue row
   ``status='posted'``.

If the IG session cookie is missing/expired, we iMessage Julian and
leave the queue row pending. The Phase M job queue's
``alert_julian_extension_offline`` helper is reused.

``check_ig_freshness(user_id)`` is exported so Phase G's opener
drafter can call it before firing high-score openers.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger("clapcheeks.content.publisher")

# Matches persona.content_library.freshness_rule.max_staleness_days.
DEFAULT_FRESHNESS_DAYS = 3

# IG private-graph story endpoint the extension posts to. We keep the
# URL in one place so a future IG change is a single edit.
IG_STORY_UPLOAD_URL = "https://i.instagram.com/api/v1/media/configure_to_story/"


# ---------------------------------------------------------------------------
# Freshness gate (called by Phase G)
# ---------------------------------------------------------------------------


def check_ig_freshness(
    user_id: str,
    max_staleness_days: int | None = None,
    now: datetime | None = None,
    client: Any = None,
) -> dict[str, Any]:
    """Return whether the user's IG story presence is stale.

    Response shape::

        {
          "is_stale": bool,
          "days_since_last_post": int | None,
          "most_recent_posted_at": iso_str | None,
          "threshold_days": int,
        }

    Called by Phase G's drafter before firing an opener on any match
    with final_score >= 0.85. If ``is_stale`` is true, the drafter
    should first fire a story (via ``post_library_item_now``) and wait
    ~10 min before sending the opener, so the match's IG grid looks
    alive when she clicks through.
    """
    from clapcheeks.ai.persona_loader import load_persona

    if max_staleness_days is None:
        try:
            persona = load_persona(user_id)
            cl = (persona or {}).get("content_library") or {}
            fr = cl.get("freshness_rule") or {}
            max_staleness_days = int(
                fr.get("max_staleness_days_before_opening_high_score_match")
                or fr.get("max_staleness_days")
                or DEFAULT_FRESHNESS_DAYS
            )
        except Exception:
            max_staleness_days = DEFAULT_FRESHNESS_DAYS

    now = now or datetime.now(timezone.utc)

    from clapcheeks.job_queue import _client as _svc_client
    c = client or _svc_client()

    try:
        resp = (
            c.table("clapcheeks_content_library")
            .select("posted_at")
            .eq("user_id", user_id)
            .eq("post_type", "story")
            .order("posted_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        log.warning("check_ig_freshness query failed: %s", exc)
        return {
            "is_stale": True,
            "days_since_last_post": None,
            "most_recent_posted_at": None,
            "threshold_days": max_staleness_days,
        }

    data = getattr(resp, "data", None) or []
    most_recent = None
    for row in data:
        v = row.get("posted_at")
        if v:
            most_recent = v
            break

    if not most_recent:
        return {
            "is_stale": True,
            "days_since_last_post": None,
            "most_recent_posted_at": None,
            "threshold_days": max_staleness_days,
        }

    try:
        if isinstance(most_recent, datetime):
            dt = most_recent
        else:
            dt = datetime.fromisoformat(str(most_recent).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return {
            "is_stale": True,
            "days_since_last_post": None,
            "most_recent_posted_at": most_recent,
            "threshold_days": max_staleness_days,
        }

    delta = now - dt
    days = delta.total_seconds() / 86400.0
    return {
        "is_stale": days > max_staleness_days,
        "days_since_last_post": round(days, 2),
        "most_recent_posted_at": most_recent,
        "threshold_days": max_staleness_days,
    }


# ---------------------------------------------------------------------------
# Immediate post (used by Phase G freshness gate and dashboard "Post now")
# ---------------------------------------------------------------------------


def _signed_storage_url(
    media_path: str,
    client: Any,
    bucket: str = "julian-content",
    expires_in_seconds: int = 3600,
) -> str | None:
    """Ask Supabase Storage for a signed URL the extension can fetch.

    Returns None if the bucket/object doesn't exist. The function does
    not raise - publisher logs and retries on the next tick.
    """
    try:
        signed = client.storage.from_(bucket).create_signed_url(
            media_path, expires_in_seconds,
        )
        # supabase-py returns {"signedURL": "..."} or {"signed_url": "..."}
        if isinstance(signed, dict):
            return (
                signed.get("signedURL")
                or signed.get("signed_url")
                or signed.get("url")
            )
        if isinstance(signed, str):
            return signed
    except Exception as exc:
        log.warning("signed url failed for %s: %s", media_path, exc)
    return None


def _load_ig_session(user_id: str, client: Any) -> dict[str, Any] | None:
    """Pull the IG session cookie blob from clapcheeks_user_settings.

    AI-8766: prefers ``instagram_auth_token_enc``. Falls back to deprecated
    plaintext ``instagram_auth_token`` with a warning.
    """
    try:
        resp = (
            client.table("clapcheeks_user_settings")
            .select("instagram_auth_token,instagram_auth_token_enc")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        log.warning("ig session fetch failed: %s", exc)
        return None
    data = getattr(resp, "data", None) or []
    if not data:
        return None
    row = data[0]

    enc = row.get("instagram_auth_token_enc")
    tok: Any = None
    if enc:
        try:
            from clapcheeks.auth.token_vault import decrypt_token_supabase
            tok = decrypt_token_supabase(enc, user_id)
        except Exception as exc:  # noqa: BLE001
            log.error("ig token_vault decrypt failed for %s: %s", user_id, exc)
            tok = None

    if not tok:
        plain = row.get("instagram_auth_token")
        if plain:
            log.warning(
                "DEPRECATED plaintext instagram_auth_token used for user %s — backfill needed",
                user_id,
            )
            tok = plain

    if not tok:
        return None
    if isinstance(tok, str):
        try:
            import json
            return json.loads(tok)
        except Exception:
            return None
    if isinstance(tok, dict):
        return tok
    return None


def post_library_item_now(
    user_id: str,
    content_library_id: str,
    client: Any = None,
    signed_url: str | None = None,
) -> dict[str, Any]:
    """Fire a single library item immediately as an IG story.

    Returns::

        {
          "ok": bool,
          "job_id": "uuid" | None,
          "reason": "enqueued" | "no_session" | "missing_row" | ...,
        }

    Used by:
    * Phase G freshness gate (before high-score opener)
    * Dashboard "Post now" button
    """
    from clapcheeks.job_queue import (
        _client as _svc_client,
        enqueue_job,
        alert_julian_extension_offline,
    )

    c = client or _svc_client()

    # Load the library row so we can find media_path + caption.
    try:
        resp = (
            c.table("clapcheeks_content_library")
            .select("id, media_path, caption, category, post_type, user_id")
            .eq("id", content_library_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        log.warning("library fetch failed for %s: %s", content_library_id, exc)
        return {"ok": False, "job_id": None, "reason": f"db_error:{exc}"}

    rows = getattr(resp, "data", None) or []
    if not rows:
        return {"ok": False, "job_id": None, "reason": "missing_row"}
    row = rows[0]

    # IG session cookie check.
    session = _load_ig_session(user_id, c)
    if not session or not session.get("sessionid"):
        log.warning("IG session missing/expired for user %s", user_id)
        alert_julian_extension_offline(
            message=(
                "Clapcheeks: IG session needs refresh. Open instagram.com "
                "in Chrome so the harvester can grab fresh cookies."
            ),
        )
        return {"ok": False, "job_id": None, "reason": "no_session"}

    # Resolve media URL (signed URL can be injected for tests).
    if signed_url is None:
        signed_url = _signed_storage_url(row["media_path"], c)
    if not signed_url:
        return {"ok": False, "job_id": None, "reason": "signed_url_failed"}

    # Enqueue the Phase M job. The extension will download the image
    # from signed_url and POST to IG_STORY_UPLOAD_URL with cookies.
    body = {
        "image_url": signed_url,
        "caption": row.get("caption") or "",
        "post_type": row.get("post_type") or "story",
    }
    job_id = enqueue_job(
        user_id=user_id,
        job_type="ig_post_story",
        platform="instagram",
        url=IG_STORY_UPLOAD_URL,
        method="POST",
        headers={"Content-Type": "application/json"},
        body=body,
        priority=3,  # higher than the default 5 - stories are time-sensitive
        client=c,
    )
    if not job_id:
        return {"ok": False, "job_id": None, "reason": "enqueue_failed"}

    log.info(
        "post_library_item_now: enqueued ig_post_story job=%s for item=%s",
        job_id, content_library_id,
    )
    return {"ok": True, "job_id": job_id, "reason": "enqueued"}


# ---------------------------------------------------------------------------
# Queue drain (called by the scheduler worker every minute)
# ---------------------------------------------------------------------------


def drain_due(
    now: datetime | None = None,
    limit: int = 5,
    client: Any = None,
) -> dict[str, int]:
    """Drain due ``clapcheeks_posting_queue`` rows.

    For each pending row where ``scheduled_for <= now``:

    * Call ``post_library_item_now`` -> enqueues an agent_job
    * Flip the queue row to ``in_progress`` + stamp agent_job_id

    Then reconcile ``in_progress`` rows by reading the agent_job status:

    * ``completed`` -> queue row becomes ``posted`` and library row gets
      ``posted_at``.
    * ``failed`` / ``stale_no_extension`` -> queue row becomes ``failed``
      with the error attached. Next scheduler tick can re-queue.
    """
    from clapcheeks.job_queue import _client as _svc_client

    now = now or datetime.now(timezone.utc)
    c = client or _svc_client()

    stats = {"enqueued": 0, "posted": 0, "failed": 0, "skipped": 0}

    # Step 1: fire due pending rows.
    try:
        resp = (
            c.table("clapcheeks_posting_queue")
            .select("id, user_id, content_library_id, scheduled_for, status")
            .eq("status", "pending")
            .lte("scheduled_for", now.isoformat())
            .order("scheduled_for", desc=False)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        log.warning("drain_due fetch pending failed: %s", exc)
        return stats

    for row in getattr(resp, "data", None) or []:
        out = post_library_item_now(
            user_id=row["user_id"],
            content_library_id=row["content_library_id"],
            client=c,
        )
        if out["ok"]:
            try:
                c.table("clapcheeks_posting_queue").update({
                    "status": "in_progress",
                    "agent_job_id": out["job_id"],
                }).eq("id", row["id"]).execute()
                stats["enqueued"] += 1
            except Exception as exc:
                log.warning("queue in_progress update failed: %s", exc)
                stats["skipped"] += 1
        else:
            # Mark failed if it's a terminal condition (no session, missing
            # row). Leave pending otherwise so we retry.
            if out["reason"] in ("missing_row", "signed_url_failed"):
                try:
                    c.table("clapcheeks_posting_queue").update({
                        "status": "failed",
                        "error": out["reason"],
                    }).eq("id", row["id"]).execute()
                    stats["failed"] += 1
                except Exception:
                    pass
            else:
                stats["skipped"] += 1

    # Step 2: reconcile in_progress rows against agent_jobs.
    try:
        resp = (
            c.table("clapcheeks_posting_queue")
            .select("id, user_id, content_library_id, agent_job_id")
            .eq("status", "in_progress")
            .limit(20)
            .execute()
        )
    except Exception as exc:
        log.warning("drain_due fetch in_progress failed: %s", exc)
        return stats

    for row in getattr(resp, "data", None) or []:
        job_id = row.get("agent_job_id")
        if not job_id:
            continue
        try:
            job_resp = (
                c.table("clapcheeks_agent_jobs")
                .select("status, result_jsonb, error")
                .eq("id", job_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            log.debug("reconcile job fetch failed: %s", exc)
            continue

        job_rows = getattr(job_resp, "data", None) or []
        if not job_rows:
            continue

        jr = job_rows[0]
        jstatus = jr.get("status")
        if jstatus == "completed":
            result = jr.get("result_jsonb") or {}
            status_code = result.get("status_code", 0)
            post_id = None
            try:
                body = result.get("body") or {}
                post_id = (body.get("media") or {}).get("id") or body.get("id")
            except Exception:
                post_id = None

            if 200 <= int(status_code or 0) < 300:
                now_iso = datetime.now(timezone.utc).isoformat()
                try:
                    c.table("clapcheeks_content_library").update({
                        "posted_at": now_iso,
                        "platform_post_id": post_id,
                    }).eq("id", row["content_library_id"]).execute()
                    c.table("clapcheeks_posting_queue").update({
                        "status": "posted",
                        "posted_at": now_iso,
                    }).eq("id", row["id"]).execute()
                    stats["posted"] += 1
                except Exception as exc:
                    log.warning("reconcile completed update failed: %s", exc)
            else:
                try:
                    c.table("clapcheeks_posting_queue").update({
                        "status": "failed",
                        "error": f"ig_http_{status_code}",
                    }).eq("id", row["id"]).execute()
                    stats["failed"] += 1
                except Exception:
                    pass

        elif jstatus in ("failed", "stale_no_extension"):
            try:
                c.table("clapcheeks_posting_queue").update({
                    "status": "failed",
                    "error": jr.get("error") or jstatus,
                }).eq("id", row["id"]).execute()
                stats["failed"] += 1
            except Exception:
                pass

    return stats


# ---------------------------------------------------------------------------
# AI-8808 — Instagram DM reaction stub
# ---------------------------------------------------------------------------

def send_dm_like(thread_id: str, item_id: str, ig_session: dict | None = None) -> None:
    """Like a specific Instagram DM message (heart reaction).

    The Instagram private API endpoint for DM item likes is::

        POST /api/v1/direct_v2/threads/{thread_id}/items/{item_id}/like/

    This endpoint is part of Instagram's private ``i.instagram.com`` API
    surface, accessible from a browser session with ``credentials: 'include'``.
    It requires the ``X-CSRFToken`` header and ``ig_did`` cookie.

    .. note::
        **Not implemented (AI-8808-followup).**

        Instagram aggressively rate-limits and blocks automation on the DM
        API. The extension architecture (browser session) is the correct path
        for this call — the VPS cannot make authenticated IG API calls without
        routing through the Chrome extension. The endpoint is documented here
        as the verified correct path.

        Implementation approach for the follow-up:
        1. Enqueue an ``ig_dm_like`` agent_job (same pattern as ig_post_story).
        2. Chrome extension drains the job and calls::

               fetch(`https://i.instagram.com/api/v1/direct_v2/threads/${threadId}/items/${itemId}/like/`, {
                   method: "POST",
                   credentials: "include",
                   headers: { "X-CSRFToken": getCsrfToken() },
               })

        3. Extension POSTs the result back to ``/api/ingest/api-result``.

    :param thread_id: Instagram DM thread ID.
    :param item_id: Instagram DM item (message) ID to like.
    :param ig_session: Optional session dict (unused in stub).
    :raises NotImplementedError: always.
    """
    raise NotImplementedError(
        "Instagram DM message likes require the Chrome extension (AI-8808-followup). "
        f"Endpoint: POST /api/v1/direct_v2/threads/{thread_id}/items/{item_id}/like/ "
        "Route via ig_dm_like agent_job — not yet implemented."
    )
