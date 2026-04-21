"""Retroactive swipe-decision ingestion from Tinder / Hinge GDPR export ZIPs.

Usage:
    python -m clapcheeks.ml.ingest_export path/to/export.zip --user-id <uuid>
    python -m clapcheeks.ml.ingest_export path/to/export.zip --user-id <uuid> --dry-run
    python -m clapcheeks.ml.ingest_export path/to/export.zip --platform hinge ...

The Tinder export is a ZIP containing ``data.json`` with an ``Usage`` block
("Usage"->"swipes_likes", "swipes_passes"). Each entry is ``{date: count}``
and there is no per-profile feature payload — historical Tinder exports do
not expose the target profile at all. For those we write one decision row
per swipe with ``external_id=null`` and a neutral feature dict (just
``rule_final_score=0.5`` so the trainer still has something to key on) so
the trainer has baseline label counts to calibrate against.

The Hinge export ships ``matches.json``, ``likes_received.json``, and
``decisions.json`` where each entry has the target's ``user_id`` / ``name``
and a ``decision`` field. Those land with real external_ids.

Insertion is chunked (500 rows per POST) with ``Prefer: resolution=merge-duplicates``
keyed on ``(user_id, platform, external_id)`` so reingestion is safe.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .features import extract_features

log = logging.getLogger("clapcheeks.ml.ingest_export")


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def _iter_zip_json(zip_path: str) -> dict[str, Any]:
    """Return {inner_path: parsed_json} for every *.json entry in the zip."""
    out: dict[str, Any] = {}
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            if not info.filename.lower().endswith(".json"):
                continue
            try:
                with zf.open(info) as f:
                    raw = f.read().decode("utf-8", errors="replace")
                    out[info.filename] = json.loads(raw)
            except Exception as exc:
                log.warning("skipping %s: %s", info.filename, exc)
    return out


def _parse_tinder(payload: dict[str, Any]) -> list[dict]:
    """Flatten Tinder GDPR JSON to decision rows.

    Tinder export shape:
      {"Usage": {"swipes_likes": {"YYYY-MM-DD": n, ...},
                 "swipes_passes": {"YYYY-MM-DD": n, ...}}}

    Since there is no per-profile data, we emit one synthetic row per swipe
    with a neutral feature dict.
    """
    decisions: list[dict] = []
    for _inner, doc in payload.items():
        if not isinstance(doc, dict):
            continue
        usage = doc.get("Usage") or {}
        likes = usage.get("swipes_likes") or {}
        passes = usage.get("swipes_passes") or {}
        for date_str, count in likes.items():
            for _ in range(int(count or 0)):
                decisions.append({
                    "platform": "tinder",
                    "external_id": None,
                    "decision": "like",
                    "features": {"rule_final_score": 0.5},
                    "decided_at": _coerce_date(date_str),
                })
        for date_str, count in passes.items():
            for _ in range(int(count or 0)):
                decisions.append({
                    "platform": "tinder",
                    "external_id": None,
                    "decision": "pass",
                    "features": {"rule_final_score": 0.5},
                    "decided_at": _coerce_date(date_str),
                })
    return decisions


def _parse_hinge(payload: dict[str, Any]) -> list[dict]:
    """Flatten Hinge GDPR JSON to decision rows.

    Hinge ships a few files, most importantly ``decisions.json`` which is a
    list of ``{user_id, name, date, decision: 'like'|'pass', ...}``.
    ``matches.json`` also carries age/bio we can hydrate features off.
    """
    decisions: list[dict] = []

    # Build a match_id -> match_data lookup from matches.json if present.
    match_lookup: dict[str, dict] = {}
    for inner, doc in payload.items():
        if "match" not in inner.lower():
            continue
        if isinstance(doc, list):
            for m in doc:
                if isinstance(m, dict) and m.get("user_id"):
                    match_lookup[m["user_id"]] = m
        elif isinstance(doc, dict):
            for k, v in doc.items():
                if isinstance(v, dict):
                    match_lookup[k] = v

    for inner, doc in payload.items():
        if "decision" not in inner.lower():
            continue
        rows = doc if isinstance(doc, list) else (doc.get("decisions") or [])
        for row in rows:
            if not isinstance(row, dict):
                continue
            external_id = row.get("user_id") or row.get("target_user_id")
            raw_decision = (row.get("decision") or row.get("action") or "").lower()
            if raw_decision not in ("like", "pass", "super_like", "superlike"):
                continue
            decision = "super_like" if "super" in raw_decision else raw_decision

            hydrated = match_lookup.get(external_id or "", {})
            merged = {**hydrated, **row}
            feats = extract_features(merged)

            decisions.append({
                "platform": "hinge",
                "external_id": external_id,
                "decision": decision,
                "features": feats,
                "decided_at": _coerce_date(row.get("date") or row.get("timestamp")),
            })
    return decisions


def _coerce_date(value: Any) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(value, str):
        # Try a few common ISO-ish shapes.
        for fmt in (
            "%Y-%m-%dT%H:%M:%S.%fZ",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(value, fmt).replace(
                    tzinfo=timezone.utc,
                ).isoformat()
            except ValueError:
                continue
        # If already ISO, Postgres will accept it.
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


def _detect_platform(payload: dict[str, Any]) -> str:
    """Best-effort detection based on filenames inside the zip."""
    names = " ".join(payload.keys()).lower()
    if "hinge" in names or "prompts" in names or "decisions" in names:
        return "hinge"
    if "tinder" in names or "usage" in names:
        return "tinder"
    # Default: tinder (it's the blob with 'Usage' stats most of the time).
    return "tinder"


# ---------------------------------------------------------------------------
# Supabase bulk insert
# ---------------------------------------------------------------------------

def _supabase_creds() -> tuple[str, str]:
    from clapcheeks.scoring import _supabase_creds as _scoring_creds
    return _scoring_creds()


def _chunked(iterable: Iterable, size: int) -> Iterable[list]:
    buf: list = []
    for item in iterable:
        buf.append(item)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


def _bulk_insert(user_id: str, decisions: list[dict], dry_run: bool = False) -> dict:
    """POST decisions in chunks. Returns {inserted, skipped, errors}."""
    stats = {"inserted": 0, "skipped": 0, "errors": 0}
    if dry_run:
        stats["inserted"] = len(decisions)
        return stats

    import requests

    url, key = _supabase_creds()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    for batch in _chunked(decisions, 500):
        payload = [
            {
                "user_id": user_id,
                "platform": d["platform"],
                "external_id": d.get("external_id"),
                "decision": d["decision"],
                "features": d["features"],
                "decided_at": d["decided_at"],
            }
            for d in batch
        ]
        try:
            r = requests.post(
                f"{url}/rest/v1/clapcheeks_swipe_decisions",
                headers=headers,
                json=payload,
                timeout=60,
            )
            if r.status_code >= 300:
                log.warning(
                    "ingest: batch status %s: %s",
                    r.status_code, r.text[:200],
                )
                stats["errors"] += len(batch)
            else:
                stats["inserted"] += len(batch)
        except Exception as exc:
            log.error("ingest: batch failed: %s", exc)
            stats["errors"] += len(batch)

    return stats


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def ingest(zip_path: str, user_id: str, *, platform: str | None = None, dry_run: bool = False) -> dict:
    """Parse a Tinder / Hinge export zip and load rows into Supabase.

    Returns a summary dict with counts per platform.
    """
    if not os.path.isfile(zip_path):
        raise FileNotFoundError(zip_path)

    payload = _iter_zip_json(zip_path)
    plat = platform or _detect_platform(payload)

    if plat == "tinder":
        decisions = _parse_tinder(payload)
    elif plat == "hinge":
        decisions = _parse_hinge(payload)
    else:
        raise ValueError(f"unsupported platform: {plat}")

    log.info("parsed %d decisions from %s export", len(decisions), plat)
    stats = _bulk_insert(user_id, decisions, dry_run=dry_run)
    stats["platform"] = plat
    stats["total_parsed"] = len(decisions)
    return stats


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m clapcheeks.ml.ingest_export")
    parser.add_argument("zip_path", help="Path to the GDPR export .zip")
    parser.add_argument("--user-id", required=True, help="Target auth.users.id")
    parser.add_argument(
        "--platform",
        choices=["tinder", "hinge"],
        default=None,
        help="Force a platform; otherwise auto-detected from zip contents.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse only; don't write to Supabase.",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    stats = ingest(
        args.zip_path,
        args.user_id,
        platform=args.platform,
        dry_run=args.dry_run,
    )
    print(json.dumps(stats, indent=2))
    return 0 if stats.get("errors", 0) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
