"""Phase A match intake loop (AI-8315) - refactored for Phase M (AI-8345).

The daemon no longer calls tinder.com / hinge.co / instagram.com APIs
directly from the VPS. On 2026-04-20 a 10-min cadence of /v2/matches +
/user/{id} calls from a VPS IP with a spoofed iOS User-Agent tripped
Tinder's anti-bot and forced Julian into selfie verification.

Phase M's architecture:

    daemon                 supabase              chrome extension
    ------                 --------              ----------------
    enqueue_job ---insert-> clapcheeks_agent_jobs <--poll (10s)--
                                                  |
                                                  v
                                                fetch(... , credentials: 'include')
                                                  | (Julian's real session + IP)
                                                  v
                                                Tinder / Hinge / Instagram
                                                  |
                          /api/ingest/api-result <-+
                                   |
                                   v
                          update row, status=completed
    wait_for_completion <-poll- row.result_jsonb

The daemon stays fail-safe: if no extension drains jobs inside the
timeout, we mark them ``stale_no_extension`` and fire an iMessage to
Julian ("open Chrome"). We do NOT fall back to direct API calls - that
fallback is what Phase M exists to kill.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import requests

from clapcheeks import match_intel
from clapcheeks.job_queue import (
    alert_julian_extension_offline,
    enqueue_job,
    mark_stale_no_extension,
    wait_for_completion,
)
from clapcheeks.sync import _load_supabase_env

logger = logging.getLogger("clapcheeks.match_sync")

PHOTO_BUCKET = "match-photos"
HTTP_TIMEOUT = 20
MAX_PHOTOS_PER_MATCH = 8

# Job-queue timeouts. The Chrome extension polls every 10s and rate-limits
# itself so even a handful of jobs should drain in under 2 minutes. 10
# minutes is our "extension is offline" threshold (matches the daemon's
# stale sweep cutoff).
JOB_WAIT_TIMEOUT_SECONDS = 600
STALE_AFTER_MINUTES = 10

# Phase-M TIGHTENED cap: one profile hydration per run. The extension
# imposes its own jitter + 1-request-per-3s Tinder rate limit, and we
# only need a few profile hydrations per sync tick. Keeping this low is
# cheap insurance against a future queue-buildup looking automated.
MAX_PROFILES_PER_RUN = 3

# Platform API bases - kept here (not imported from the platform
# clients) because the daemon no longer instantiates those clients.
TINDER_API_BASE = "https://api.gotinder.com"
HINGE_API_BASE = "https://prod-api.hingeaws.net"


# ---------------------------------------------------------------------------
# Storage helpers (unchanged from Phase A - photos still travel VPS-side
# because the CDN they live on does NOT require auth cookies and is not
# the anti-bot surface).
# ---------------------------------------------------------------------------


def ensure_bucket(supabase_client) -> None:
    """Create the match-photos bucket if it doesn't exist. Idempotent."""
    try:
        buckets = supabase_client.storage.list_buckets()
        names = {b.name if hasattr(b, "name") else b.get("name") for b in buckets}
        if PHOTO_BUCKET not in names:
            supabase_client.storage.create_bucket(PHOTO_BUCKET, options={"public": False})
            logger.info("Created Supabase bucket %s", PHOTO_BUCKET)
    except Exception as exc:
        logger.debug("ensure_bucket: %s", exc)


def _download_photo(url: str) -> bytes | None:
    try:
        r = requests.get(url, timeout=HTTP_TIMEOUT)
    except requests.RequestException as exc:
        logger.info("Photo download failed (%s): %s", url[:60], exc)
        return None
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        logger.info("Photo %s -> HTTP %d", url[:60], r.status_code)
        return None
    return r.content


def _upload_photo(
    supabase_client,
    user_id: str,
    match_id: str,
    idx: int,
    content: bytes,
) -> str | None:
    path = f"{user_id}/{match_id}/{idx}.jpg"
    try:
        supabase_client.storage.from_(PHOTO_BUCKET).upload(
            path=path,
            file=content,
            file_options={
                "content-type": "image/jpeg",
                "upsert": "true",
            },
        )
        return path
    except Exception as exc:
        logger.info("Photo upload %s failed: %s", path, exc)
        return None


# ---------------------------------------------------------------------------
# Event logging
# ---------------------------------------------------------------------------


def _log_agent_event(
    supabase_client,
    user_id: str,
    event_type: str,
    data: dict | None = None,
) -> None:
    try:
        supabase_client.table("clapcheeks_agent_events").insert({
            "user_id": user_id,
            "event_type": event_type,
            "data": data or {},
        }).execute()
    except Exception as exc:
        logger.debug("agent_event insert failed: %s", exc)


# ---------------------------------------------------------------------------
# Result parsers
# ---------------------------------------------------------------------------


def _extract_body(result: dict | None) -> Any:
    """Pull the response body from a result_jsonb envelope.

    The extension always POSTs ``{status_code, body, headers}``. Older
    test doubles may pass a raw dict; tolerate either shape.
    """
    if not result:
        return None
    if isinstance(result, dict) and "body" in result:
        return result.get("body")
    return result


def _is_ok(result: dict | None) -> bool:
    if not result:
        return False
    status = result.get("status_code") if isinstance(result, dict) else None
    if status is None:
        # Legacy shape (raw body) - treat as ok iff non-empty.
        return bool(result)
    return 200 <= int(status) < 300


# ---------------------------------------------------------------------------
# Per-platform orchestration
# ---------------------------------------------------------------------------


@dataclass
class SyncResult:
    upserted: int = 0
    photos_uploaded: int = 0
    errors: list[str] = field(default_factory=list)
    auth_expired: bool = False
    extension_offline: bool = False


def _sync_tinder_for_user(
    supabase_client,
    user_id: str,
    token: str,
) -> SyncResult:
    """Enqueue list_matches + profile-hydration jobs for Tinder.

    No direct calls to api.gotinder.com here - we route everything
    through the Chrome extension.
    """
    from clapcheeks.platforms.tinder_api import TinderAPIClient

    result = SyncResult()

    # --- list_all_matches -------------------------------------------------
    list_url = f"{TINDER_API_BASE}/v2/matches?count=60&locale=en&message=0"
    job_id = enqueue_job(
        user_id=user_id,
        job_type="list_matches",
        platform="tinder",
        url=list_url,
        method="GET",
        # The extension sends credentials: 'include' so cookies ride
        # through. The X-Auth-Token header is still useful in case the
        # user's Tinder session keeps the token in localStorage rather
        # than a cookie - harmless if duplicated.
        headers={"X-Auth-Token": token} if token else {},
    )
    if not job_id:
        result.errors.append("tinder list_matches enqueue failed")
        return result

    matches_resp = wait_for_completion(job_id, timeout_seconds=JOB_WAIT_TIMEOUT_SECONDS)
    if matches_resp is None:
        result.extension_offline = True
        result.errors.append("tinder list_matches: no extension result")
        return result
    if not _is_ok(matches_resp):
        result.errors.append(
            f"tinder list_matches http {matches_resp.get('status_code') if isinstance(matches_resp, dict) else '??'}"
        )
        # 401/403 look like auth expiry. Let the caller invalidate.
        sc = matches_resp.get("status_code") if isinstance(matches_resp, dict) else None
        if sc in (401, 403):
            result.auth_expired = True
        return result

    body = _extract_body(matches_resp) or {}
    payload = (body.get("data") or {}) if isinstance(body, dict) else {}
    matches: list[dict] = payload.get("matches") or []

    # --- per-match profile hydration (capped) -----------------------------
    profiles_fetched = 0
    for m in matches:
        try:
            match_external = m.get("_id") or m.get("id")
            if not match_external:
                continue

            person_id = (m.get("person") or {}).get("_id")
            full_profile: dict | None = None

            if person_id and profiles_fetched < MAX_PROFILES_PER_RUN:
                prof_url = f"{TINDER_API_BASE}/user/{person_id}?locale=en"
                prof_job = enqueue_job(
                    user_id=user_id,
                    job_type="get_profile",
                    platform="tinder",
                    url=prof_url,
                    method="GET",
                    headers={"X-Auth-Token": token} if token else {},
                )
                if prof_job:
                    prof_resp = wait_for_completion(
                        prof_job,
                        timeout_seconds=JOB_WAIT_TIMEOUT_SECONDS,
                    )
                    if prof_resp is None:
                        result.extension_offline = True
                    elif _is_ok(prof_resp):
                        pbody = _extract_body(prof_resp) or {}
                        if isinstance(pbody, dict):
                            full_profile = (pbody.get("results") or pbody)
                        profiles_fetched += 1
                    else:
                        sc = prof_resp.get("status_code") if isinstance(prof_resp, dict) else None
                        if sc in (401, 403):
                            result.auth_expired = True

            intel = TinderAPIClient.parse_match_to_intel(m, full_profile)
            _upsert_match(
                supabase_client,
                user_id=user_id,
                platform="tinder",
                match=m,
                intel=intel,
                raw_for_intel=full_profile or (m.get("person") or m),
                result=result,
            )
        except Exception as exc:
            result.errors.append(f"tinder match loop: {exc}")
            continue

    return result


def _sync_hinge_for_user(
    supabase_client,
    user_id: str,
    token: str,
) -> SyncResult:
    """Enqueue Hinge list + profile hydration jobs."""
    from clapcheeks.platforms.hinge_api import HingeAPIClient

    result = SyncResult()

    list_url = f"{HINGE_API_BASE}/match/v1"
    job_id = enqueue_job(
        user_id=user_id,
        job_type="list_matches",
        platform="hinge",
        url=list_url,
        method="GET",
        headers={"X-Auth-Token": token} if token else {},
    )
    if not job_id:
        result.errors.append("hinge list_matches enqueue failed")
        return result

    matches_resp = wait_for_completion(job_id, timeout_seconds=JOB_WAIT_TIMEOUT_SECONDS)
    if matches_resp is None:
        result.extension_offline = True
        result.errors.append("hinge list_matches: no extension result")
        return result
    if not _is_ok(matches_resp):
        result.errors.append(
            f"hinge list_matches http {matches_resp.get('status_code') if isinstance(matches_resp, dict) else '??'}"
        )
        sc = matches_resp.get("status_code") if isinstance(matches_resp, dict) else None
        if sc in (401, 403):
            result.auth_expired = True
        return result

    body = _extract_body(matches_resp) or {}
    if isinstance(body, dict):
        matches: list[dict] = (
            body.get("matches") or body.get("data") or body.get("results") or []
        )
    elif isinstance(body, list):
        matches = body
    else:
        matches = []

    profiles_fetched = 0
    for m in matches:
        try:
            subject_id = (
                (m.get("subject") or {}).get("subjectId")
                or (m.get("subject") or {}).get("id")
                or m.get("subjectId")
            )
            full_profile: dict | None = None
            if subject_id and profiles_fetched < MAX_PROFILES_PER_RUN:
                prof_url = f"{HINGE_API_BASE}/user/v2/public/{subject_id}"
                prof_job = enqueue_job(
                    user_id=user_id,
                    job_type="get_profile",
                    platform="hinge",
                    url=prof_url,
                    method="GET",
                    headers={"X-Auth-Token": token} if token else {},
                )
                if prof_job:
                    prof_resp = wait_for_completion(
                        prof_job,
                        timeout_seconds=JOB_WAIT_TIMEOUT_SECONDS,
                    )
                    if prof_resp is None:
                        result.extension_offline = True
                    elif _is_ok(prof_resp):
                        pbody = _extract_body(prof_resp) or {}
                        if isinstance(pbody, dict):
                            full_profile = pbody
                        profiles_fetched += 1
                    else:
                        sc = prof_resp.get("status_code") if isinstance(prof_resp, dict) else None
                        if sc in (401, 403):
                            result.auth_expired = True

            intel = HingeAPIClient.parse_match_to_intel(m, full_profile)
            _upsert_match(
                supabase_client,
                user_id=user_id,
                platform="hinge",
                match=m,
                intel=intel,
                raw_for_intel=full_profile or (m.get("subject") or m),
                result=result,
            )
        except Exception as exc:
            result.errors.append(f"hinge match loop: {exc}")
            continue

    return result


# ---------------------------------------------------------------------------
# Upsert (unchanged from Phase A)
# ---------------------------------------------------------------------------


def _upsert_match(
    supabase_client,
    *,
    user_id: str,
    platform: str,
    match: dict,
    intel: dict,
    raw_for_intel: dict,
    result: SyncResult,
) -> None:
    external_id = intel.get("external_id")
    if not external_id:
        return

    photos_enriched: list[dict] = []
    for p in (intel.get("photos") or [])[:MAX_PHOTOS_PER_MATCH]:
        url = p.get("url")
        supabase_path = None
        if url:
            content = _download_photo(url)
            if content:
                supabase_path = _upload_photo(
                    supabase_client,
                    user_id=user_id,
                    match_id=str(external_id),
                    idx=p.get("idx", 0),
                    content=content,
                )
                if supabase_path:
                    result.photos_uploaded += 1
        photos_enriched.append({
            "url": url,
            "supabase_path": supabase_path,
            "width": p.get("width"),
            "height": p.get("height"),
        })

    structured = match_intel.extract(raw_for_intel) if raw_for_intel else {}

    payload = {
        "user_id": user_id,
        "platform": platform,
        "match_id": str(external_id),
        "match_name": intel.get("name"),
        "external_id": str(external_id),
        "name": intel.get("name"),
        "age": intel.get("age"),
        "bio": intel.get("bio"),
        "photos_jsonb": photos_enriched,
        "prompts_jsonb": intel.get("prompts") or [],
        "job": intel.get("job"),
        "school": intel.get("school"),
        "instagram_handle": intel.get("instagram_handle"),
        "spotify_artists": intel.get("spotify_artists"),
        "birth_date": intel.get("birth_date"),
        "zodiac": structured.get("zodiac"),
        "match_intel": structured,
        "last_activity_at": intel.get("last_activity_at"),
    }
    payload = {k: v for k, v in payload.items() if v not in (None, "", [])}

    try:
        supabase_client.table("clapcheeks_matches").upsert(
            payload,
            on_conflict="user_id,platform,external_id",
        ).execute()
        result.upserted += 1
    except Exception as exc:
        result.errors.append(f"upsert {platform}/{external_id}: {exc}")

    # AI-9526 — Dual-write to Convex matches table. Failures here do NOT
    # block the Supabase upsert (which already succeeded above), so the
    # legacy read path stays consistent during the migration window.
    try:
        _upsert_match_convex(
            user_id=user_id,
            platform=platform,
            external_id=str(external_id),
            payload=payload,
            photos=photos_enriched,
        )
    except Exception as exc:
        logger.info("convex match upsert failed for %s/%s: %s", platform, external_id, exc)


def _upsert_match_convex(
    *,
    user_id: str,
    platform: str,
    external_id: str,
    payload: dict,
    photos: list[dict],
) -> None:
    """AI-9526 — Mirror the Supabase clapcheeks_matches upsert into Convex.

    Idempotent on (user_id, platform, external_match_id). Photos are passed
    through with their existing `url` + `supabase_path` fields preserved so
    the Vercel UI can keep rendering Supabase-served images during the
    migration window. Convex File Storage migration of the photo binaries
    happens in the backfill step (scripts/backfill_matches_supabase_to_convex.py),
    not in the live sync hot path.
    """
    try:
        from clapcheeks.convex_client import mutation as convex_mutation
    except Exception as exc:  # noqa: BLE001
        logger.info("convex_client unavailable for matches upsert: %s", exc)
        return

    # Map Supabase platform names to Convex literal union.
    if platform not in ("hinge", "tinder", "bumble", "imessage", "offline"):
        return

    convex_args: dict = {
        "user_id": user_id,
        "platform": platform,
        "external_match_id": external_id,
        "photos": [
            {
                "url": p.get("url") or None,
                "supabase_path": p.get("supabase_path") or None,
                "width": p.get("width"),
                "height": p.get("height"),
                "idx": p.get("idx"),
            }
            for p in photos
            if p.get("url") or p.get("supabase_path")
        ],
    }
    # Carry the rest of the payload through verbatim (skip Supabase-only keys).
    skip = {"user_id", "platform", "match_id", "external_id", "photos_jsonb",
            "prompts_jsonb", "spotify_artists", "birth_date"}
    for k, v in payload.items():
        if k in skip:
            continue
        if v in (None, "", []):
            continue
        convex_args[k] = v

    convex_mutation("matches:upsertByExternal", convex_args)


# ---------------------------------------------------------------------------
# Token invalidation
# ---------------------------------------------------------------------------


def _invalidate_token(
    supabase_client,
    user_id: str,
    platform: str,
) -> None:
    col = f"{platform}_auth_token"
    col_ts = f"{platform}_auth_token_updated_at"
    col_src = f"{platform}_auth_source"
    try:
        supabase_client.table("clapcheeks_user_settings").update({
            col: None,
            col_ts: None,
            col_src: None,
        }).eq("user_id", user_id).execute()
    except Exception as exc:
        logger.warning("Failed to NULL %s token for %s: %s", platform, user_id, exc)

    _log_agent_event(
        supabase_client,
        user_id=user_id,
        event_type="auth_token_expired",
        data={"platform": platform},
    )
    logger.warning("Marked %s token stale for user %s", platform, user_id)


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


def _load_users_with_tokens(supabase_client) -> list[dict]:
    """Return rows with at least one platform token (encrypted OR legacy plaintext).

    AI-8766: prefers encrypted columns. The decrypted value is materialised
    onto the row dict under the legacy ``tinder_auth_token`` /
    ``hinge_auth_token`` keys so callers downstream can stay agnostic about
    where the secret came from.
    """
    try:
        r = supabase_client.table("clapcheeks_user_settings") \
            .select(
                "user_id,"
                "tinder_auth_token,tinder_auth_token_enc,"
                "hinge_auth_token,hinge_auth_token_enc"
            ) \
            .execute()
    except Exception as exc:
        logger.error("load users failed: %s", exc)
        return []
    rows = r.data or []
    out: list[dict] = []
    for row in rows:
        user_id = row.get("user_id")
        if not user_id:
            continue
        tinder = _decrypt_or_plain(row, user_id, "tinder")
        hinge = _decrypt_or_plain(row, user_id, "hinge")
        if tinder or hinge:
            row["tinder_auth_token"] = tinder
            row["hinge_auth_token"] = hinge
            out.append(row)
    return out


def _decrypt_or_plain(row: dict, user_id: str, platform: str) -> str | None:
    """Return the decrypted token for platform, falling back to the
    deprecated plaintext column with a warning."""
    enc = row.get(f"{platform}_auth_token_enc")
    if enc:
        try:
            from clapcheeks.auth.token_vault import decrypt_token_supabase
            return decrypt_token_supabase(enc, user_id)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "token_vault decrypt failed for %s/%s: %s",
                user_id, platform, exc,
            )
            # fall through to plaintext path
    plain = row.get(f"{platform}_auth_token")
    if plain:
        logger.warning(
            "DEPRECATED plaintext %s_auth_token used for user %s — run backfill_encrypt_tokens",
            platform, user_id,
        )
        return plain
    return None


def sync_matches(once: bool = False) -> dict:
    """Sync matches for every user with a platform token via the Chrome-extension job queue.

    AI-8767 NOTE: This function legitimately uses service-role because it sweeps ALL
    users' ``clapcheeks_user_settings`` rows to load their platform tokens, which no
    single user JWT can do.  This function only runs on the VPS daemon; it must NOT
    be invoked from operator Mac processes.  CLAPCHEEKS_ALLOW_SERVICE_ROLE must be
    set in the VPS environment.  # NOQA: service-role-ok
    """
    from supabase import create_client  # NOQA: service-role-ok

    url, key = _load_supabase_env()
    if not url or not key:
        logger.error("SUPABASE_URL or SUPABASE_SERVICE_KEY not set")
        return {"users_processed": 0, "upserted": 0, "errors": ["no_supabase_env"]}

    client = create_client(url, key)
    ensure_bucket(client)

    # Sweep stale jobs FIRST so a stuck extension doesn't linger and
    # we get a clean accounting of "extension offline right now".
    stale_count = mark_stale_no_extension(
        stale_after_minutes=STALE_AFTER_MINUTES,
        client=client,
    )

    users = _load_users_with_tokens(client)
    logger.info("sync_matches: %d users to process", len(users))

    summary = {
        "users_processed": 0,
        "upserted": 0,
        "photos_uploaded": 0,
        "stale_jobs_swept": stale_count,
        "errors": [],  # type: list[str]
        "auth_expired": [],  # type: list[str]
        "extension_offline": False,
    }

    for row in users:
        user_id = row.get("user_id")
        if not user_id:
            continue
        summary["users_processed"] += 1

        tinder_token = row.get("tinder_auth_token")
        hinge_token = row.get("hinge_auth_token")

        if tinder_token:
            res = _sync_tinder_for_user(client, user_id, tinder_token)
            summary["upserted"] += res.upserted
            summary["photos_uploaded"] += res.photos_uploaded
            summary["errors"].extend(res.errors)
            if res.auth_expired:
                summary["auth_expired"].append(f"{user_id}/tinder")
                _invalidate_token(client, user_id, "tinder")
            if res.extension_offline:
                summary["extension_offline"] = True

        if hinge_token:
            res = _sync_hinge_for_user(client, user_id, hinge_token)
            summary["upserted"] += res.upserted
            summary["photos_uploaded"] += res.photos_uploaded
            summary["errors"].extend(res.errors)
            if res.auth_expired:
                summary["auth_expired"].append(f"{user_id}/hinge")
                _invalidate_token(client, user_id, "hinge")
            if res.extension_offline:
                summary["extension_offline"] = True

    # One alert per sync tick, deduped at the daemon-scheduler level.
    if summary["extension_offline"] or stale_count:
        try:
            alert_julian_extension_offline()
        except Exception as exc:
            logger.debug("alert send failed: %s", exc)

    logger.info("sync_matches done: %s", summary)
    return summary
