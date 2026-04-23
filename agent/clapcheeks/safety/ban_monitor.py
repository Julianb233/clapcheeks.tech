"""Ban monitor — enhanced ban detection that integrates with the existing BanDetector.

Adds:
- Cross-platform correlation (if Match Group bans one, check others)
- Response body deep inspection (JSON error codes, not just keywords)
- Fingerprint rotation triggers (when to switch proxy/device ID)
- Notification integration (push ban alerts to dashboard)
- Historical trend analysis (are bans becoming more frequent?)
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from clapcheeks.session.ban_detector import (
    BanDetector,
    BanStatus,
    BanSignalException,
)
from clapcheeks.safety.emergency_stop import emergency_stop

logger = logging.getLogger(__name__)

# Severity ordering for BanStatus. Higher = worse. Used to take the max
# severity across independent signals in a single API response without
# relying on alphabetical comparison of enum .value strings (which would
# put "hard_ban" < "suspected" by accident).
_BAN_STATUS_SEVERITY: dict[BanStatus, int] = {
    BanStatus.CLEAN: 0,
    BanStatus.SUSPECTED: 1,
    BanStatus.SOFT_BAN: 2,
    BanStatus.HARD_BAN: 3,
}


def _worse(a: BanStatus, b: BanStatus) -> bool:
    """Return True when `a` is a more severe ban status than `b`."""
    return _BAN_STATUS_SEVERITY.get(a, 0) > _BAN_STATUS_SEVERITY.get(b, 0)


# Platform family grouping — same corporate owner shares ban signals
PLATFORM_FAMILIES: dict[str, list[str]] = {
    "match_group": ["tinder", "hinge", "okcupid", "pof"],
    "bumble_inc": ["bumble", "badoo"],
    "independent": ["grindr", "happn", "feeld", "cmb"],
}

# Reverse mapping: platform -> family
PLATFORM_TO_FAMILY: dict[str, str] = {}
for family, platforms in PLATFORM_FAMILIES.items():
    for p in platforms:
        PLATFORM_TO_FAMILY[p] = family

# Platform-specific HTTP error codes that indicate bans
PLATFORM_BAN_CODES: dict[str, dict[int, str]] = {
    "tinder": {
        403: "Account banned or token revoked",
        401: "Auth token expired (may indicate shadow-ban)",
        429: "Rate limited — slow down",
    },
    "hinge": {
        403: "Account disabled",
        429: "Too many requests",
        451: "Account under review (legal hold)",
    },
    "bumble": {
        403: "Account blocked",
        429: "Rate limited",
    },
}

# JSON response patterns that indicate bans (deep inspection)
RESPONSE_PATTERNS: list[dict[str, Any]] = [
    {
        "platform": "tinder",
        "field_path": "error.code",
        "value": 40303,
        "signal": "hard_ban",
        "description": "Tinder permanent ban code",
    },
    {
        "platform": "tinder",
        "field_path": "error.code",
        "value": 40316,
        "signal": "rate_limited",
        "description": "Tinder rate limit code",
    },
    {
        "platform": "hinge",
        "field_path": "status",
        "value": "disabled",
        "signal": "hard_ban",
        "description": "Hinge account disabled",
    },
    {
        "platform": "bumble",
        "field_path": "error_type",
        "value": "USER_BLOCKED",
        "signal": "hard_ban",
        "description": "Bumble user blocked",
    },
    {
        "platform": "bumble",
        "field_path": "error_type",
        "value": "RATE_LIMITED",
        "signal": "soft_ban",
        "description": "Bumble rate limited",
    },
]


@dataclass
class BanEvent:
    """A recorded ban event for audit trail."""
    platform: str
    signal_type: str
    ban_status: str
    detected_at: str
    details: str = ""


class BanMonitor:
    """Enhanced ban monitoring with cross-platform correlation.

    Wraps the existing BanDetector and adds:
    - Platform family contamination detection
    - Response body pattern matching
    - Emergency stop integration
    - Historical event logging

    Usage:
        monitor = BanMonitor()

        # After every API call:
        status = monitor.check_response(platform, status_code, body)

        # Before starting a session:
        safe, reason = monitor.is_safe_to_proceed(platform)

        # On error:
        monitor.handle_error(platform, error)
    """

    def __init__(self) -> None:
        self._detector = BanDetector()
        self._hard_ban_count = 0
        self._recent_events: list[BanEvent] = []
        self._rate_limit_timestamps: dict[str, list[float]] = {}

    @property
    def detector(self) -> BanDetector:
        """Access the underlying BanDetector for direct queries."""
        return self._detector

    def check_response(
        self,
        platform: str,
        status_code: int,
        body: dict | str | None = None,
        raise_on_ban: bool = False,
    ) -> BanStatus:
        """Inspect an API response for ban indicators.

        Checks HTTP status codes, JSON body patterns, and keyword scans.
        Returns the worst-case BanStatus found. Each signal is recorded at
        most once per call — the keyword-scan fallback is skipped when the
        HTTP status code already flagged the response, otherwise 403/451
        responses would double-increment `_hard_ban_count` and wrongly trip
        the emergency-stop threshold on the very first hard-ban observation.
        """
        status = BanStatus.CLEAN
        http_already_flagged = False

        # --- HTTP status code check ---
        ban_codes = PLATFORM_BAN_CODES.get(platform, {})
        reason = ban_codes.get(status_code, "")

        if status_code in (403, 451):
            status = self._record_and_correlate(
                platform, f"http_{status_code}", reason or f"HTTP {status_code} response"
            )
            http_already_flagged = True
        elif status_code == 429:
            status = self._handle_rate_limit(platform, reason or "HTTP 429 rate limit")
            http_already_flagged = True
        elif status_code == 401:
            logger.warning("[%s] Auth error (401): %s", platform, reason)
            status = BanStatus.SUSPECTED
            http_already_flagged = True

        # --- JSON body pattern matching ---
        if isinstance(body, dict):
            pattern_status = self._check_json_patterns(platform, body)
            if _worse(pattern_status, status):
                status = pattern_status

        # --- Keyword scan (fallback to basic detector) ---
        if not http_already_flagged:
            try:
                from clapcheeks.session.ban_detector import check_response_for_ban
                check_response_for_ban(platform, status_code, body)
            except BanSignalException as exc:
                signal_status = self._record_and_correlate(
                    platform, exc.signal_type, exc.details
                )
                if _worse(signal_status, status):
                    status = signal_status
                if raise_on_ban:
                    raise

        return status

    def analyze_session(self, platform: str, session_result: dict) -> BanStatus:
        """Analyze a completed session for ban indicators."""
        status = self._detector.check_session_result(platform, session_result)

        if status in (BanStatus.SOFT_BAN, BanStatus.HARD_BAN):
            self._log_event(BanEvent(
                platform=platform,
                signal_type="session_analysis",
                ban_status=status.value,
                detected_at=datetime.now().isoformat(),
                details=json.dumps(session_result),
            ))
            if status == BanStatus.HARD_BAN:
                self._hard_ban_count += 1
                self._check_family_contamination(platform)
                self._check_emergency_threshold()

        return status

    def handle_error(self, platform: str, error: Exception) -> BanStatus:
        """Handle a platform error — categorize and record if ban-related."""
        if isinstance(error, BanSignalException):
            return self._record_and_correlate(
                platform, error.signal_type, error.details
            )

        # Check if the error message contains ban keywords
        error_str = str(error).lower()
        ban_keywords = ["banned", "suspended", "disabled", "blocked", "terminated"]
        for keyword in ban_keywords:
            if keyword in error_str:
                return self._record_and_correlate(
                    platform, "error_keyword", str(error)
                )

        # Connection errors might indicate IP ban
        connection_keywords = ["connection refused", "timeout", "unreachable"]
        for keyword in connection_keywords:
            if keyword in error_str:
                logger.warning(
                    "[%s] Connection issue (possible IP ban): %s", platform, error
                )
                return BanStatus.SUSPECTED

        return BanStatus.CLEAN

    def is_safe_to_proceed(self, platform: str) -> tuple[bool, str]:
        """Pre-flight check before starting any action on a platform."""
        # Emergency stop overrides everything
        if emergency_stop.should_stop():
            return False, "Emergency stop is active"

        # Check existing ban state
        ban_status = self._detector.get_status(platform)
        if ban_status == BanStatus.HARD_BAN:
            return False, f"{platform} is hard-banned"

        # Check if currently paused (soft ban recovery)
        if self._detector.is_paused(platform):
            return False, f"{platform} is paused (soft ban recovery)"

        # Check if rate-limited recently
        if self._is_rate_limited(platform):
            return False, f"{platform} is rate-limited — waiting for cooldown"

        return True, "OK"

    def get_status_report(self) -> dict:
        """Full status report for dashboard/CLI display."""
        platforms = {}
        for family_platforms in PLATFORM_FAMILIES.values():
            for p in family_platforms:
                status = self._detector.get_status(p)
                platforms[p] = {
                    "status": status.value,
                    "paused": self._detector.is_paused(p),
                    "rate_limited": self._is_rate_limited(p),
                    "family": PLATFORM_TO_FAMILY.get(p, "unknown"),
                }

        return {
            "emergency_stop": emergency_stop.is_stopped,
            "hard_ban_count": self._hard_ban_count,
            "platforms": platforms,
            "recent_events": [
                {
                    "platform": e.platform,
                    "signal": e.signal_type,
                    "status": e.ban_status,
                    "at": e.detected_at,
                }
                for e in self._recent_events[-10:]
            ],
        }

    # --- Private helpers ---

    def _log_event(self, event: BanEvent) -> None:
        """Append to recent events (in-memory, capped at 100)."""
        self._recent_events.append(event)
        if len(self._recent_events) > 100:
            self._recent_events = self._recent_events[-50:]

    def _record_and_correlate(
        self, platform: str, signal_type: str, details: str
    ) -> BanStatus:
        """Record a signal, check family contamination, and return status."""
        status = self._detector.record_signal(platform, signal_type, details)

        self._log_event(BanEvent(
            platform=platform,
            signal_type=signal_type,
            ban_status=status.value,
            detected_at=datetime.now().isoformat(),
            details=details,
        ))

        if status == BanStatus.HARD_BAN:
            self._hard_ban_count += 1
            self._check_family_contamination(platform)
            self._check_emergency_threshold()

        return status

    def _check_json_patterns(self, platform: str, body: dict) -> BanStatus:
        """Check response body against known ban patterns."""
        for pattern in RESPONSE_PATTERNS:
            if pattern["platform"] != platform:
                continue

            # Navigate the field path
            field_path = pattern["field_path"]
            value = body
            try:
                for key in field_path.split("."):
                    value = value[key]
            except (KeyError, TypeError, IndexError):
                continue

            if value == pattern["value"]:
                signal = pattern["signal"]
                logger.warning(
                    "[%s] JSON pattern match: %s=%s → %s",
                    platform, field_path, value, signal,
                )
                if signal == "hard_ban":
                    return self._record_and_correlate(
                        platform, "json_pattern_hard", f"{field_path}={value}"
                    )
                elif signal == "soft_ban":
                    return self._record_and_correlate(
                        platform, "json_pattern_soft", f"{field_path}={value}"
                    )
                elif signal == "rate_limited":
                    return self._handle_rate_limit(
                        platform, f"JSON pattern: {field_path}={value}"
                    )

        return BanStatus.CLEAN

    def _handle_rate_limit(self, platform: str, details: str) -> BanStatus:
        """Handle rate limiting — track frequency and escalate if persistent."""
        now = time.time()
        key = platform
        if key not in self._rate_limit_timestamps:
            self._rate_limit_timestamps[key] = []

        self._rate_limit_timestamps[key].append(now)

        # Prune timestamps older than 1 hour
        self._rate_limit_timestamps[key] = [
            t for t in self._rate_limit_timestamps[key] if now - t < 3600
        ]

        count = len(self._rate_limit_timestamps[key])
        logger.warning(
            "[%s] Rate limited (%dx in last hour): %s", platform, count, details
        )

        # 5+ rate limits in an hour = escalate to soft ban
        if count >= 5:
            return self._record_and_correlate(
                platform, "persistent_rate_limit",
                f"Rate limited {count}x in 1 hour — likely soft ban",
            )

        return BanStatus.SUSPECTED

    def _is_rate_limited(self, platform: str) -> bool:
        """Check if we're currently in a rate-limit cooldown."""
        timestamps = self._rate_limit_timestamps.get(platform, [])
        if not timestamps:
            return False
        return time.time() - timestamps[-1] < 300

    def _check_family_contamination(self, platform: str) -> None:
        """When one platform in a family gets hard-banned, warn about siblings."""
        family = PLATFORM_TO_FAMILY.get(platform)
        if not family:
            return

        siblings = PLATFORM_FAMILIES.get(family, [])
        for sibling in siblings:
            if sibling != platform:
                logger.warning(
                    "[%s] FAMILY CONTAMINATION WARNING: %s in family '%s' was "
                    "hard-banned — %s may be affected. Consider pausing.",
                    sibling, platform, family, sibling,
                )
                # Auto-pause siblings for 4 hours
                self._detector.pause_platform(sibling, hours=4)

    def _check_emergency_threshold(self) -> None:
        """If 2+ platforms are hard-banned, trigger emergency stop."""
        if self._hard_ban_count >= 2:
            logger.critical(
                "EMERGENCY THRESHOLD: %d platforms hard-banned — triggering emergency stop",
                self._hard_ban_count,
            )
            emergency_stop.trigger(
                f"Multiple platform bans detected ({self._hard_ban_count} hard bans)"
            )
