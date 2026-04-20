"""Platform safety limits — documented safe operating parameters per platform.

These limits are derived from community reports, Terms of Service analysis,
and empirical testing. They represent the SAFE operating envelope — staying
within these bounds should prevent detection and bans.

Key principles:
1. Never exceed what a very active human user would do
2. Err on the conservative side (50-70% of apparent limits)
3. Consider daily AND hourly caps (spike detection)
4. Account for subscription tier differences
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PlatformSafetyLimit:
    """Documented safety limits for a single platform."""
    platform: str
    daily_right_swipes_free: int
    daily_right_swipes_paid: int
    daily_left_swipes: int
    hourly_swipe_cap: int
    daily_messages: int
    daily_super_likes: int
    max_session_minutes: int
    min_session_gap_minutes: int
    max_daily_sessions: int
    swipe_speed_min_seconds: float
    swipe_speed_max_seconds: float
    ban_risk_factors: list[str]
    recovery_hours: int
    tier: Literal["free", "paid", "unknown"]
    notes: str
    daily_boosts: int = 0


PLATFORM_SAFETY_LIMITS: dict[str, PlatformSafetyLimit] = {
    "tinder": PlatformSafetyLimit(
        platform="tinder",
        daily_right_swipes_free=50,
        daily_right_swipes_paid=100,
        daily_left_swipes=300,
        hourly_swipe_cap=30,
        daily_messages=30,
        daily_super_likes=1,
        max_session_minutes=20,
        min_session_gap_minutes=90,
        max_daily_sessions=4,
        swipe_speed_min_seconds=2.0,
        swipe_speed_max_seconds=12.0,
        ban_risk_factors=["rapid swiping", "all-right patterns", "API abuse", "multiple devices"],
        recovery_hours=48,
        tier="free",
        daily_boosts=0,
        notes=(
            "Tinder uses an ELO-like 'desirability score'. Swiping right on everyone "
            "tanks your score. Target 30-50% right-swipe rate. Free tier gets ~50 "
            "right swipes per 12h cycle. Paid (Gold/Platinum) gets unlimited but "
            "stay under 100/day to avoid detection. The 403 ban is permanent."
        ),
    ),
    "hinge": PlatformSafetyLimit(
        platform="hinge",
        daily_right_swipes_free=8,
        daily_right_swipes_paid=50,
        daily_left_swipes=200,
        hourly_swipe_cap=15,
        daily_messages=20,
        daily_super_likes=1,
        max_session_minutes=15,
        min_session_gap_minutes=120,
        max_daily_sessions=3,
        swipe_speed_min_seconds=3.0,
        swipe_speed_max_seconds=15.0,
        ban_risk_factors=["rapid likes", "generic comments", "API scraping", "screenshot detection"],
        recovery_hours=72,
        tier="free",
        notes=(
            "Hinge is extremely strict on free tier — only 8 likes/day. Paid "
            "(HingeX) gets unlimited but keep under 50. Hinge requires a comment "
            "or like on a specific prompt/photo, so speed is naturally limited. "
            "Match Group shares ban signals with Tinder/OKCupid/POF."
        ),
    ),
    "bumble": PlatformSafetyLimit(
        platform="bumble",
        daily_right_swipes_free=25,
        daily_right_swipes_paid=60,
        daily_left_swipes=250,
        hourly_swipe_cap=20,
        daily_messages=25,
        daily_super_likes=1,
        max_session_minutes=20,
        min_session_gap_minutes=90,
        max_daily_sessions=4,
        swipe_speed_min_seconds=2.0,
        swipe_speed_max_seconds=12.0,
        ban_risk_factors=["rapid swiping", "bot-like patterns", "mass messaging"],
        recovery_hours=48,
        tier="free",
        notes=(
            "Bumble shows 'You've run out of people' when the daily cap is hit. "
            "Free tier is ~25 right swipes. Premium unlocks more but stay under 60. "
            "Bumble Inc shares data with Badoo — bans may correlate. Women must "
            "message first, so messaging limits are less relevant."
        ),
    ),
    "grindr": PlatformSafetyLimit(
        platform="grindr",
        daily_right_swipes_free=100,
        daily_right_swipes_paid=200,
        daily_left_swipes=500,
        hourly_swipe_cap=50,
        daily_messages=50,
        daily_super_likes=0,
        max_session_minutes=25,
        min_session_gap_minutes=60,
        max_daily_sessions=6,
        swipe_speed_min_seconds=1.5,
        swipe_speed_max_seconds=8.0,
        ban_risk_factors=["mass messaging", "spam reports", "location spoofing"],
        recovery_hours=24,
        tier="free",
        notes=(
            "Grindr is proximity-based with a cascade grid. Higher volume is normal "
            "on this platform. Free tier is generous but shows ads. XTRA/Unlimited "
            "removes limits. Independent company — no cross-platform ban correlation."
        ),
    ),
    "badoo": PlatformSafetyLimit(
        platform="badoo",
        daily_right_swipes_free=50,
        daily_right_swipes_paid=100,
        daily_left_swipes=300,
        hourly_swipe_cap=25,
        daily_messages=30,
        daily_super_likes=0,
        max_session_minutes=20,
        min_session_gap_minutes=90,
        max_daily_sessions=4,
        swipe_speed_min_seconds=2.0,
        swipe_speed_max_seconds=10.0,
        ban_risk_factors=["rapid swiping", "bot patterns", "mass messages"],
        recovery_hours=48,
        tier="free",
        notes=(
            "Badoo is owned by Bumble Inc. Ban correlation with Bumble is possible "
            "but not confirmed. Encounters mode has daily limits. Free tier is more "
            "restricted than Bumble. Popular in Europe/Latin America."
        ),
    ),
    "happn": PlatformSafetyLimit(
        platform="happn",
        daily_right_swipes_free=50,
        daily_right_swipes_paid=100,
        daily_left_swipes=300,
        hourly_swipe_cap=25,
        daily_messages=30,
        daily_super_likes=1,
        max_session_minutes=15,
        min_session_gap_minutes=120,
        max_daily_sessions=3,
        swipe_speed_min_seconds=2.5,
        swipe_speed_max_seconds=12.0,
        ban_risk_factors=["location spoofing", "rapid crossing", "mass likes"],
        recovery_hours=48,
        tier="free",
        notes=(
            "Happn is location-based (you 'crossed paths'). Requires real location "
            "data — spoofing is detectable and bannable. Independent company. "
            "Smaller user base so limits are naturally lower."
        ),
    ),
    "okcupid": PlatformSafetyLimit(
        platform="okcupid",
        daily_right_swipes_free=40,
        daily_right_swipes_paid=100,
        daily_left_swipes=300,
        hourly_swipe_cap=20,
        daily_messages=30,
        daily_super_likes=0,
        max_session_minutes=20,
        min_session_gap_minutes=90,
        max_daily_sessions=4,
        swipe_speed_min_seconds=2.5,
        swipe_speed_max_seconds=12.0,
        ban_risk_factors=["mass messaging", "template messages", "low match question answers"],
        recovery_hours=72,
        tier="free",
        notes=(
            "OKCupid is owned by Match Group (same as Tinder/Hinge/POF). "
            "Ban signals WILL correlate across the family. Requires answering "
            "match questions for good results. Free messaging is limited."
        ),
    ),
    "pof": PlatformSafetyLimit(
        platform="pof",
        daily_right_swipes_free=50,
        daily_right_swipes_paid=100,
        daily_left_swipes=300,
        hourly_swipe_cap=25,
        daily_messages=30,
        daily_super_likes=0,
        max_session_minutes=20,
        min_session_gap_minutes=90,
        max_daily_sessions=4,
        swipe_speed_min_seconds=2.0,
        swipe_speed_max_seconds=10.0,
        ban_risk_factors=["spam messaging", "mass likes", "template messages"],
        recovery_hours=48,
        tier="free",
        notes=(
            "Plenty of Fish (POF) is Match Group family. Less strict than Tinder "
            "but ban signals correlate. Older platform with less sophisticated "
            "bot detection. Still, stay conservative."
        ),
    ),
    "feeld": PlatformSafetyLimit(
        platform="feeld",
        daily_right_swipes_free=30,
        daily_right_swipes_paid=50,
        daily_left_swipes=200,
        hourly_swipe_cap=15,
        daily_messages=20,
        daily_super_likes=0,
        max_session_minutes=15,
        min_session_gap_minutes=120,
        max_daily_sessions=3,
        swipe_speed_min_seconds=3.0,
        swipe_speed_max_seconds=15.0,
        ban_risk_factors=["rapid swiping", "mass messaging", "inappropriate content"],
        recovery_hours=72,
        tier="free",
        notes=(
            "Feeld targets ENM/kink communities. Smaller user base = more "
            "scrutiny on bot patterns. Pair profiles are common. Independent "
            "company — no cross-platform correlation. Be extra conservative."
        ),
    ),
    "cmb": PlatformSafetyLimit(
        platform="cmb",
        daily_right_swipes_free=21,
        daily_right_swipes_paid=21,
        daily_left_swipes=21,
        hourly_swipe_cap=21,
        daily_messages=21,
        daily_super_likes=0,
        max_session_minutes=10,
        min_session_gap_minutes=1440,
        max_daily_sessions=1,
        swipe_speed_min_seconds=5.0,
        swipe_speed_max_seconds=30.0,
        ban_risk_factors=["speed", "bot detection"],
        recovery_hours=24,
        tier="free",
        notes=(
            "Coffee Meets Bagel sends exactly 21 'bagels' per day at noon. "
            "There is NO swiping — you get what you get. The only automation "
            "opportunity is reviewing the daily batch and responding. Very "
            "limited volume but high intent users."
        ),
    ),
}


class PlatformLimits:
    """Runtime tracker for platform safety limits.

    Usage:
        limits = PlatformLimits()

        # Before swiping:
        if not limits.check_hourly_cap("tinder"):
            print("Hourly cap reached — wait")

        # After swiping:
        limits.record_action("tinder", "swipe")
    """

    def __init__(self) -> None:
        self._hourly_counts: dict[str, int] = {}
        self._hour_started: dict[str, float] = {}
        self._session_counts: dict[str, int] = {}
        self._last_session_end: dict[str, float] = {}

    def check_hourly_cap(self, platform: str) -> bool:
        """Check if we're under the hourly swipe cap."""
        import time as _time
        now = _time.time()
        started = self._hour_started.get(platform, 0)
        if now - started > 3600:
            # Reset hourly counter
            self._hourly_counts[platform] = 0
            self._hour_started[platform] = now

        limits = PLATFORM_SAFETY_LIMITS.get(platform)
        if not limits:
            return True

        current = self._hourly_counts.get(platform, 0)
        return current < limits.hourly_swipe_cap

    def can_start_session(self, platform: str) -> tuple[bool, str]:
        """Check if enough time has passed since the last session."""
        import time as _time
        limits = PLATFORM_SAFETY_LIMITS.get(platform)
        if not limits:
            return True, "No limits defined"

        # Check session count
        daily_sessions = self._session_counts.get(platform, 0)
        if daily_sessions >= limits.max_daily_sessions:
            return False, f"Max daily sessions reached ({limits.max_daily_sessions})"

        # Check gap
        last_end = self._last_session_end.get(platform)
        if last_end:
            elapsed = (_time.time() - last_end) / 60
            if elapsed < limits.min_session_gap_minutes:
                remaining = limits.min_session_gap_minutes - elapsed
                return False, f"Session gap: {remaining:.0f}min remaining"

        return True, "OK"

    def record_action(self, platform: str, action: str = "swipe") -> None:
        """Record an action for hourly cap tracking."""
        if action == "swipe":
            self._hourly_counts[platform] = self._hourly_counts.get(platform, 0) + 1

    def record_session_start(self, platform: str) -> None:
        """Record the start of a new session."""
        self._session_counts[platform] = self._session_counts.get(platform, 0) + 1

    def record_session_end(self, platform: str) -> None:
        """Record the end of a session."""
        import time as _time
        self._last_session_end[platform] = _time.time()
