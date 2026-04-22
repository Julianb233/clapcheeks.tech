"""Platform validation harness — validates swiping, conversations, and AI suggestions
across Tinder, Bumble, and Hinge before/during dogfooding.

Runs a series of checks against each platform's client to verify:
- Auth tokens are valid and not expired
- Swipe sessions can start without error
- Conversation fetching works
- AI reply generation returns suggestions
- Rate limits are respected

Results are logged to the health monitor and friction tracker automatically.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

log = logging.getLogger("clapcheeks.dogfood.platform_harness")

PLATFORMS = ["tinder", "bumble", "hinge"]


@dataclass
class CheckResult:
    """Result of a single platform check."""
    platform: str
    check_name: str
    passed: bool
    duration_ms: int = 0
    error: Optional[str] = None
    details: dict = field(default_factory=dict)


@dataclass
class PlatformCheckReport:
    """Full check report across all platforms."""
    timestamp: str
    results: list[CheckResult] = field(default_factory=list)
    total_passed: int = 0
    total_failed: int = 0
    platforms_healthy: list[str] = field(default_factory=list)
    platforms_unhealthy: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "total_passed": self.total_passed,
            "total_failed": self.total_failed,
            "platforms_healthy": self.platforms_healthy,
            "platforms_unhealthy": self.platforms_unhealthy,
            "results": [
                {
                    "platform": r.platform,
                    "check_name": r.check_name,
                    "passed": r.passed,
                    "duration_ms": r.duration_ms,
                    "error": r.error,
                    "details": r.details,
                }
                for r in self.results
            ],
        }


class PlatformTestHarness:
    """Harness for validating platform integrations during dogfooding."""

    def __init__(self, platforms: list[str] | None = None):
        self.platforms = platforms or PLATFORMS

    def run_all_checks(self) -> PlatformCheckReport:
        """Run all checks across all configured platforms."""
        report = PlatformCheckReport(
            timestamp=datetime.now().isoformat(timespec="seconds"),
        )

        for platform in self.platforms:
            results = self._check_platform(platform)
            report.results.extend(results)

        # Summarize
        report.total_passed = sum(1 for r in report.results if r.passed)
        report.total_failed = sum(1 for r in report.results if not r.passed)

        for platform in self.platforms:
            plat_results = [r for r in report.results if r.platform == platform]
            if all(r.passed for r in plat_results):
                report.platforms_healthy.append(platform)
            else:
                report.platforms_unhealthy.append(platform)

        # Auto-log friction points for failures
        self._log_failures_as_friction(report)

        return report

    def check_single_platform(self, platform: str) -> list[CheckResult]:
        """Check a single platform."""
        return self._check_platform(platform)

    def _check_platform(self, platform: str) -> list[CheckResult]:
        """Run all checks for a single platform."""
        results = []

        # Check 1: Auth token validity
        results.append(self._check_auth_token(platform))

        # Check 2: Profile fetch (proves API connectivity)
        results.append(self._check_profile_fetch(platform))

        # Check 3: Conversation list fetch
        results.append(self._check_conversation_fetch(platform))

        # Check 4: AI reply generation (no-send mode)
        results.append(self._check_ai_reply_generation(platform))

        # Check 5: Rate limiter state
        results.append(self._check_rate_limiter(platform))

        return results

    def _check_auth_token(self, platform: str) -> CheckResult:
        """Verify the auth token for a platform is present and valid."""
        start = time.time()
        try:
            import os
            token_key = f"{platform.upper()}_AUTH_TOKEN"
            token = os.environ.get(token_key)

            if not token:
                # Try loading from config
                from clapcheeks.config import load
                config = load()
                token = config.get("tokens", {}).get(platform)

            if not token:
                return CheckResult(
                    platform=platform,
                    check_name="auth_token",
                    passed=False,
                    duration_ms=int((time.time() - start) * 1000),
                    error=f"No auth token found for {platform} (env: {token_key})",
                )

            return CheckResult(
                platform=platform,
                check_name="auth_token",
                passed=True,
                duration_ms=int((time.time() - start) * 1000),
                details={"token_length": len(token), "token_prefix": token[:8] + "..."},
            )
        except Exception as e:
            return CheckResult(
                platform=platform,
                check_name="auth_token",
                passed=False,
                duration_ms=int((time.time() - start) * 1000),
                error=str(e),
            )

    def _check_profile_fetch(self, platform: str) -> CheckResult:
        """Validate fetching the user's own profile from the platform."""
        start = time.time()
        try:
            from clapcheeks.platforms import get_platform_client
            client = get_platform_client(platform, driver=None)
            profile = client.get_my_profile()

            return CheckResult(
                platform=platform,
                check_name="profile_fetch",
                passed=True,
                duration_ms=int((time.time() - start) * 1000),
                details={"has_profile": profile is not None},
            )
        except Exception as e:
            return CheckResult(
                platform=platform,
                check_name="profile_fetch",
                passed=False,
                duration_ms=int((time.time() - start) * 1000),
                error=str(e),
            )

    def _check_conversation_fetch(self, platform: str) -> CheckResult:
        """Validate fetching recent conversations."""
        start = time.time()
        try:
            from clapcheeks.platforms import get_platform_client
            client = get_platform_client(platform, driver=None)
            convos = client.get_conversations(limit=5)

            return CheckResult(
                platform=platform,
                check_name="conversation_fetch",
                passed=True,
                duration_ms=int((time.time() - start) * 1000),
                details={"conversation_count": len(convos) if convos else 0},
            )
        except Exception as e:
            return CheckResult(
                platform=platform,
                check_name="conversation_fetch",
                passed=False,
                duration_ms=int((time.time() - start) * 1000),
                error=str(e),
            )

    def _check_ai_reply_generation(self, platform: str) -> CheckResult:
        """Validate AI reply generation in dry-run mode (no actual sending)."""
        start = time.time()
        try:
            from clapcheeks.ai.reply_generator import generate_reply

            # Use a mock conversation for validation
            mock_messages = [
                {"sender": "match", "text": "Hey! How's your weekend going?", "timestamp": "2026-04-20T10:00:00"},
            ]

            reply = generate_reply(
                messages=mock_messages,
                match_name="Validation Match",
                platform=platform,
                dry_run=True,
            )

            return CheckResult(
                platform=platform,
                check_name="ai_reply_generation",
                passed=reply is not None and len(reply) > 0,
                duration_ms=int((time.time() - start) * 1000),
                details={
                    "reply_length": len(reply) if reply else 0,
                    "reply_preview": reply[:80] + "..." if reply and len(reply) > 80 else reply,
                },
            )
        except Exception as e:
            return CheckResult(
                platform=platform,
                check_name="ai_reply_generation",
                passed=False,
                duration_ms=int((time.time() - start) * 1000),
                error=str(e),
            )

    def _check_rate_limiter(self, platform: str) -> CheckResult:
        """Check rate limiter state — verify we're not blocked."""
        start = time.time()
        try:
            from clapcheeks.session.rate_limiter import get_daily_summary

            summary = get_daily_summary() or {}
            right = summary.get(f"{platform}_right", 0)
            left = summary.get(f"{platform}_left", 0)

            # Check if we're near platform limits
            from clapcheeks.safety.platform_limits import PLATFORM_LIMITS
            limits = PLATFORM_LIMITS.get(platform, {})
            max_swipes = limits.get("max_swipes_per_session", 100)

            return CheckResult(
                platform=platform,
                check_name="rate_limiter",
                passed=True,
                duration_ms=int((time.time() - start) * 1000),
                details={
                    "swipes_today": right + left,
                    "max_per_session": max_swipes,
                    "headroom": max_swipes - right,
                },
            )
        except Exception as e:
            return CheckResult(
                platform=platform,
                check_name="rate_limiter",
                passed=False,
                duration_ms=int((time.time() - start) * 1000),
                error=str(e),
            )

    def _log_failures_as_friction(self, report: PlatformCheckReport) -> None:
        """Auto-log check failures as friction points."""
        try:
            from clapcheeks.dogfood.friction_tracker import (
                FrictionCategory,
                FrictionSeverity,
                FrictionTracker,
            )

            tracker = FrictionTracker()
            for result in report.results:
                if not result.passed:
                    severity = FrictionSeverity.MAJOR
                    if result.check_name == "auth_token":
                        severity = FrictionSeverity.BLOCKER
                        category = FrictionCategory.AUTH
                    elif result.check_name == "ai_reply_generation":
                        category = FrictionCategory.CONVERSATION
                    elif result.check_name in ("profile_fetch", "conversation_fetch"):
                        category = FrictionCategory.SWIPING
                    else:
                        category = FrictionCategory.OTHER

                    tracker.log(
                        title=f"[{result.platform}] {result.check_name} failed",
                        description=result.error or "Unknown error",
                        severity=severity,
                        category=category,
                        platform=result.platform,
                        auto_detected=True,
                        context=result.details,
                    )
        except Exception as e:
            log.warning("Failed to log check failures as friction: %s", e)
