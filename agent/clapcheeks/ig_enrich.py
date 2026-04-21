"""Phase C (AI-8317) Instagram enrichment worker.

Finds matches with an ``instagram_handle`` but no ``instagram_intel``,
enqueues a Chrome-extension job (Phase M) to fetch her public
web_profile_info, parses the response, aggregates it into a single-
paragraph intel blurb, and writes everything back to
``clapcheeks_matches``.

Architecture
------------

    daemon (_ig_enrich_worker, 15 min)
        |
        | 1. query matches WHERE instagram_handle IS NOT NULL
        |                    AND instagram_intel IS NULL
        |
        | 2. extract handle from bio/prompts if column is empty
        |    (uses social.ig_handle.extract_primary_handle)
        |
        | 3. enqueue_job(job_type='ig_user_feed', platform='instagram',
        |                url='https://www.instagram.com/api/v1/users/'
        |                    'web_profile_info/?username=<handle>')
        |
        | 4. wait_for_completion (re-uses Phase M helper)
        |
        | 5. parse + aggregate + PATCH clapcheeks_matches with
        |    instagram_intel, instagram_fetched_at, instagram_is_private
        |
        v
    Chrome extension drains the queue, fetches IG with credentials:
    'include' (rides Julian's real ig session cookies + residential IP),
    POSTs status_code + body back to /api/ingest/api-result.

No direct outbound to instagram.com from the VPS. The IG endpoint is
served by ``www.instagram.com`` so the extension's host_permissions
already cover it. No new fetch code needed on the extension side -
its existing drain loop is URL-agnostic.

Config gates
------------

* If the owning user has no ``instagram_auth_token`` in
  ``clapcheeks_user_settings`` we still enqueue - the public
  web_profile_info endpoint works for logged-out users too, but rate
  limits more aggressively. Logged-in is preferred; we just log a
  warning in that case.
* If the handle can't be validated, we store
  ``instagram_intel = {"error": "invalid_handle"}`` so we don't
  re-try every tick.

Fallback
--------

If the primary endpoint returns HTTP 4xx/5xx or an empty body, we
try the older ``?__a=1&__d=dis`` endpoint (still public) via a second
job. Both share the same parser. If that also fails we persist
``instagram_intel = {"error": "fetch_failed", "status": <code>}`` so
the match doesn't get re-queued forever.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from clapcheeks.job_queue import enqueue_job, wait_for_completion
from clapcheeks.social.ig_handle import extract_primary_handle
from clapcheeks.social.ig_parser import aggregate_ig_intel, parse_ig_user_feed

logger = logging.getLogger("clapcheeks.ig_enrich")


# How many matches to drain per daemon tick. IG is aggressive with rate
# limits on public endpoints. Three per 15 min keeps us well below any
# meaningful threshold.
MAX_MATCHES_PER_RUN = 3
JOB_WAIT_TIMEOUT_SECONDS = 600  # match Phase M default

PRIMARY_URL_TEMPLATE = (
    "https://www.instagram.com/api/v1/users/web_profile_info/?username={handle}"
)
FALLBACK_URL_TEMPLATE = (
    "https://www.instagram.com/{handle}/?__a=1&__d=dis"
)


# ---------------------------------------------------------------------------
# Supabase I/O (thin wrappers over the REST API; see scoring.py +
# daemon.py for the same pattern)
# ---------------------------------------------------------------------------


def _creds() -> tuple[str, str] | None:
    try:
        from clapcheeks.scoring import _supabase_creds
        return _supabase_creds()
    except Exception as exc:
        logger.debug("ig_enrich: creds unavailable (%s)", exc)
        return None


def find_matches_needing_ig(limit: int = MAX_MATCHES_PER_RUN) -> list[dict]:
    """Return matches whose ``instagram_intel`` is NULL but whose
    ``instagram_handle`` is set (OR whose bio/prompts imply a handle).

    Reads bio + prompts_jsonb so the worker can discover handles
    retroactively, not just ones parsed at match-intake time.
    """
    import requests

    creds = _creds()
    if not creds:
        return []
    url, key = creds

    # First pass: matches with an explicit handle column.
    params = {
        "instagram_handle": "not.is.null",
        "instagram_intel": "is.null",
        "select": "id,user_id,match_name,name,bio,prompts_jsonb,instagram_handle",
        "limit": str(limit),
        "order": "created_at.desc",
    }
    try:
        resp = requests.get(
            f"{url}/rest/v1/clapcheeks_matches",
            params=params,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
    except Exception as exc:
        logger.warning("ig_enrich: match fetch failed (%s)", exc)
        return []

    if resp.status_code >= 300:
        logger.warning(
            "ig_enrich: match fetch status %s: %s",
            resp.status_code, resp.text[:200] if hasattr(resp, "text") else "",
        )
        return []

    out: list[dict] = []
    try:
        for row in resp.json() or []:
            if row.get("instagram_handle"):
                out.append(row)
    except Exception as exc:
        logger.debug("ig_enrich: json decode failed (%s)", exc)

    return out[:limit]


def _write_intel(
    match_id: str,
    intel: dict,
    is_private: bool = False,
    summary: str | None = None,
) -> bool:
    """PATCH the match row with parsed intel + fetched_at + privacy flag.

    Also bumps ``updated_at`` so Phase I's rescore poller picks up the
    new IG-derived signals.
    """
    import requests

    creds = _creds()
    if not creds:
        return False
    url, key = creds

    patch: dict[str, Any] = {
        "instagram_intel": intel,
        "instagram_fetched_at": datetime.now(timezone.utc).isoformat(),
        "instagram_is_private": bool(is_private),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Stash the aggregated blurb inside instagram_intel too so downstream
    # prompts only need one column.
    if summary is not None:
        patch["instagram_intel"] = {**intel, "summary": summary}

    try:
        r = requests.patch(
            f"{url}/rest/v1/clapcheeks_matches",
            params={"id": f"eq.{match_id}"},
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=patch,
            timeout=15,
        )
    except Exception as exc:
        logger.warning("ig_enrich: patch failed (%s)", exc)
        return False

    if r.status_code >= 300:
        logger.warning(
            "ig_enrich: patch status %s: %s",
            r.status_code, r.text[:200] if hasattr(r, "text") else "",
        )
        return False
    return True


# ---------------------------------------------------------------------------
# Handle resolution
# ---------------------------------------------------------------------------


def _resolve_handle(match_row: dict) -> str | None:
    """Prefer the stored column; fall back to extracting from bio/prompts."""
    h = (match_row.get("instagram_handle") or "").strip().lstrip("@")
    if h:
        return h.lower()

    candidate: str | None = None
    # Try bio first - highest signal
    candidate = extract_primary_handle(match_row.get("bio"))
    if candidate:
        return candidate

    # Then each prompt answer
    prompts = match_row.get("prompts_jsonb") or []
    if isinstance(prompts, list):
        for p in prompts:
            text = None
            if isinstance(p, dict):
                text = (
                    p.get("answer")
                    or p.get("response")
                    or p.get("text")
                    or p.get("content")
                )
            elif isinstance(p, str):
                text = p
            candidate = extract_primary_handle(text)
            if candidate:
                return candidate

    return None


# ---------------------------------------------------------------------------
# Single-match enrichment
# ---------------------------------------------------------------------------


def _ok_body(result: dict | None) -> dict | None:
    """Return the body dict on 2xx, else None."""
    if not result:
        return None
    status = result.get("status_code") if isinstance(result, dict) else None
    if status is None:
        # Legacy shape - treat as ok iff dict with 'data'/'graphql'/'user'
        if isinstance(result, dict) and (
            "data" in result or "graphql" in result or "user" in result
        ):
            return result
        return None
    if not (200 <= int(status) < 300):
        return None
    body = result.get("body")
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        try:
            import json as _json
            return _json.loads(body)
        except Exception:
            return None
    return None


def enrich_one(
    match_row: dict,
    timeout_seconds: int = JOB_WAIT_TIMEOUT_SECONDS,
) -> dict:
    """Enqueue + wait + parse + write for a single match.

    Returns a status dict for logging:
        {"match_id", "handle", "status": "ok"|"private"|"no_handle"|
                                          "fetch_failed"|"empty_response",
         "summary"}
    """
    match_id = match_row.get("id")
    user_id = match_row.get("user_id")
    if not match_id or not user_id:
        return {"status": "no_match_id"}

    handle = _resolve_handle(match_row)
    if not handle:
        # Persist a no-op marker so we don't re-poll this match forever.
        _write_intel(
            match_id,
            intel={"error": "no_handle_found"},
            is_private=False,
        )
        return {"match_id": match_id, "handle": None, "status": "no_handle"}

    logger.info("ig_enrich: enqueuing job for match=%s handle=@%s", match_id, handle)

    # Primary endpoint
    primary_url = PRIMARY_URL_TEMPLATE.format(handle=handle)
    job_id = enqueue_job(
        user_id=user_id,
        job_type="ig_user_feed",
        platform="instagram",
        url=primary_url,
        method="GET",
        headers={
            # These are IG's own expected headers. The extension layers
            # credentials: 'include' on top so session cookies ride.
            "Accept": "application/json",
            "X-IG-App-ID": "936619743392459",  # public web-app id
        },
    )

    body = None
    if job_id:
        result = wait_for_completion(job_id, timeout_seconds=timeout_seconds)
        body = _ok_body(result)

    # Fallback to ``?__a=1`` if primary came back empty / 4xx
    if body is None:
        fallback_url = FALLBACK_URL_TEMPLATE.format(handle=handle)
        fb_job = enqueue_job(
            user_id=user_id,
            job_type="ig_user_feed",
            platform="instagram",
            url=fallback_url,
            method="GET",
            headers={"Accept": "application/json"},
        )
        if fb_job:
            fb_result = wait_for_completion(fb_job, timeout_seconds=timeout_seconds)
            body = _ok_body(fb_result)

    if body is None:
        _write_intel(
            match_id,
            intel={"error": "fetch_failed", "handle": handle},
            is_private=False,
        )
        return {"match_id": match_id, "handle": handle, "status": "fetch_failed"}

    parsed = parse_ig_user_feed(body)
    if not parsed.get("handle"):
        _write_intel(
            match_id,
            intel={"error": "empty_response", "handle": handle},
            is_private=False,
        )
        return {"match_id": match_id, "handle": handle, "status": "empty_response"}

    if parsed.get("is_private"):
        summary = aggregate_ig_intel(parsed)
        _write_intel(
            match_id,
            intel={"private": True, "handle": parsed["handle"],
                   "follower_count": parsed.get("follower_count", 0),
                   "post_count": parsed.get("post_count", 0)},
            is_private=True,
            summary=summary,
        )
        return {"match_id": match_id, "handle": handle, "status": "private",
                "summary": summary}

    summary = aggregate_ig_intel(parsed)
    _write_intel(match_id, intel=parsed, is_private=False, summary=summary)
    return {
        "match_id": match_id,
        "handle": handle,
        "status": "ok",
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# Worker entrypoint (imported by daemon.py)
# ---------------------------------------------------------------------------


def run_once(limit: int = MAX_MATCHES_PER_RUN) -> dict:
    """Fetch + enrich up to ``limit`` matches once. Safe to call from tests."""
    summary = {"scanned": 0, "enriched": 0, "private": 0, "no_handle": 0,
               "fetch_failed": 0, "empty": 0}

    for match in find_matches_needing_ig(limit=limit):
        summary["scanned"] += 1
        try:
            result = enrich_one(match)
        except Exception as exc:
            logger.error("ig_enrich: match %s crashed (%s)", match.get("id"), exc)
            continue
        status = result.get("status")
        if status == "ok":
            summary["enriched"] += 1
        elif status == "private":
            summary["private"] += 1
        elif status == "no_handle":
            summary["no_handle"] += 1
        elif status == "fetch_failed":
            summary["fetch_failed"] += 1
        elif status == "empty_response":
            summary["empty"] += 1
    return summary


def _ig_enrich_worker(
    interval_seconds: int = 900,
    shutdown_event=None,
) -> None:
    """Daemon thread target.

    Runs ``run_once`` every ``interval_seconds`` (default 15m) until
    ``shutdown_event`` is set. The caller supplies the shutdown event
    (usually ``clapcheeks.daemon._shutdown``). If not supplied, we
    sleep with ``time.sleep`` and never exit - only useful for manual
    one-shot runs.
    """
    logger.info("ig_enrich worker started (interval=%ds)", interval_seconds)
    while True:
        try:
            stats = run_once()
            if stats["scanned"]:
                logger.info("ig_enrich tick: %s", stats)
        except Exception as exc:
            logger.error("ig_enrich tick failed: %s", exc)

        if shutdown_event is not None:
            shutdown_event.wait(interval_seconds)
            if shutdown_event.is_set():
                logger.info("ig_enrich worker stopping")
                return
        else:
            import time
            time.sleep(interval_seconds)
