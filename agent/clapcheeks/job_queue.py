"""Phase M (AI-8345) - Chrome-extension API job queue.

The daemon never hits tinder.com / hinge.co / instagram.com directly
from the VPS anymore (that is what tripped Tinder's selfie verification
on 2026-04-20, see Phase A / AI-8315). Instead it:

    1. enqueue_job(...) inserts a row into clapcheeks_agent_jobs
       describing the HTTP request it wants done.
    2. The Chrome extension's service worker polls the queue every
       ~10s, claims the row, runs `fetch(url, {credentials: 'include'})`
       inside the user's real browser session, and POSTs the response
       back to /api/ingest/api-result.
    3. wait_for_completion(job_id, timeout_seconds) polls the row until
       status=completed / failed / stale_no_extension and returns the
       parsed result_jsonb (or None).

If no extension drains a job within ``stale_after_minutes`` minutes,
mark_stale_no_extension() flips the row to status=stale_no_extension.
The daemon caller then decides whether to alert Julian (usually via
``god mac send "+16195090699" "open Chrome so matches can sync"``).

Design rules
------------
* One job = one HTTP request. Never bundle.
* The helper never falls back to calling the platform API directly.
  That fallback is what Phase M exists to kill.
* Service-role Supabase client bypasses RLS; all inserts stamp
  ``user_id`` so per-user policies still apply on the extension side.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

from clapcheeks.sync import _load_supabase_env

logger = logging.getLogger("clapcheeks.job_queue")


# Terminal statuses: ``wait_for_completion`` stops polling when the row
# reaches any of these.
TERMINAL_STATUSES = frozenset({"completed", "failed", "stale_no_extension"})


def _client():
    """Return a service-role Supabase client.

    Kept as a function (not a module-level singleton) so tests can
    monkey-patch ``supabase.create_client``.

    AI-8767 NOTE: This function legitimately uses service-role because
    ``clapcheeks_agent_jobs`` is a multi-user cross-user table (the Chrome
    extension polls and claims jobs across all users).  This code only runs
    on the VPS daemon, NOT on operator Macs.  CLAPCHEEKS_ALLOW_SERVICE_ROLE
    must be set in the VPS environment.  # NOQA: service-role-ok
    """
    from supabase import create_client  # NOQA: service-role-ok

    url, key = _load_supabase_env()
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL or SUPABASE_SERVICE_KEY not set. "
            "job_queue requires VPS service-role credentials — "
            "this module must not run on operator Macs (AI-8767)."
        )
    return create_client(url, key)


# ---------------------------------------------------------------------------
# Enqueue
# ---------------------------------------------------------------------------


def enqueue_job(
    user_id: str,
    job_type: str,
    platform: str,
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: Any = None,
    priority: int = 5,
    client: Any = None,
) -> str | None:
    """Insert a pending job and return its id.

    Returns ``None`` if the insert failed (logged as a warning, never
    raises so the daemon's sync loop can keep trucking).
    """
    if not user_id or not job_type or not platform or not url:
        raise ValueError("user_id, job_type, platform, url are all required")

    params: dict[str, Any] = {
        "url": url,
        "method": (method or "GET").upper(),
        "headers": headers or {},
        "body": body,
    }

    row = {
        "user_id": user_id,
        "job_type": job_type,
        "platform": platform,
        "job_params": params,
        "status": "pending",
        "priority": int(priority),
    }

    c = client or _client()
    try:
        resp = c.table("clapcheeks_agent_jobs").insert(row).execute()
    except Exception as exc:
        logger.warning("enqueue_job failed for %s/%s: %s", platform, job_type, exc)
        return None

    data = getattr(resp, "data", None) or []
    if not data:
        logger.warning("enqueue_job returned no row for %s/%s", platform, job_type)
        return None

    job_id = data[0].get("id")
    logger.info(
        "enqueued %s/%s job %s (user=%s, url=%s)",
        platform,
        job_type,
        job_id,
        user_id,
        url,
    )
    return job_id


# ---------------------------------------------------------------------------
# Wait
# ---------------------------------------------------------------------------


def wait_for_completion(
    job_id: str,
    timeout_seconds: int = 600,
    poll_interval_seconds: float = 2.0,
    client: Any = None,
) -> dict | None:
    """Poll ``clapcheeks_agent_jobs`` until the row hits a terminal status.

    Returns the parsed ``result_jsonb`` dict on ``completed``; ``None``
    on any failure / timeout / stale_no_extension. Never raises for
    timeout - the caller uses the None return to decide what to do
    next (usually: alert Julian so he opens Chrome).
    """
    if not job_id:
        return None

    c = client or _client()
    deadline = time.monotonic() + max(1, timeout_seconds)

    while time.monotonic() < deadline:
        try:
            resp = c.table("clapcheeks_agent_jobs") \
                .select("status, result_jsonb, error") \
                .eq("id", job_id) \
                .limit(1) \
                .execute()
        except Exception as exc:
            logger.debug("wait_for_completion poll failed: %s", exc)
            time.sleep(poll_interval_seconds)
            continue

        data = getattr(resp, "data", None) or []
        if not data:
            # Row might still be mid-insert; keep polling.
            time.sleep(poll_interval_seconds)
            continue

        row = data[0]
        status = row.get("status")
        if status == "completed":
            return row.get("result_jsonb") or {}
        if status in ("failed", "stale_no_extension"):
            logger.info(
                "job %s ended in %s: %s",
                job_id,
                status,
                row.get("error"),
            )
            return None

        time.sleep(poll_interval_seconds)

    # Fell off the timeout edge. Leave the row where it is - the daemon
    # sweep (mark_stale_no_extension) will flip it if it's truly orphaned.
    logger.info("wait_for_completion timeout after %ds for job %s", timeout_seconds, job_id)
    return None


# ---------------------------------------------------------------------------
# Stale sweep
# ---------------------------------------------------------------------------


def mark_stale_no_extension(
    stale_after_minutes: int = 10,
    client: Any = None,
) -> int:
    """Flip any pending/claimed jobs older than the cutoff to
    ``stale_no_extension``. Returns the number of rows updated.

    Called by the daemon every match-sync tick. If this returns >0 the
    daemon should fire an iMessage to Julian ("open Chrome so matches
    can sync") because the extension isn't draining work.
    """
    from datetime import datetime, timedelta, timezone

    c = client or _client()
    cutoff_iso = (
        datetime.now(timezone.utc) - timedelta(minutes=max(1, stale_after_minutes))
    ).isoformat()

    try:
        resp = (
            c.table("clapcheeks_agent_jobs")
            .update({
                "status": "stale_no_extension",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error": f"no_extension_claim_within_{stale_after_minutes}m",
            })
            .in_("status", ["pending", "claimed"])
            .lt("created_at", cutoff_iso)
            .execute()
        )
    except Exception as exc:
        logger.warning("mark_stale_no_extension failed: %s", exc)
        return 0

    data = getattr(resp, "data", None) or []
    count = len(data)
    if count:
        logger.warning(
            "Marked %d agent job(s) stale_no_extension (older than %dm) - "
            "is Chrome open on Julian's MBP?",
            count,
            stale_after_minutes,
        )
    return count


# ---------------------------------------------------------------------------
# iMessage alert helper
# ---------------------------------------------------------------------------


def alert_julian_extension_offline(
    message: str | None = None,
    phone: str | None = None,
) -> bool:
    """Fire ``god mac send`` telling Julian to open Chrome.

    Safe to call from a worker loop. Returns True if the CLI returned 0.
    Rate-limiting + dedup should be handled by the caller - this helper
    just shells out. Never raises.
    """
    import subprocess

    target = phone or os.environ.get("CLAPCHEEKS_OWNER_PHONE") or "+16195090699"
    text = message or (
        "Clapcheeks: open Chrome on your MBP so the extension can drain "
        "dating-app match syncs. No extension has claimed jobs in the "
        "last 10 minutes."
    )
    try:
        r = subprocess.run(
            ["god", "mac", "send", target, text],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if r.returncode == 0:
            logger.info("Sent extension-offline iMessage to %s", target)
            return True
        logger.warning("god mac send failed: %s %s", r.stdout, r.stderr)
    except Exception as exc:
        logger.warning("god mac send crashed: %s", exc)
    return False
