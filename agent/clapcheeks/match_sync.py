"""Phase A match intake loop (AI-8315).

For every user with a tinder_auth_token / hinge_auth_token in
clapcheeks_user_settings, pull their match list + full profiles from the
respective platform APIs, mirror photos to Supabase Storage
(bucket `match-photos`), and upsert a row into clapcheeks_matches.

This module is invoked from the daemon's sync loop (see daemon.py
`_match_sync_worker`) every 10 minutes, and can be run once via
`python3 -m clapcheeks.daemon --task sync_matches --once`.

Design notes
------------
* The daemon runs as the owner — there is only one Julian — but the
  architecture is written as if it were multi-tenant so future SaaS
  rollout is free. We iterate every row in clapcheeks_user_settings
  that has a non-null token.
* Rate limits: token-bucket style sleeper. Tinder 30/min, Hinge 20/min.
* 401 handling: 3 strikes and we NULL the stored token + log an
  `auth_token_expired` event. The Chrome extension re-harvests on
  next tinder.com / hinge.co visit.
* Idempotent: upserts on (user_id, platform, external_id).
* Fail-open: errors on one match never cascade; they log + continue.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import requests

from clapcheeks import match_intel
from clapcheeks.sync import _load_supabase_env

logger = logging.getLogger("clapcheeks.match_sync")

PHOTO_BUCKET = "match-photos"
HTTP_TIMEOUT = 20
MAX_PHOTOS_PER_MATCH = 8
AUTH_STRIKE_LIMIT = 3


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


class _TokenBucket:
    """Simple rate limiter — N calls per 60 seconds, blocking.

    Used per-client-instance. Not thread-safe on purpose (each sync run
    is a single thread).
    """

    def __init__(self, per_minute: int) -> None:
        self.per_minute = max(1, per_minute)
        self.interval = 60.0 / self.per_minute
        self._last: float = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        gap = now - self._last
        if gap < self.interval:
            time.sleep(self.interval - gap)
        self._last = time.monotonic()


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------


def ensure_bucket(supabase_client) -> None:
    """Create the match-photos bucket if it doesn't exist. Idempotent.

    Created as a private bucket. Migration 20260420000002 also creates
    it — this function is defensive in case migration hasn't run (e.g.
    local dev / test).
    """
    try:
        buckets = supabase_client.storage.list_buckets()
        names = {b.name if hasattr(b, "name") else b.get("name") for b in buckets}
        if PHOTO_BUCKET not in names:
            supabase_client.storage.create_bucket(PHOTO_BUCKET, options={"public": False})
            logger.info("Created Supabase bucket %s", PHOTO_BUCKET)
    except Exception as exc:
        # Bucket probably exists — or we have no perms to list. Swallow
        # and let uploads surface any hard error.
        logger.debug("ensure_bucket: %s", exc)


def _download_photo(url: str) -> bytes | None:
    """Fetch a photo byte string; return None on 404/timeout."""
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
    """Upload a photo to match-photos/{user_id}/{match_id}/{idx}.jpg.

    Returns the bucket path on success; None on failure.
    """
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
# Per-platform fetcher
# ---------------------------------------------------------------------------


@dataclass
class SyncResult:
    upserted: int = 0
    photos_uploaded: int = 0
    errors: list[str] = field(default_factory=list)
    auth_expired: bool = False


def _sync_tinder_for_user(
    supabase_client,
    user_id: str,
    token: str,
) -> SyncResult:
    """Pull Tinder matches for one user and upsert to Supabase."""
    from clapcheeks.platforms.tinder_api import (
        TinderAPIClient,
        TinderAuthError,
    )

    result = SyncResult()
    os.environ["TINDER_AUTH_TOKEN"] = token
    try:
        client = TinderAPIClient(token=token)
    except TinderAuthError as exc:
        result.errors.append(f"tinder init: {exc}")
        return result

    # Disable auto-refresh in the server-side daemon path — we handle
    # auth failures explicitly below.
    client._try_browser_refresh = lambda: False  # type: ignore[method-assign]

    bucket = _TokenBucket(per_minute=30)

    # Count 401s. We skip the explicit login() probe — /v2/matches is
    # the endpoint we actually need, and it returns 401 if the token
    # is bad, which is handled the same way below.
    auth_strikes = 0
    try:
        bucket.wait()
        matches = client.list_all_matches()
    except TinderAuthError:
        result.auth_expired = True
        return result
    except Exception as exc:
        result.errors.append(f"tinder list_all_matches: {exc}")
        return result

    for m in matches:
        try:
            match_external = m.get("_id") or m.get("id")
            if not match_external:
                continue

            # Attempt profile hydration — match objects already carry
            # `person`, but /user/{id} has the full photo set.
            person_id = (m.get("person") or {}).get("_id")
            full_profile: dict | None = None
            if person_id:
                bucket.wait()
                try:
                    full_profile = client.get_match_profile(person_id)
                except TinderAuthError:
                    auth_strikes += 1
                    if auth_strikes >= AUTH_STRIKE_LIMIT:
                        result.auth_expired = True
                        break
                    continue
                except Exception as exc:
                    logger.debug("tinder profile %s failed: %s", person_id, exc)

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
    """Pull Hinge matches for one user and upsert to Supabase."""
    from clapcheeks.platforms.hinge_api import (
        HingeAPIClient,
        HingeAuthError,
    )

    result = SyncResult()
    os.environ["HINGE_AUTH_TOKEN"] = token
    try:
        client = HingeAPIClient(token=token)
    except HingeAuthError as exc:
        result.errors.append(f"hinge init: {exc}")
        return result

    client._try_sms_refresh = lambda: False  # type: ignore[method-assign]
    bucket = _TokenBucket(per_minute=20)

    auth_strikes = 0
    # Skip the login probe — its endpoints (`/user/v2/public/me`,
    # `/feed/rec/v3`) drift. Jump straight to /match/v1 since that's the
    # only endpoint we actually need. If the token is bad, /match/v1
    # will itself return 401 and raise HingeAuthError.
    try:
        bucket.wait()
        matches = client.list_all_matches()
    except HingeAuthError:
        result.auth_expired = True
        return result
    except Exception as exc:
        result.errors.append(f"hinge list_all_matches: {exc}")
        return result

    for m in matches:
        try:
            subject_id = (
                (m.get("subject") or {}).get("subjectId")
                or (m.get("subject") or {}).get("id")
                or m.get("subjectId")
            )
            full_profile: dict | None = None
            if subject_id:
                bucket.wait()
                try:
                    full_profile = client.get_match_profile(subject_id)
                except HingeAuthError:
                    auth_strikes += 1
                    if auth_strikes >= AUTH_STRIKE_LIMIT:
                        result.auth_expired = True
                        break
                    continue
                except Exception as exc:
                    logger.debug("hinge profile %s failed: %s", subject_id, exc)

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
# Upsert
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

    # Mirror photos first so the row we upsert carries supabase_path.
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
        "match_id": str(external_id),     # legacy column — keep in sync
        "match_name": intel.get("name"),  # legacy column — keep in sync
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
    # Strip None values so existing columns aren't clobbered on re-sync.
    payload = {k: v for k, v in payload.items() if v not in (None, "", [])}

    try:
        supabase_client.table("clapcheeks_matches").upsert(
            payload,
            on_conflict="user_id,platform,external_id",
        ).execute()
        result.upserted += 1
    except Exception as exc:
        result.errors.append(f"upsert {platform}/{external_id}: {exc}")


# ---------------------------------------------------------------------------
# Token invalidation
# ---------------------------------------------------------------------------


def _invalidate_token(
    supabase_client,
    user_id: str,
    platform: str,
) -> None:
    """NULL the platform_auth_token column and emit an agent event."""
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
    """Return rows from clapcheeks_user_settings that have at least one
    platform token set.
    """
    try:
        r = supabase_client.table("clapcheeks_user_settings") \
            .select("user_id,tinder_auth_token,hinge_auth_token") \
            .execute()
    except Exception as exc:
        logger.error("load users failed: %s", exc)
        return []
    rows = r.data or []
    return [
        row for row in rows
        if row.get("tinder_auth_token") or row.get("hinge_auth_token")
    ]


def sync_matches(once: bool = False) -> dict:
    """Sync matches for every user with a platform token.

    Returns a summary dict. Called by the daemon's match-sync worker.
    """
    from supabase import create_client

    url, key = _load_supabase_env()
    if not url or not key:
        logger.error("SUPABASE_URL or SUPABASE_SERVICE_KEY not set")
        return {"users_processed": 0, "upserted": 0, "errors": ["no_supabase_env"]}

    client = create_client(url, key)
    ensure_bucket(client)

    users = _load_users_with_tokens(client)
    logger.info("sync_matches: %d users to process", len(users))

    summary = {
        "users_processed": 0,
        "upserted": 0,
        "photos_uploaded": 0,
        "errors": [],  # type: list[str]
        "auth_expired": [],  # type: list[str]
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

        if hinge_token:
            res = _sync_hinge_for_user(client, user_id, hinge_token)
            summary["upserted"] += res.upserted
            summary["photos_uploaded"] += res.photos_uploaded
            summary["errors"].extend(res.errors)
            if res.auth_expired:
                summary["auth_expired"].append(f"{user_id}/hinge")
                _invalidate_token(client, user_id, "hinge")

    logger.info("sync_matches done: %s", summary)
    return summary
