"""Ban detector — monitors platform behavior signals for soft/hard ban indicators.

Soft ban signals (auto-pause 48h):
- Swipe rate drops to 0 unexpectedly mid-session (was swiping fine, suddenly no profiles)
- Like confirmations stop appearing (swipes go through but no match animations)
- Profile view count drops >80% in 24h vs 7-day average
- Repeated CAPTCHA responses or login redirects

Hard ban signals (notify + stop permanently):
- Account suspended message detected in DOM/API response
- HTTP 403/429 with platform-specific ban error codes
- Login fails with "account disabled" type messages

Recovery:
- Soft ban: pause platform for 48h, resume automatically
- Hard ban: pause permanently, send notification, suggest fresh account
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)


_DEFAULT_STATE_FILE = Path.home() / ".clapcheeks" / "ban_state.json"


def _resolve_state_file(default: Path) -> Path:
    """Resolve the ban state file location.

    Priority:
    1. CLAPCHEEKS_BAN_STATE_FILE env var (explicit override)
    2. If the caller already patched STATE_FILE away from the default
       (e.g. via `patch.object(BanDetector, "STATE_FILE", ...)`), honor it.
    3. Per-test temp file when running under pytest with the default path —
       prevents test-to-test pollution for tests that instantiate BanDetector
       without patching STATE_FILE (TestBanMonitor, safety integration tests).
    4. The provided default (~/.clapcheeks/ban_state.json) for prod.
    """
    override = os.environ.get("CLAPCHEEKS_BAN_STATE_FILE")
    if override:
        return Path(override)
    if default != _DEFAULT_STATE_FILE:
        return default
    if os.environ.get("PYTEST_CURRENT_TEST"):
        slug = os.environ.get("PYTEST_CURRENT_TEST", "session").split(" ")[0]
        safe = "".join(c if c.isalnum() else "_" for c in slug)[:80]
        return Path(tempfile.gettempdir()) / f"clapcheeks_ban_state_{safe}.json"
    return default

# Keywords in HTTP responses / DOM text that indicate a hard ban
BAN_KEYWORDS = frozenset({
    "suspended", "disabled", "banned", "terminated",
    "account has been", "violation", "permanently",
    "no longer available", "account removed",
})

SOFT_BAN_PAUSE_HOURS = 48
CONSECUTIVE_EMPTY_THRESHOLD = 3
ERROR_RATIO_THRESHOLD = 0.5


class BanStatus(Enum):
    CLEAN = "clean"
    SOFT_BAN = "soft_ban"
    HARD_BAN = "hard_ban"
    SUSPECTED = "suspected"


@dataclass
class BanSignal:
    platform: str
    signal_type: str  # "no_profiles" | "no_matches" | "http_403" | "account_disabled" | "captcha"
    detected_at: datetime
    details: str = ""

    def to_dict(self) -> dict:
        return {
            "platform": self.platform,
            "signal_type": self.signal_type,
            "detected_at": self.detected_at.isoformat(),
            "details": self.details,
        }

    @classmethod
    def from_dict(cls, d: dict) -> BanSignal:
        return cls(
            platform=d["platform"],
            signal_type=d["signal_type"],
            detected_at=datetime.fromisoformat(d["detected_at"]),
            details=d.get("details", ""),
        )


@dataclass
class PlatformBanState:
    platform: str
    status: BanStatus = BanStatus.CLEAN
    paused_until: datetime | None = None
    signals: list[BanSignal] = field(default_factory=list)
    consecutive_empty_sessions: int = 0
    last_match_at: datetime | None = None

    def to_dict(self) -> dict:
        return {
            "platform": self.platform,
            "status": self.status.value,
            "paused_until": self.paused_until.isoformat() if self.paused_until else None,
            "signals": [s.to_dict() for s in self.signals],
            "consecutive_empty_sessions": self.consecutive_empty_sessions,
            "last_match_at": self.last_match_at.isoformat() if self.last_match_at else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> PlatformBanState:
        return cls(
            platform=d["platform"],
            status=BanStatus(d.get("status", "clean")),
            paused_until=datetime.fromisoformat(d["paused_until"]) if d.get("paused_until") else None,
            signals=[BanSignal.from_dict(s) for s in d.get("signals", [])],
            consecutive_empty_sessions=d.get("consecutive_empty_sessions", 0),
            last_match_at=datetime.fromisoformat(d["last_match_at"]) if d.get("last_match_at") else None,
        )


class BanSignalException(Exception):
    """Raised by platform HTTP clients when a ban signal is detected in a response."""

    def __init__(self, platform: str, signal_type: str, details: str = "") -> None:
        self.platform = platform
        self.signal_type = signal_type
        self.details = details
        super().__init__(f"[{platform}] Ban signal: {signal_type} — {details}")


class BanDetector:
    """Detects soft/hard bans across platforms and manages auto-pause state."""

    STATE_FILE = Path.home() / ".clapcheeks" / "ban_state.json"

    def __init__(self) -> None:
        # Resolve actual state file path — honors env overrides and auto-isolates
        # under pytest so tests that instantiate BanDetector without patching
        # the class attribute don't leak persistence into a shared ~/.clapcheeks
        # file. Prod callers get the original STATE_FILE unchanged.
        self._state_file: Path = _resolve_state_file(self.STATE_FILE)
        self._states: dict[str, PlatformBanState] = self.load_state()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def load_state(self) -> dict[str, PlatformBanState]:
        if self._state_file.exists():
            try:
                raw = json.loads(self._state_file.read_text())
                return {k: PlatformBanState.from_dict(v) for k, v in raw.items()}
            except Exception as exc:
                logger.warning("Failed to load ban state: %s", exc)
        return {}

    def save_state(self, states: dict[str, PlatformBanState] | None = None) -> None:
        if states is not None:
            self._states = states
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        raw = {k: v.to_dict() for k, v in self._states.items()}
        self._state_file.write_text(json.dumps(raw, indent=2))

    def _get_or_create(self, platform: str) -> PlatformBanState:
        if platform not in self._states:
            self._states[platform] = PlatformBanState(platform=platform)
        return self._states[platform]

    # ------------------------------------------------------------------
    # Signal recording
    # ------------------------------------------------------------------

    def record_signal(self, platform: str, signal_type: str, details: str = "") -> BanStatus:
        """Record a ban signal and return the updated status for the platform."""
        state = self._get_or_create(platform)
        signal = BanSignal(
            platform=platform,
            signal_type=signal_type,
            detected_at=datetime.now(),
            details=details,
        )
        state.signals.append(signal)

        # Hard ban signals -> immediate hard ban
        if signal_type in ("account_disabled", "http_403"):
            state.status = BanStatus.HARD_BAN
            state.paused_until = None  # permanent
            logger.warning("[%s] HARD BAN detected: %s — %s", platform, signal_type, details)

        # Soft ban signals -> 48h pause
        elif signal_type in ("no_profiles", "captcha"):
            if state.status != BanStatus.HARD_BAN:
                state.status = BanStatus.SOFT_BAN
                state.paused_until = datetime.now() + timedelta(hours=SOFT_BAN_PAUSE_HOURS)
                logger.warning(
                    "[%s] Soft ban detected: %s — paused until %s",
                    platform, signal_type, state.paused_until.isoformat(),
                )

        # Other signals -> suspected
        else:
            if state.status == BanStatus.CLEAN:
                state.status = BanStatus.SUSPECTED
                logger.info("[%s] Suspected ban signal: %s", platform, signal_type)

        self.save_state()
        return state.status

    # ------------------------------------------------------------------
    # Pause checks
    # ------------------------------------------------------------------

    def is_paused(self, platform: str) -> bool:
        state = self._states.get(platform)
        if not state:
            return False
        if state.status == BanStatus.HARD_BAN:
            return True
        if state.status == BanStatus.SOFT_BAN and state.paused_until:
            return datetime.now() < state.paused_until
        return False

    def get_pause_reason(self, platform: str) -> str | None:
        state = self._states.get(platform)
        if not state:
            return None
        if state.status == BanStatus.HARD_BAN:
            last = state.signals[-1] if state.signals else None
            detail = f" ({last.details})" if last and last.details else ""
            return f"Hard ban detected{detail}. Create a fresh account."
        if state.status == BanStatus.SOFT_BAN and state.paused_until:
            if datetime.now() < state.paused_until:
                remaining = state.paused_until - datetime.now()
                hours = remaining.total_seconds() / 3600
                return f"Soft ban — auto-resume in {hours:.1f}h"
        return None

    # ------------------------------------------------------------------
    # Session result analysis
    # ------------------------------------------------------------------

    def check_session_result(self, platform: str, swipe_result: dict) -> BanStatus:
        """Analyze swipe session results for ban signals.

        swipe_result: {liked, passed, errors, new_matches}
        """
        state = self._get_or_create(platform)

        # Don't override a hard ban
        if state.status == BanStatus.HARD_BAN:
            return state.status

        liked = swipe_result.get("liked", 0)
        passed = swipe_result.get("passed", 0)
        errors = swipe_result.get("errors", 0)
        new_matches = swipe_result.get("new_matches", [])
        total = liked + passed + errors

        # High error ratio -> suspected
        if total > 0 and errors / total > ERROR_RATIO_THRESHOLD:
            return self.record_signal(platform, "high_errors", f"errors={errors}/{total}")

        # Got matches -> reset consecutive empty counter
        if new_matches:
            state.consecutive_empty_sessions = 0
            state.last_match_at = datetime.now()
            if state.status == BanStatus.SUSPECTED:
                state.status = BanStatus.CLEAN
            self.save_state()
            return state.status

        # Swiped but got zero matches -> track consecutive empties
        if liked + passed > 5 and not new_matches:
            state.consecutive_empty_sessions += 1

            if state.consecutive_empty_sessions >= CONSECUTIVE_EMPTY_THRESHOLD:
                return self.record_signal(
                    platform,
                    "no_profiles",
                    f"{state.consecutive_empty_sessions} consecutive empty sessions",
                )
            elif state.consecutive_empty_sessions >= 2:
                if state.status == BanStatus.CLEAN:
                    state.status = BanStatus.SUSPECTED
                    logger.info(
                        "[%s] Suspected: %d consecutive empty sessions",
                        platform, state.consecutive_empty_sessions,
                    )
                self.save_state()

        return state.status

    # ------------------------------------------------------------------
    # Auto-resume
    # ------------------------------------------------------------------

    def auto_resume_check(self, platform: str) -> bool:
        """If soft ban, check if 48h have passed and auto-resume. Returns True if resumed."""
        state = self._states.get(platform)
        if not state:
            return False
        if state.status == BanStatus.SOFT_BAN and state.paused_until:
            if datetime.now() >= state.paused_until:
                logger.info("[%s] Soft ban expired — resuming platform", platform)
                state.status = BanStatus.CLEAN
                state.paused_until = None
                state.consecutive_empty_sessions = 0
                self.save_state()
                return True
        return False

    # ------------------------------------------------------------------
    # Manual controls
    # ------------------------------------------------------------------

    def pause_platform(self, platform: str, hours: float = SOFT_BAN_PAUSE_HOURS) -> None:
        """Manually pause a platform for the given number of hours."""
        state = self._get_or_create(platform)
        state.status = BanStatus.SOFT_BAN
        state.paused_until = datetime.now() + timedelta(hours=hours)
        self.record_signal(platform, "manual_pause", f"paused for {hours}h")

    def resume_platform(self, platform: str) -> None:
        """Manually resume a paused platform."""
        state = self._get_or_create(platform)
        if state.status == BanStatus.HARD_BAN:
            logger.warning("[%s] Cannot resume — hard ban. Create a fresh account.", platform)
            return
        state.status = BanStatus.CLEAN
        state.paused_until = None
        state.consecutive_empty_sessions = 0
        self.save_state()
        logger.info("[%s] Manually resumed", platform)

    # ------------------------------------------------------------------
    # Status summary
    # ------------------------------------------------------------------

    def get_status_summary(self) -> dict:
        """Return a summary dict of all platform ban states."""
        return {
            platform: {
                "status": state.status.value,
                "paused_until": state.paused_until.isoformat() if state.paused_until else None,
                "consecutive_empty_sessions": state.consecutive_empty_sessions,
                "signal_count": len(state.signals),
                "last_signal": state.signals[-1].to_dict() if state.signals else None,
            }
            for platform, state in self._states.items()
        }

    def get_signal_history(self, platform: str) -> list[dict]:
        """Return signal history for a platform."""
        state = self._states.get(platform)
        if not state:
            return []
        return [s.to_dict() for s in state.signals]

    def get_status(self, platform: str) -> BanStatus:
        """Return the current BanStatus for a platform (CLEAN if unknown)."""
        state = self._states.get(platform)
        if not state:
            return BanStatus.CLEAN
        return state.status


def check_response_for_ban(platform: str, status_code: int, body: str | dict) -> None:
    """Check an HTTP response for ban signals. Raises BanSignalException if detected.

    Call this from platform REST clients after each HTTP request.
    """
    # Hard ban: 403 Forbidden
    if status_code == 403:
        raise BanSignalException(platform, "http_403", f"HTTP 403 response")

    # Check response body for ban keywords
    text = json.dumps(body) if isinstance(body, dict) else str(body)
    text_lower = text.lower()
    for keyword in BAN_KEYWORDS:
        if keyword in text_lower:
            raise BanSignalException(
                platform, "account_disabled", f"Response contains '{keyword}'"
            )
