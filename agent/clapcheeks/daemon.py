"""Background agent daemon — full scheduling engine.

Manages per-platform swipe sessions, conversation loops, metric sync,
and heartbeat on independent threads with configurable intervals and
active-hours gating.
"""
import fcntl
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
LOCK_FILE = "/tmp/clapcheeks-daemon.lock"

log = logging.getLogger("clapcheeks.daemon")

# Module-level lock file handle — must remain open for the lifetime of the
# process so the fcntl lock is held. Closing or GC'ing this releases the lock.
_lock_fp = None


def _acquire_singleton_lock() -> None:
    """Acquire fcntl exclusive lock so only one daemon can run at a time.

    Exits process with code 1 if another instance already holds the lock.
    """
    global _lock_fp
    _lock_fp = open(LOCK_FILE, "w")
    try:
        fcntl.flock(_lock_fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (IOError, OSError):
        print(
            "FATAL: another clapcheeks daemon is already running. Exiting.",
            file=sys.stderr,
        )
        sys.exit(1)
    _lock_fp.write(str(os.getpid()))
    _lock_fp.flush()

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

    from clapcheeks.safety.presence import should_be_active

    while not _shutdown.is_set():
        # Gate on active hours
        if not _in_active_hours(active_hours):
            log.info("[%s] Outside active hours %s, sleeping 15m", platform, active_hours)
            _shutdown.wait(900)
            continue

        # --- Presence gate (P5) ---
        # Only run swipe / API loop when operator is home + iPhone present
        # so the dating apps don't fingerprint auto-replies as off-network.
        # iMessage replies are NOT gated by this — they're not fingerprinted.
        active, reason = should_be_active()
        if not active:
            log.info("[%s] Presence gate blocked: %s — sleeping 5m", platform, reason)
            _shutdown.wait(300)
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
    _acquire_singleton_lock()
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

    # Match-intake thread (Phase A - AI-8315)
    match_sync_interval = int(daemon_cfg.get("match_sync_interval_minutes", 10))
    t = threading.Thread(
        target=_match_sync_worker,
        args=(match_sync_interval,),
        name="match-sync",
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
