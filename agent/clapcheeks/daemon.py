"""Background agent daemon — full scheduling engine.

Manages per-platform swipe sessions, conversation loops, metric sync,
and heartbeat on independent threads with configurable intervals and
active-hours gating.
"""
import logging
import logging.handlers
import os
import signal
import sys
import threading
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Load ~/.clapcheeks/.env before anything else so the factory + platform
# clients see HINGE_AUTH_TOKEN, TINDER_AUTH_TOKEN, GOOGLE_*, etc. The CLI
# entry point does this, but `python -m clapcheeks.daemon` (launchd path)
# skips it, so do it explicitly here.
try:
    from dotenv import load_dotenv
    _env_file = Path.home() / ".clapcheeks" / ".env"
    if _env_file.exists():
        load_dotenv(_env_file, override=False)
except ImportError:
    pass

import requests

from clapcheeks.config import load, get_agent_token, CONFIG_DIR
from clapcheeks.events import EventEmitter
from clapcheeks.session.ban_detector import BanDetector

LOG_FILE = CONFIG_DIR / "daemon.log"

log = logging.getLogger("clapcheeks.daemon")

# ---------------------------------------------------------------------------
# Crash tracking for degraded status detection (AGENT-01)
# ---------------------------------------------------------------------------

worker_crashes: dict[str, list[float]] = defaultdict(list)
CRASH_WINDOW_SECS = 3600  # 1 hour
CRASH_THRESHOLD = 3        # 3 crashes in window = degraded


def record_worker_crash(platform: str) -> None:
    """Record a worker crash and mark platform degraded if threshold exceeded."""
    now = time.time()
    worker_crashes[platform].append(now)
    # Keep only crashes within the window
    worker_crashes[platform] = [
        t for t in worker_crashes[platform] if now - t < CRASH_WINDOW_SECS
    ]
    crashes_in_window = len(worker_crashes[platform])
    if crashes_in_window >= CRASH_THRESHOLD:
        _mark_platform_degraded(platform, crashes_in_window)


def _mark_platform_degraded(platform: str, crash_count: int) -> None:
    """Push degraded status to Supabase so dashboard can show it."""
    log.warning(
        "[DEGRADED] %s worker crashed %dx in 1 hour — marking degraded",
        platform, crash_count,
    )
    push_agent_status("degraded", affected_platform=platform)


def push_agent_status(
    status: str,
    affected_platform: str | None = None,
    reason: str | None = None,
) -> None:
    """Push agent status to Supabase for dashboard visibility."""
    from clapcheeks.sync import _load_supabase_env

    try:
        from supabase import create_client

        url, key = _load_supabase_env()
        if not url or not key:
            log.warning("Cannot push agent status — SUPABASE_URL/KEY not set")
            return

        client = create_client(url, key)
        payload: dict = {
            "status": status,
        }
        if affected_platform:
            payload["degraded_platform"] = affected_platform
            payload["degraded_reason"] = reason or (
                f"{affected_platform} worker crashed {CRASH_THRESHOLD}+ times in 1 hour"
            )

        device_id = os.environ.get("DEVICE_ID", "default")
        client.table("clapcheeks_agent_tokens").update(payload).eq(
            "device_id", device_id
        ).execute()
        log.info("Agent status pushed: %s", status)
    except Exception as exc:
        log.error("Failed to push agent status: %s", exc)

# Platform client class registry — mirrors platforms/__init__.py imports.
PLATFORM_CLIENTS = {
    "tinder": "clapcheeks.platforms.tinder:TinderClient",
    "bumble": "clapcheeks.platforms.bumble:BumbleClient",
    "hinge": "clapcheeks.platforms.hinge:HingeClient",
    "grindr": "clapcheeks.platforms.grindr:GrindrClient",
    "badoo": "clapcheeks.platforms.badoo:BadooClient",
    "happn": "clapcheeks.platforms.happn:HappnClient",
    "okcupid": "clapcheeks.platforms.okcupid:OKCupidClient",
    "pof": "clapcheeks.platforms.pof:POFClient",
    "feeld": "clapcheeks.platforms.feeld:FeeldClient",
    "cmb": "clapcheeks.platforms.coffeemeetsbagel:CMBClient",
}

# ---------------------------------------------------------------------------
# Shutdown flag
# ---------------------------------------------------------------------------

_shutdown = threading.Event()

# Track last re-engagement time per platform (max once per 23h)
_last_reengagement: dict[str, float] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

REQUIRED_ENV_VARS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "DEVICE_ID",
]

OPTIONAL_ENV_VARS = [
    ("KIMI_API_KEY", "AI opener generation will be disabled"),
    ("ANTHROPIC_API_KEY", "Claude AI features will be disabled"),
    ("OPENAI_API_KEY", "OpenAI features will be disabled"),
]


def validate_env() -> None:
    """Validate environment variables before starting workers."""
    log.info("[STARTUP] Validating environment...")

    # Check required vars -- hard fail
    missing_required = [v for v in REQUIRED_ENV_VARS if not os.environ.get(v)]
    if missing_required:
        log.error("[FATAL] Missing required env vars: %s", ", ".join(missing_required))
        print(f"[FATAL] Missing required env vars: {', '.join(missing_required)}")
        print("Run `clapcheeks setup` to configure your environment.")
        sys.exit(1)

    # Check optional vars -- warn only
    for var, consequence in OPTIONAL_ENV_VARS:
        if not os.environ.get(var):
            log.warning("[WARN] %s not set — %s", var, consequence)
        else:
            log.info("[OK]   %s is set", var)

    log.info("[STARTUP] Environment validation passed")


def _setup_logging() -> None:
    """Configure rotating log file handler (10MB, 5 backups) + console output."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s [%(threadName)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotate at 10MB, keep 5 backup files
    file_handler = logging.handlers.RotatingFileHandler(
        str(LOG_FILE),
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    # Also log to stdout for `clapcheeks logs` and systemd journal
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)


def _handle_sigterm(signum, frame):
    log.info("Received signal %s, shutting down gracefully", signum)
    _shutdown.set()


def _in_active_hours(active_hours: list[int]) -> bool:
    """Return True if the current hour falls within [start, end)."""
    if not active_hours or len(active_hours) < 2:
        return True
    start, end = active_hours[0], active_hours[1]
    hour = datetime.now().hour
    if start <= end:
        return start <= hour < end
    # Wrap-around (e.g. [22, 6])
    return hour >= start or hour < end


def _load_platform_client(platform: str):
    """Dynamically import and return the client *class* for a platform."""
    ref = PLATFORM_CLIENTS.get(platform)
    if not ref:
        raise ValueError(f"Unknown platform: {platform}")
    module_path, class_name = ref.rsplit(":", 1)
    import importlib
    mod = importlib.import_module(module_path)
    return getattr(mod, class_name)


def _get_daemon_config(config: dict) -> dict:
    """Extract the daemon sub-key from config, applying defaults."""
    defaults = {
        "platforms": ["tinder", "hinge"],
        "swipe_interval_hours": 4,
        "active_hours": [9, 23],
        "conversation_after_swipe": True,
        "sync_interval_minutes": 30,
        "match_sync_interval_minutes": 10,
    }
    daemon_cfg = config.get("daemon", {}) or {}
    return {**defaults, **daemon_cfg}


# ---------------------------------------------------------------------------
# Thread workers
# ---------------------------------------------------------------------------

def _heartbeat_worker(api_url: str, token: str) -> None:
    """POST heartbeat every 60 seconds until shutdown."""
    heartbeat_url = f"{api_url}/agent/heartbeat"
    while not _shutdown.is_set():
        try:
            resp = requests.post(
                heartbeat_url,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            log.info("Heartbeat sent (HTTP %d)", resp.status_code)
        except requests.RequestException as exc:
            log.warning("Heartbeat failed: %s", exc)
        _shutdown.wait(60)


def _sync_worker(config: dict, interval_minutes: int) -> None:
    """Metrics push, leads push, and platform-token pull each tick."""
    from clapcheeks.sync import (
        pull_platform_tokens, push_leads, push_metrics, record_sync_time,
    )

    interval_sec = interval_minutes * 60
    while not _shutdown.is_set():
        try:
            synced, queued = push_metrics(config)
            lead_up, lead_skip = push_leads(config)
            token_refresh = pull_platform_tokens()
            record_sync_time()
            log.info(
                "Sync complete: metrics %d/%dq, leads %d/%dskip, tokens %d",
                synced, queued, lead_up, lead_skip, token_refresh,
            )
        except Exception as exc:
            log.error("Sync failed: %s", exc)
        _shutdown.wait(interval_sec)


def _match_sync_worker(interval_minutes: int = 30) -> None:
    """Pull every match from every configured platform into Supabase.

    Phase A - AI-8315. Default TIGHTENED to 30 min on 2026-04-20 after
    a 10-min cadence tripped Tinder's anti-bot (selfie verification).
    Until AI-8345 (Phase M) moves API calls through the Chrome
    extension, keep this conservative to protect account health.
    First tick fires immediately.
    """
    from clapcheeks.match_sync import sync_matches

    interval_sec = interval_minutes * 60
    while not _shutdown.is_set():
        try:
            summary = sync_matches()
            log.info("match_sync summary: %s", summary)
        except Exception as exc:
            log.error("match_sync failed: %s", exc)
        _shutdown.wait(interval_sec)


def _ig_enrich_worker_thread(interval_seconds: int = 900) -> None:
    """Phase C (AI-8317) Instagram enrichment loop.

    Every ``interval_seconds`` (default 15m) find matches with an
    ``instagram_handle`` but no ``instagram_intel`` and enqueue an
    ``ig_user_feed`` job via the Phase M Chrome-extension queue. The
    extension fetches ``www.instagram.com/api/v1/users/web_profile_info``
    inside Julian's real browser session, results round-trip via
    ``/api/ingest/api-result``, and ``ig_enrich.enrich_one`` parses +
    writes the intel back to ``clapcheeks_matches``.

    Runs independently of the Phase B vision worker and Phase I scoring
    worker. No direct VPS->instagram.com traffic.
    """
    from clapcheeks.ig_enrich import run_once

    log.info("ig_enrich worker started (interval=%ds)", interval_seconds)
    while not _shutdown.is_set():
        try:
            stats = run_once()
            if stats["scanned"]:
                log.info("ig_enrich tick: %s", stats)
        except Exception as exc:
            log.error("ig_enrich tick failed: %s", exc)
        _shutdown.wait(interval_seconds)


def _scoring_worker(config: dict, interval_seconds: int = 300) -> None:
    """Rule-based match scoring (Phase I).

    Every ``interval_seconds`` (default 5m), find every clapcheeks_matches
    row with ``final_score IS NULL`` for the configured user and score it
    using the persona's ranking_weights. Also re-scores rows where the
    vision_summary was updated more recently than scored_at (cheap way
    to handle the Phase B -> Phase I rescore trigger without a DB trigger).

    Lightweight — no network calls outside Supabase REST. Safe to run
    alongside the other workers.
    """
    from clapcheeks.scoring import load_persona, score_all_unscored

    # Resolve user_id from config. If the agent is multi-user in the future,
    # this becomes a loop over users.
    user_id = (
        config.get("user_id")
        or config.get("clapcheeks_user_id")
        or os.environ.get("CLAPCHEEKS_USER_ID")
    )
    if not user_id:
        log.warning("scoring worker: no user_id in config/env, disabled")
        return

    # Cache the persona; refresh every hour to pick up dashboard edits.
    persona = None
    last_persona_fetch = 0.0
    persona_ttl = 3600.0

    while not _shutdown.is_set():
        try:
            now = time.time()
            if persona is None or (now - last_persona_fetch) > persona_ttl:
                persona = load_persona(user_id)
                last_persona_fetch = now

            stats = score_all_unscored(user_id, persona=persona, limit=200)
            if stats["scored"] or stats["errors"]:
                log.info(
                    "Scoring tick: scanned=%d scored=%d errors=%d",
                    stats["scanned"], stats["scored"], stats["errors"],
                )

            # Rescore matches whose vision_summary changed after scored_at.
            # Uses REST with filter `updated_at=gt.scored_at` (not supported
            # server-side by PostgREST for column comparisons), so we pull a
            # small window of recently-updated rows and check locally.
            _rescore_updated_matches(user_id, persona)
        except Exception as exc:
            log.error("Scoring tick failed: %s", exc)
        _shutdown.wait(interval_seconds)


def _rescore_updated_matches(user_id: str, persona: dict) -> None:
    """Rescore matches whose row was updated after it was scored.

    Cheap polling alternative to a Postgres trigger — pulls matches where
    scored_at IS NOT NULL and updated_at is in the last 15 minutes, then
    locally filters rows where updated_at > scored_at before rescoring.
    """
    from datetime import datetime, timedelta, timezone
    from clapcheeks.scoring import _supabase_creds, score_match
    import requests

    try:
        url, key = _supabase_creds()
    except Exception as exc:
        log.debug("rescore: creds unavailable (%s)", exc)
        return

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    params = {
        "user_id": f"eq.{user_id}",
        "scored_at": "not.is.null",
        "updated_at": f"gte.{cutoff}",
        "select": (
            "id,user_id,platform,match_id,match_name,name,age,bio,"
            "photos_jsonb,prompts_jsonb,job,school,instagram_handle,"
            "match_intel,vision_summary,instagram_intel,scored_at,updated_at,"
            "distance_miles"
        ),
        "limit": "50",
    }
    resp = requests.get(
        f"{url}/rest/v1/clapcheeks_matches",
        params=params,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=15,
    )
    if resp.status_code >= 300:
        log.debug("rescore: fetch failed %s", resp.status_code)
        return

    rescored = 0
    for row in resp.json():
        updated = row.get("updated_at")
        scored = row.get("scored_at")
        if not updated or not scored or updated <= scored:
            continue
        try:
            result = score_match(row, persona)
            patch = {
                "location_score": result["location_score"],
                "criteria_score": result["criteria_score"],
                "final_score": result["final_score"],
                "dealbreaker_flags": result["dealbreaker_flags"],
                "scoring_reason": result["scoring_reason"],
                "distance_miles": result["distance_miles"],
                "scored_at": datetime.now(timezone.utc).isoformat(),
            }
            r = requests.patch(
                f"{url}/rest/v1/clapcheeks_matches",
                params={"id": f"eq.{row['id']}"},
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=patch,
                timeout=15,
            )
            if r.status_code < 300:
                rescored += 1
        except Exception as exc:
            log.debug("rescore: row %s failed: %s", row.get("id"), exc)
    if rescored:
        log.info("Rescored %d updated matches", rescored)


def _drip_worker(config: dict, interval_seconds: int = 300) -> None:
    """Evaluate drip rules across all tracked conversations every N seconds.

    Builds a per-platform client map so rule actions can send messages
    directly without requiring a swipe session to be active.
    """
    from clapcheeks.conversation.drip import tick, ensure_rules_file
    from clapcheeks.platforms import get_platform_client

    ensure_rules_file()

    while not _shutdown.is_set():
        try:
            # Build platform clients opportunistically — skip platforms
            # without tokens / drivers to avoid crashes when the user
            # hasn't onboarded one yet.
            platform_clients: dict = {}
            for plat in ("tinder", "hinge", "bumble"):
                try:
                    platform_clients[plat] = get_platform_client(plat, driver=None)
                except Exception as exc:
                    log.debug("drip: skipping %s (%s)", plat, exc)

            stats = tick(platform_clients=platform_clients,
                         dry_run=config.get("dry_run", False))
            if stats.get("fired"):
                log.info("Drip tick: %s", stats)
        except Exception as exc:
            log.error("Drip tick failed: %s", exc)
        _shutdown.wait(interval_seconds)


# PHASE-G — AI-8321 — Supabase-backed follow-up drip state machine.
# Runs alongside the YAML drip engine above (different scope: YAML rules
# operate on local ~/.clapcheeks state; this worker operates on Supabase
# clapcheeks_matches + persona.followup_cadence and handles outcome prompts).
def _followup_drip_worker(config: dict, interval_seconds: int = 900) -> None:
    """Every 15 min: scan clapcheeks_matches, evaluate state, queue drips.

    Cadence is read from persona.followup_cadence; drafts route through
    Phase E's run_pipeline; outcome prompts iMessage Julian at +4h.
    """
    from clapcheeks.followup.drip import scan_and_fire
    from clapcheeks.platforms import get_platform_client

    user_id = (
        config.get("user_id")
        or config.get("clapcheeks_user_id")
        or os.environ.get("CLAPCHEEKS_USER_ID")
    )

    log.info(
        "followup-drip worker started (interval=%ds user=%s)",
        interval_seconds, user_id or "<all>",
    )

    while not _shutdown.is_set():
        try:
            platform_clients: dict = {}
            for plat in ("tinder", "hinge", "bumble"):
                try:
                    platform_clients[plat] = get_platform_client(plat, driver=None)
                except Exception as exc:
                    log.debug("followup-drip: skipping %s (%s)", plat, exc)

            stats = scan_and_fire(
                user_id=user_id,
                platform_clients=platform_clients,
                dry_run=bool(config.get("dry_run", False)),
            )
            if stats.get("fired") or stats.get("errors"):
                log.info("followup-drip tick: %s", stats)
            else:
                log.debug("followup-drip tick: %s", stats)
        except Exception as exc:
            log.error("followup-drip tick failed: %s", exc)
        _shutdown.wait(interval_seconds)


# ---------------------------------------------------------------------------
# Phase B: Photo vision worker (AI-8316)
# ---------------------------------------------------------------------------

def _vision_existing_hashes(match_id: str) -> dict:
    """Fetch existing photo_hash -> tag dict rows for ``match_id``.

    Returns {} if the table/columns are missing (pre-migration).
    """
    from clapcheeks.scoring import _supabase_creds
    import requests

    try:
        url, key = _supabase_creds()
    except Exception as exc:
        log.debug("vision: creds unavailable (%s)", exc)
        return {}

    try:
        resp = requests.get(
            f"{url}/rest/v1/clapcheeks_photo_scores",
            params={
                "match_id": f"eq.{match_id}",
                "select": (
                    "photo_hash,activities,locations,food_signals,"
                    "aesthetic,energy,solo_vs_group,travel_signals,"
                    "notable_details"
                ),
                "limit": "100",
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
    except Exception as exc:
        log.debug("vision: existing-hash fetch failed (%s)", exc)
        return {}

    if resp.status_code >= 300:
        log.debug("vision: existing-hash fetch status %s", resp.status_code)
        return {}

    out: dict = {}
    try:
        for row in resp.json():
            h = row.get("photo_hash")
            if h:
                out[h] = row
    except Exception:
        return {}
    return out


def _vision_upsert_photo_score(
    match_id: str,
    user_id: str,
    photo_url: str,
    tags: dict,
    cost_usd: float,
) -> bool:
    """Upsert one row into clapcheeks_photo_scores keyed on (match_id, photo_hash)."""
    from clapcheeks.scoring import _supabase_creds
    from clapcheeks.photos.vision import VISION_MODEL, photo_hash
    import requests

    try:
        url, key = _supabase_creds()
    except Exception as exc:
        log.debug("vision: creds unavailable (%s)", exc)
        return False

    payload = {
        "match_id": match_id,
        "user_id": user_id,
        "photo_url": photo_url,
        "photo_hash": photo_hash(photo_url),
        "activities": tags.get("activities", []),
        "locations": tags.get("locations", []),
        "food_signals": tags.get("food_signals", []),
        "aesthetic": tags.get("aesthetic"),
        "energy": tags.get("energy"),
        "solo_vs_group": tags.get("solo_vs_group"),
        "travel_signals": tags.get("travel_signals", []),
        "notable_details": tags.get("notable_details", []),
        "vision_model": VISION_MODEL,
        "cost_usd": cost_usd,
    }

    try:
        r = requests.post(
            f"{url}/rest/v1/clapcheeks_photo_scores",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            params={"on_conflict": "match_id,photo_hash"},
            json=payload,
            timeout=15,
        )
    except Exception as exc:
        log.warning("vision: upsert failed (%s)", exc)
        return False

    if r.status_code >= 300:
        log.warning(
            "vision: upsert photo_score failed: %s %s",
            r.status_code, r.text[:200] if hasattr(r, "text") else "",
        )
        return False
    return True


def _vision_write_summary(match_id: str, summary: str) -> bool:
    """PATCH clapcheeks_matches.vision_summary for ``match_id``.

    Also bumps updated_at by re-setting the column so the Phase I
    rescore poller picks it up.
    """
    from clapcheeks.scoring import _supabase_creds
    from datetime import datetime, timezone
    import requests

    try:
        url, key = _supabase_creds()
    except Exception as exc:
        log.debug("vision: creds unavailable (%s)", exc)
        return False

    patch = {
        "vision_summary": summary,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

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
        log.warning("vision: summary patch failed (%s)", exc)
        return False

    if r.status_code >= 300:
        log.warning("vision: summary patch status %s", r.status_code)
        return False
    return True


def _log_vision_spending(user_id: str, cost_usd: float, n_photos: int) -> None:
    """Best-effort insert into clapcheeks_spending. Failures are swallowed."""
    if cost_usd <= 0 or n_photos <= 0:
        return

    from clapcheeks.scoring import _supabase_creds
    from datetime import date
    import requests

    try:
        url, key = _supabase_creds()
    except Exception:
        return

    payload = {
        "user_id": user_id,
        "date": date.today().isoformat(),
        "category": "subscriptions",
        "amount": cost_usd,
        "notes": f"phase-b vision: {n_photos} photos",
    }
    try:
        requests.post(
            f"{url}/rest/v1/clapcheeks_spending",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=payload,
            timeout=10,
        )
    except Exception:
        pass


def _process_match_vision(match_row: dict) -> bool:
    """Analyze every photo on ``match_row`` and write the aggregate summary.

    Returns True if the match was processed (even if nothing changed),
    False if it was skipped (no photos, missing fields, etc.).
    """
    from clapcheeks.photos.vision import (
        analyze_photos_batch,
        aggregate_vision,
        estimate_cost_usd,
        photo_hash,
        EMPTY_TAGS,
    )

    match_id = match_row.get("id")
    user_id = match_row.get("user_id")
    if not match_id or not user_id:
        return False

    photos = match_row.get("photos_jsonb") or []
    if isinstance(photos, str):
        try:
            import json as _json
            photos = _json.loads(photos)
        except Exception:
            photos = []

    if not photos:
        return False

    # Pull out URLs (photos_jsonb entries look like {"url": "...",
    # "supabase_path": "...", ...}).
    urls: list[str] = []
    for p in photos:
        if isinstance(p, dict):
            u = p.get("url") or p.get("supabase_url")
            if u:
                urls.append(u)
        elif isinstance(p, str):
            urls.append(p)

    if not urls:
        return False

    # Dedupe: if a photo_hash row already exists, reuse its tags instead
    # of re-calling Claude.
    existing = _vision_existing_hashes(match_id)

    to_analyze: list[str] = []
    reused_tags: dict[str, dict] = {}
    for u in urls:
        h = photo_hash(u)
        if h in existing:
            reused_tags[u] = {
                k: existing[h].get(k, EMPTY_TAGS[k]) for k in EMPTY_TAGS.keys()
            }
        else:
            to_analyze.append(u)

    # Call Claude Vision for new photos only
    if to_analyze:
        results = analyze_photos_batch(to_analyze)
    else:
        results = []

    # Map URL -> tags (reused + new)
    url_to_tags: dict[str, dict] = dict(reused_tags)
    for u, tags in zip(to_analyze, results):
        url_to_tags[u] = tags

    # Upsert new rows (don't re-upsert cached ones — they're already there)
    cost = estimate_cost_usd(len(to_analyze))
    per_photo_cost = cost / len(to_analyze) if to_analyze else 0.0
    for u, tags in zip(to_analyze, results):
        _vision_upsert_photo_score(match_id, user_id, u, tags, per_photo_cost)

    # Aggregate across ALL photos (reused + new) for the summary
    all_tags = [url_to_tags[u] for u in urls if u in url_to_tags]
    summary = aggregate_vision(all_tags)

    _vision_write_summary(match_id, summary)

    if to_analyze:
        _log_vision_spending(user_id, cost, len(to_analyze))
        log.info(
            "vision: match=%s analyzed=%d reused=%d cost=$%.4f summary=%r",
            match_id, len(to_analyze), len(reused_tags), cost, summary[:80],
        )
    else:
        log.info(
            "vision: match=%s all photos cached, rebuilt summary only",
            match_id,
        )
    return True


def _vision_worker(interval_seconds: int = 600) -> None:
    """Phase B vision worker — analyze photos on unsummarized matches.

    Every ``interval_seconds`` (default 10min), find matches where
    ``vision_summary IS NULL`` and ``photos_jsonb != '[]'`` and batch up
    to 5 per tick. Each match's photos are chunked 3-per Claude call.

    Cost cap: ~$0.003/photo * up to 8 photos * 5 matches = $0.12/tick.
    """
    from clapcheeks.scoring import _supabase_creds
    import requests

    log.info("vision worker started (interval=%ds)", interval_seconds)

    while not _shutdown.is_set():
        try:
            try:
                url, key = _supabase_creds()
            except Exception as exc:
                log.debug("vision worker: creds unavailable (%s)", exc)
                _shutdown.wait(interval_seconds)
                continue

            resp = requests.get(
                f"{url}/rest/v1/clapcheeks_matches",
                params={
                    "vision_summary": "is.null",
                    "photos_jsonb": "not.eq.%5B%5D",
                    "select": "id,user_id,photos_jsonb",
                    "limit": "5",
                    "order": "created_at.desc",
                },
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                timeout=15,
            )
            if resp.status_code >= 300:
                log.warning(
                    "vision worker: match fetch status %s", resp.status_code
                )
                _shutdown.wait(interval_seconds)
                continue

            matches = resp.json()
            processed = 0
            for m in matches:
                if _shutdown.is_set():
                    break
                try:
                    if _process_match_vision(m):
                        processed += 1
                except Exception as exc:
                    log.error(
                        "vision worker: match %s failed (%s)",
                        m.get("id"), exc,
                    )
            if processed:
                log.info("vision worker tick: processed=%d", processed)
        except Exception as exc:
            log.error("vision worker tick failed: %s", exc)

        _shutdown.wait(interval_seconds)


def _platform_worker(
    platform: str,
    config: dict,
    daemon_cfg: dict,
    emitter: EventEmitter | None = None,
) -> None:
    """Run swipe + conversation loop for a single platform on a timer."""
    from clapcheeks.session.manager import SessionManager
    from clapcheeks.conversation.manager import ConversationManager

    ban_detector = BanDetector()
    interval_sec = daemon_cfg["swipe_interval_hours"] * 3600
    active_hours = daemon_cfg.get("active_hours", [9, 23])
    converse_after = daemon_cfg.get("conversation_after_swipe", True)

    log.info("Platform thread started: %s (every %dh, active %s)",
             platform, daemon_cfg["swipe_interval_hours"], active_hours)

    while not _shutdown.is_set():
        # Gate on active hours
        if not _in_active_hours(active_hours):
            log.info("[%s] Outside active hours %s, sleeping 15m", platform, active_hours)
            _shutdown.wait(900)
            continue

        # --- Ban check ---
        if ban_detector.is_paused(platform):
            reason = ban_detector.get_pause_reason(platform)
            log.warning("[%s] Platform paused: %s", platform, reason)
            if not ban_detector.auto_resume_check(platform):
                _shutdown.wait(3600)  # check again in 1 hour
                continue

        # --- Swipe session ---
        swipe_result = {}
        try:
            from clapcheeks.platforms import get_platform_client
            session_mgr = SessionManager(config)
            driver = session_mgr.get_driver(platform)
            client = get_platform_client(
                platform,
                driver=driver,
                ai_service_url=config.get("ai_service_url"),
            )

            log.info("[%s] Starting swipe session", platform)
            swipe_result = client.run_swipe_session()
            log.info("[%s] Swipe result: %s", platform, swipe_result)

            # --- Ban detection on session result ---
            ban_status = ban_detector.check_session_result(platform, swipe_result)
            if ban_status.value in ("soft_ban", "hard_ban"):
                log.warning("[%s] Ban signal detected: %s", platform, ban_status.value)
                if emitter:
                    emitter.ban_detected(platform, ban_status.value)

            # Emit session_complete event
            if emitter and swipe_result:
                emitter.session_complete(platform, swipe_result)

            # --- Conversation loop ---
            if converse_after and ban_status.value not in ("soft_ban", "hard_ban"):
                log.info("[%s] Running conversation loop", platform)
                cm = ConversationManager(client, platform, config)
                convo_result = cm.run_loop()
                log.info("[%s] Conversation result: %s", platform, convo_result)

                # Emit events for conversation results
                if emitter and convo_result:
                    for _ in range(convo_result.get("openers_sent", 0)):
                        emitter.opener_sent(platform, "match", "")
                    if convo_result.get("dates_proposed", 0) > 0:
                        emitter.date_booked(platform, "match", "")

                # --- Re-engagement pass (once per 23h per platform) ---
                now = time.time()
                if now - _last_reengagement.get(platform, 0) > 23 * 3600:
                    result = cm.run_reengagement()
                    log.info("[%s] Re-engagement: %s", platform, result)
                    _last_reengagement[platform] = now

            session_mgr.close_all()
        except Exception as exc:
            log.error("[%s] Session failed: %s", platform, exc)
            record_worker_crash(platform)

        # Sleep until next session (check shutdown every second via Event.wait)
        _shutdown.wait(interval_sec)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_daemon() -> None:
    """Main daemon entry point — launches all scheduling threads."""
    _setup_logging()
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    validate_env()

    token = get_agent_token()
    if not token:
        log.error("No agent token found. Run 'clapcheeks setup' first.")
        sys.exit(1)

    config = load()
    api_url = config.get("api_url", "https://api.clapcheeks.tech")
    daemon_cfg = _get_daemon_config(config)

    platforms = daemon_cfg["platforms"]
    sync_interval = daemon_cfg["sync_interval_minutes"]

    log.info("Daemon starting — platforms=%s, swipe_interval=%dh, "
             "active_hours=%s, sync_interval=%dm",
             platforms, daemon_cfg["swipe_interval_hours"],
             daemon_cfg["active_hours"], sync_interval)

    # Initialize event emitter for push notifications
    emitter = EventEmitter(api_url, token)

    threads: list[threading.Thread] = []

    # Heartbeat thread
    t = threading.Thread(
        target=_heartbeat_worker,
        args=(api_url, token),
        name="heartbeat",
        daemon=True,
    )
    t.start()
    threads.append(t)

    # Sync thread
    t = threading.Thread(
        target=_sync_worker,
        args=(config, sync_interval),
        name="sync",
        daemon=True,
    )
    t.start()
    threads.append(t)

    # Drip engine thread — fires follow-ups, reengagement, and stage archives
    drip_interval = int(daemon_cfg.get("drip_interval_seconds", 300))
    t = threading.Thread(
        target=_drip_worker,
        args=(config, drip_interval),
        name="drip",
        daemon=True,
    )
    t.start()
    threads.append(t)

    # PHASE-G — AI-8321 — Supabase follow-up drip daemon (state-machine).
    followup_interval = int(
        daemon_cfg.get("followup_drip_interval_seconds", 900)
    )
    t = threading.Thread(
        target=_followup_drip_worker,
        args=(config, followup_interval),
        name="followup-drip",
        daemon=True,
    )
    t.start()
    threads.append(t)

    # Match-intake thread (Phase A - AI-8315). Tightened to 30 min on
    # 2026-04-20 after anti-bot trip. See AI-8345 for proper fix.
    match_sync_interval = int(daemon_cfg.get("match_sync_interval_minutes", 30))
    t = threading.Thread(
        target=_match_sync_worker,
        args=(match_sync_interval,),
        name="match-sync",
        daemon=True,
    )
    t.start()
    threads.append(t)

    # Scoring thread (Phase I - AI-8323) — scores every new match against
    # persona ranking_weights, and re-scores matches whose vision_summary
    # changed.
    scoring_interval = int(daemon_cfg.get("scoring_interval_seconds", 300))
    t = threading.Thread(
        target=_scoring_worker,
        args=(config, scoring_interval),
        name="scoring",
        daemon=True,
    )
    t.start()
    threads.append(t)

    # Vision thread (Phase B - AI-8316) — analyzes photos on new matches
    # with Claude Vision and writes vision_summary. Phase I's rescore
    # poller picks up the updated_at bump and re-scores the match.
    vision_interval = int(daemon_cfg.get("vision_interval_seconds", 600))
    t = threading.Thread(
        target=_vision_worker,
        args=(vision_interval,),
        name="vision",
        daemon=True,
    )
    t.start()
    threads.append(t)

    # Instagram enrichment thread (Phase C - AI-8317). Drives her public
    # feed through the Phase M extension-routed job queue so the VPS
    # never hits instagram.com directly.
    ig_enrich_interval = int(
        daemon_cfg.get("ig_enrich_interval_seconds", 900)
    )
    t = threading.Thread(
        target=_ig_enrich_worker_thread,
        args=(ig_enrich_interval,),
        name="ig-enrich",
        daemon=True,
    )
    t.start()
    threads.append(t)

    # Per-platform threads
    for platform in platforms:
        if platform not in PLATFORM_CLIENTS:
            log.warning("Unknown platform '%s', skipping", platform)
            continue
        t = threading.Thread(
            target=_platform_worker,
            args=(platform, config, daemon_cfg, emitter),
            name=f"platform-{platform}",
            daemon=True,
        )
        t.start()
        threads.append(t)

    log.info("Daemon started — %d threads running", len(threads))

    # Block main thread until shutdown signal
    try:
        while not _shutdown.is_set():
            _shutdown.wait(1)
    except KeyboardInterrupt:
        _shutdown.set()

    log.info("Shutdown signal received, waiting for threads to finish...")

    # Give threads up to 10 seconds to wrap up
    for t in threads:
        t.join(timeout=10)

    log.info("Daemon stopped")


def _run_single_task(task: str) -> int:
    """Run a single task once and return an exit code.

    Used by `python -m clapcheeks.daemon --task <task> --once` for ops,
    testing, and CI. Doesn't start the full scheduler.
    """
    _setup_logging()
    if task == "sync_matches":
        from clapcheeks.match_sync import sync_matches
        summary = sync_matches(once=True)
        log.info("sync_matches one-shot summary: %s", summary)
        if summary.get("errors") and summary.get("upserted", 0) == 0:
            return 2
        return 0
    if task == "sync":
        from clapcheeks.sync import pull_platform_tokens
        n = pull_platform_tokens()
        log.info("pull_platform_tokens: %d updated", n)
        return 0
    log.error("Unknown --task: %s", task)
    return 1


def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(prog="clapcheeks.daemon")
    parser.add_argument(
        "--task",
        default=None,
        help="Run a single task once and exit (e.g. sync_matches).",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="When --task is set, run it once and exit.",
    )
    args = parser.parse_args()

    if args.task:
        rc = _run_single_task(args.task)
        sys.exit(rc)

    run_daemon()


if __name__ == "__main__":
    _main()
