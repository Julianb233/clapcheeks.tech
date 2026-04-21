"""Emergency stop mechanism — kills all automation within 5 seconds.

The emergency stop can be triggered by:
1. CLI command: `clapcheeks stop`
2. Signal file: touch ~/.clapcheeks/EMERGENCY_STOP
3. API endpoint: POST /agent/emergency-stop
4. Programmatic: EmergencyStop.trigger()

When triggered:
- Sets a process-wide threading.Event
- Writes the stop file so other processes/threads detect it
- Logs the reason and timestamp
- All platform workers check this flag every loop iteration
- Target: full stop within 5 seconds of trigger
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)


def _running_under_pytest() -> bool:
    """True when the current process was launched by pytest (or is inside a
    pytest run). Used to avoid auto-adopting a stale on-disk EMERGENCY_STOP
    file as "already triggered" at module import time — that file is typically
    a leftover from a prior debug session and would block the whole test run.
    """
    return "pytest" in sys.modules or bool(os.environ.get("PYTEST_CURRENT_TEST"))

STOP_FILE = Path.home() / ".clapcheeks" / "EMERGENCY_STOP"
STOP_LOG = Path.home() / ".clapcheeks" / "emergency_stop.log"


class EmergencyStop:
    """Process-wide emergency stop coordinator.

    Usage:
        estop = EmergencyStop()

        # In worker loops:
        while not estop.should_stop():
            do_work()

        # To trigger:
        estop.trigger("Ban detected on all platforms")
    """

    _instance: EmergencyStop | None = None
    _lock = threading.Lock()

    def __new__(cls) -> EmergencyStop:
        """Singleton — one stop flag per process."""
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        self._stop_event = threading.Event()
        self._triggered_at: datetime | None = None
        self._reason: str = ""
        self._callbacks: list[Callable[[], None]] = []
        self._watchdog_thread: threading.Thread | None = None

        # Adopt an existing stop file (from a previous crash or manual trigger),
        # but NOT when running under pytest — a stale ~/.clapcheeks/EMERGENCY_STOP
        # left behind by a prior debug session would latch the test process into
        # a stopped state that fixtures can't recover from (they monkeypatch
        # STOP_FILE *after* the singleton's __init__ has already run).
        if STOP_FILE.exists() and not _running_under_pytest():
            self._stop_event.set()
            self._reason = "Stop file present from previous session"
            self._triggered_at = datetime.now()

    def should_stop(self) -> bool:
        """Check if emergency stop has been triggered.

        Workers should call this at the top of every loop iteration.
        Also checks the filesystem stop file for cross-process coordination.
        """
        if self._stop_event.is_set():
            return True

        # Check filesystem stop file (cross-process)
        if STOP_FILE.exists():
            self._stop_event.set()
            if not self._triggered_at:
                self._triggered_at = datetime.now()
                self._reason = "Stop file detected (external trigger)"
                logger.critical("EMERGENCY STOP: External stop file detected")
            return True

        return False

    def trigger(self, reason: str = "Manual trigger") -> None:
        """Trigger emergency stop across all workers.

        Guarantees:
        - All workers see the stop within 5 seconds (file-based)
        - In-process workers see it immediately (event-based)
        """
        self._stop_event.set()
        self._triggered_at = datetime.now()
        self._reason = reason

        # Write stop file for cross-process coordination
        STOP_FILE.parent.mkdir(parents=True, exist_ok=True)
        stop_data = {
            "triggered_at": self._triggered_at.isoformat(),
            "reason": reason,
            "pid": os.getpid(),
        }
        STOP_FILE.write_text(json.dumps(stop_data, indent=2))

        # Log the emergency stop
        self._log_stop(reason)

        logger.critical("EMERGENCY STOP TRIGGERED: %s", reason)

        # Fire callbacks
        for cb in self._callbacks:
            try:
                cb()
            except Exception as exc:
                logger.error("Emergency stop callback failed: %s", exc)

    def clear(self) -> None:
        """Clear the emergency stop (manual resume after investigation).

        Only call this after confirming the issue that triggered the stop
        has been resolved.
        """
        self._stop_event.clear()
        self._triggered_at = None
        self._reason = ""

        if STOP_FILE.exists():
            STOP_FILE.unlink()

        logger.info("Emergency stop cleared — automation can resume")

    def register_callback(self, callback: Callable[[], None]) -> None:
        """Register a callback to be fired when emergency stop is triggered.

        Use this to close browser sessions, flush logs, etc.
        """
        self._callbacks.append(callback)

    def start_file_watchdog(self, poll_interval: float = 1.0) -> None:
        """Start a background thread that monitors the stop file.

        This ensures the stop is detected within `poll_interval` seconds
        even if trigger() was called from a different process.
        """
        if self._watchdog_thread and self._watchdog_thread.is_alive():
            return

        def _watch():
            while not self._stop_event.is_set():
                if STOP_FILE.exists() and not self._stop_event.is_set():
                    try:
                        data = json.loads(STOP_FILE.read_text())
                        reason = data.get("reason", "External trigger")
                    except Exception:
                        reason = "External trigger (unreadable stop file)"
                    self._stop_event.set()
                    self._triggered_at = datetime.now()
                    self._reason = reason
                    logger.critical("EMERGENCY STOP detected via watchdog: %s", reason)
                    for cb in self._callbacks:
                        try:
                            cb()
                        except Exception:
                            pass
                    break
                time.sleep(poll_interval)

        self._watchdog_thread = threading.Thread(
            target=_watch, name="estop-watchdog", daemon=True
        )
        self._watchdog_thread.start()

    @property
    def is_stopped(self) -> bool:
        return self._stop_event.is_set()

    @property
    def triggered_at(self) -> datetime | None:
        return self._triggered_at

    @property
    def reason(self) -> str:
        return self._reason

    def status(self) -> dict:
        """Return current stop status as a dict."""
        return {
            "stopped": self.is_stopped,
            "triggered_at": self._triggered_at.isoformat() if self._triggered_at else None,
            "reason": self._reason,
            "stop_file_exists": STOP_FILE.exists(),
        }

    def _log_stop(self, reason: str) -> None:
        """Append to the emergency stop log."""
        STOP_LOG.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "timestamp": datetime.now().isoformat(),
            "reason": reason,
            "pid": os.getpid(),
        }
        with open(STOP_LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")


# Module-level singleton for convenience
emergency_stop = EmergencyStop()


def trigger_emergency_stop(reason: str = "Manual trigger") -> None:
    """Module-level helper to trigger emergency stop."""
    emergency_stop.trigger(reason)


def clear_emergency_stop() -> None:
    """Module-level helper to clear emergency stop."""
    emergency_stop.clear()
