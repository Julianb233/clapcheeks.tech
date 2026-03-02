"""Background agent daemon — heartbeat loop with graceful shutdown."""
import logging
import signal
import sys
import time

import requests

from clapcheeks.config import load, get_agent_token, CONFIG_DIR

LOG_FILE = CONFIG_DIR / "daemon.log"

log = logging.getLogger("clapcheeks.daemon")


def _setup_logging() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=str(LOG_FILE),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

_shutdown = False


def _handle_sigterm(signum, frame):
    global _shutdown
    log.info("Received SIGTERM, shutting down gracefully")
    _shutdown = True


def run_daemon() -> None:
    """Main daemon entry point — sends heartbeats every 60 seconds."""
    _setup_logging()
    signal.signal(signal.SIGTERM, _handle_sigterm)

    token = get_agent_token()
    if not token:
        log.error("No agent token found. Run 'clapcheeks setup' first.")
        sys.exit(1)

    config = load()
    api_url = config.get("api_url", "https://api.clapcheeks.tech")
    heartbeat_url = f"{api_url}/agent/heartbeat"

    log.info("Daemon started")

    while not _shutdown:
        try:
            resp = requests.post(
                heartbeat_url,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            log.info("Heartbeat sent (HTTP %d)", resp.status_code)
        except requests.RequestException as exc:
            log.warning("Heartbeat failed: %s", exc)

        for _ in range(60):
            if _shutdown:
                break
            time.sleep(1)

    log.info("Daemon stopped")


if __name__ == "__main__":
    run_daemon()
