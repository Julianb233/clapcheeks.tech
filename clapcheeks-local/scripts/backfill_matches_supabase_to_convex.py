#!/usr/bin/env python3
"""AI-9526 — Idempotent backfill: copy Supabase clapcheeks_matches rows + photo
binaries into Convex.

Runs from Mac Mini (or any host with both Supabase service-role + Convex
deploy access). Safe to re-run: each row is upserted by
(user_id, platform, external_match_id). Photos are migrated to Convex File
Storage and the resulting `_storage` id is stamped on each photo entry; the
original Supabase Storage URL is preserved on the same row as a fallback
during the migration window.

Usage:
  CONVEX_URL=...  \\
  CONVEX_DEPLOY_KEY=...  \\
  CONVEX_RUNNER_SHARED_SECRET=...  \\
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \\
  python3 scripts/backfill_matches_supabase_to_convex.py [--dry-run] [--limit N] [--no-photos]

Environment:
  --dry-run     : count rows + photos without writing anything
  --no-photos   : copy match rows but skip photo upload to Convex storage
                  (use when running the first sweep — re-run later with
                  photos enabled to fill them in)
  --limit N     : process at most N matches (smoke-test friendly)

Output:
  {matches_inserted, matches_updated, photos_migrated, errors}
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill_matches")

PHOTO_BUCKET_CANDIDATES = ["clapcheeks-match-photos", "match-photos"]
SUPABASE_TABLE = "clapcheeks_matches"

PLATFORM_ALLOWLIST = {"hinge", "tinder", "bumble", "imessage", "offline"}

# Columns we explicitly map. Anything else on the Supabase row is dropped.
COLS = (
    "id, user_id, match_name, name, age, bio, platform, status, photos_jsonb, "
    "instagram_handle, zodiac, job, school, stage, health_score, final_score, "
    "julian_rank, match_intel, attributes, created_at, updated_at, "
    "last_activity_at, external_id"
)


def _to_ms(value: Any) -> int | None:
    """Convert a Supabase ISO string OR seconds-int to unix ms."""
    if value in (None, "", 0):
        return None
    if isinstance(value, (int, float)):
        # Heuristic: > 1e12 already ms, else seconds
        v = float(value)
        return int(v if v > 1e12 else v * 1000)
    if isinstance(value, str):
        try:
            from datetime import datetime
            # Postgres returns either "2026-04-30T..." or with TZ
            v = value.replace("Z", "+00:00")
            return int(datetime.fromisoformat(v).timestamp() * 1000)
        except Exception:
            return None
    return None


def _signed_url(sb, bucket: str, path: str) -> str | None:
    try:
        resp = sb.storage.from_(bucket).create_signed_url(path, 60 * 60)
        # supabase-py returns either {"signedURL": ...} or {"signedUrl": ...}
        if isinstance(resp, dict):
            return resp.get("signedURL") or resp.get("signedUrl")
        return None
    except Exception as exc:  # noqa: BLE001
        log.debug("create_signed_url failed for %s/%s: %s", bucket, path, exc)
        return None


def _download_storage_photo(sb, supabase_path: str) -> tuple[bytes | None, str]:
    """Download a Supabase Storage object trying both bucket names."""
    for bucket in PHOTO_BUCKET_CANDIDATES:
        try:
            content = sb.storage.from_(bucket).download(supabase_path)
            if content:
                return content, bucket
        except Exception as exc:  # noqa: BLE001
            log.debug("download %s/%s failed: %s", bucket, supabase_path, exc)
            continue
    return None, ""


def _upload_to_convex_storage(cx_url: str, content: bytes, mime: str = "image/jpeg") -> str | None:
    """Mint an upload URL via the matches:generateUploadUrl mutation, then POST.

    The mutation does not require auth; the upload URL is short-lived.
    Returns the Convex storage id on success.
    """
    import requests

    try:
        from convex import ConvexClient  # type: ignore
    except ImportError:
        log.error("pip install convex")
        return None

    cx = ConvexClient(cx_url)
    deploy_key = os.environ.get("CONVEX_DEPLOY_KEY", "").strip()
    if deploy_key:
        try:
            cx.set_admin_auth(deploy_key)
        except AttributeError:
            cx.set_auth(deploy_key)

    try:
        upload_url = cx.mutation("matches:generateUploadUrl", {})
    except Exception as exc:  # noqa: BLE001
        log.error("generateUploadUrl failed: %s", exc)
        return None
    if not upload_url:
        return None
    try:
        r = requests.post(upload_url, data=content, headers={"Content-Type": mime}, timeout=30)
        if r.status_code >= 400:
            log.warning("convex storage upload HTTP %d: %s", r.status_code, r.text[:200])
            return None
        body = r.json()
        return body.get("storageId")
    except Exception as exc:  # noqa: BLE001
        log.warning("convex storage upload failed: %s", exc)
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="count without writing")
    parser.add_argument("--no-photos", action="store_true", help="skip photo migration")
    parser.add_argument("--limit", type=int, default=0, help="stop after N matches (0=all)")
    parser.add_argument("--source-tag", default="supabase-backfill-2026-05-07",
                        help="label written to Convex source field")
    args = parser.parse_args()

    sb_url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not sb_url or not sb_key:
        log.error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
        return 1

    cx_secret = os.environ.get("CONVEX_RUNNER_SHARED_SECRET", "").strip()
    if not cx_secret:
        log.error("CONVEX_RUNNER_SHARED_SECRET not set")
        return 1

    cx_url = os.environ.get("CONVEX_URL", "").strip()
    if not cx_url:
        log.error("CONVEX_URL not set")
        return 1

    try:
        from supabase import create_client
    except ImportError:
        log.error("pip install supabase")
        return 1
    try:
        from convex import ConvexClient  # type: ignore
    except ImportError:
        log.error("pip install convex")
        return 1

    sb = create_client(sb_url, sb_key)
    cx = ConvexClient(cx_url)
    deploy_key = os.environ.get("CONVEX_DEPLOY_KEY", "").strip()
    if deploy_key:
        try:
            cx.set_admin_auth(deploy_key)
        except AttributeError:
            cx.set_auth(deploy_key)

    log.info("Fetching all clapcheeks_matches rows from Supabase...")
    try:
        # Pull in pages of 1000 — Supabase REST default cap is 1000.
        rows: list[dict] = []
        page_size = 1000
        offset = 0
        while True:
            resp = (
                sb.table(SUPABASE_TABLE)
                .select(COLS)
                .order("created_at", desc=False)
                .range(offset, offset + page_size - 1)
                .execute()
            )
            chunk = resp.data or []
            rows.extend(chunk)
            if len(chunk) < page_size:
                break
            offset += page_size
            if args.limit and len(rows) >= args.limit:
                break
    except Exception as exc:  # noqa: BLE001
        log.error("supabase select failed: %s", exc)
        return 2

    if args.limit:
        rows = rows[: args.limit]
    log.info("Got %d match rows from Supabase", len(rows))

    counts = {
        "matches_inserted": 0,
        "matches_updated": 0,
        "photos_migrated": 0,
        "photos_skipped": 0,
        "errors": 0,
        "skipped_unknown_platform": 0,
    }

    for i, row in enumerate(rows):
        if args.limit and i >= args.limit:
            break
        try:
            user_id = row.get("user_id")
            platform = (row.get("platform") or "").lower()
            external_id = row.get("external_id") or row.get("id")
            if not user_id or not external_id:
                continue
            if platform not in PLATFORM_ALLOWLIST:
                counts["skipped_unknown_platform"] += 1
                continue

            existing_photos = row.get("photos_jsonb") or []
            new_photos: list[dict] = []
            for p in existing_photos[:8]:
                # Each photo dict shape: {url, supabase_path, width, height}
                supabase_path = (p or {}).get("supabase_path") or ""
                url = (p or {}).get("url") or None
                # Strip nulls — Convex v.optional() rejects explicit null,
                # it only accepts missing keys.
                raw = {
                    "url": url,
                    "supabase_path": supabase_path or None,
                    "width": (p or {}).get("width"),
                    "height": (p or {}).get("height"),
                }
                photo_entry: dict = {k: v for k, v in raw.items() if v is not None}
                if (
                    not args.dry_run
                    and not args.no_photos
                    and supabase_path
                ):
                    content, _bucket = _download_storage_photo(sb, supabase_path)
                    if content:
                        storage_id = _upload_to_convex_storage(cx_url, content)
                        if storage_id:
                            photo_entry["storage_id"] = storage_id
                            counts["photos_migrated"] += 1
                        else:
                            counts["photos_skipped"] += 1
                    else:
                        counts["photos_skipped"] += 1
                if photo_entry:  # don't insert empty photo objects
                    new_photos.append(photo_entry)

            convex_args = {
                "deploy_key_check": cx_secret,
                "user_id": user_id,
                "platform": platform,
                "external_match_id": str(external_id),
                "supabase_match_id": row.get("id"),
                "match_name": row.get("match_name"),
                "name": row.get("name"),
                "age": row.get("age"),
                "bio": row.get("bio"),
                "status": row.get("status"),
                "photos": new_photos,
                "instagram_handle": row.get("instagram_handle"),
                "zodiac": row.get("zodiac"),
                "job": row.get("job"),
                "school": row.get("school"),
                "stage": row.get("stage"),
                "health_score": row.get("health_score"),
                "final_score": row.get("final_score"),
                "julian_rank": row.get("julian_rank"),
                "match_intel": row.get("match_intel"),
                "attributes": row.get("attributes"),
                "last_activity_at": _to_ms(row.get("last_activity_at")),
                "created_at": _to_ms(row.get("created_at")),
            }
            # Strip Nones / empty strings so the validator doesn't reject them.
            convex_args = {
                k: v for k, v in convex_args.items()
                if v is not None and v != ""
            }
            convex_args["deploy_key_check"] = cx_secret  # always include even if "" not stripped
            if args.dry_run:
                continue
            try:
                result = cx.mutation("matches:upsertFromBackfill", convex_args)
                action = result.get("action") if isinstance(result, dict) else None
                if action == "inserted":
                    counts["matches_inserted"] += 1
                elif action == "updated":
                    counts["matches_updated"] += 1
            except Exception as exc:  # noqa: BLE001
                log.error("convex upsert failed for %s/%s/%s: %s", user_id, platform, external_id, exc)
                counts["errors"] += 1
        except Exception as exc:  # noqa: BLE001
            log.error("row %d failed: %s", i, exc)
            counts["errors"] += 1

    log.info("Backfill complete: %s", json.dumps(counts))
    return 0 if counts["errors"] == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
