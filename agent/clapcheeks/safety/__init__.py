"""Anti-detection and safety module.

Provides:
- Enhanced ban detection with per-platform signal analysis
- Human-like delay patterns (Gaussian, session-aware, time-of-day)
- Proxy rotation validation and health checks
- Emergency stop mechanism (kills all automation within 5s)
- Per-platform safe limits documentation and enforcement
- Selectivity gate (sub-30% right-swipe ratio to protect Tinder Trust)
- Per-recipient send-window optimizer (hold msgs until predicted-best hour)
- Physical-world presence gate (home subnet + iPhone LAN ARP + active hours)
"""
from clapcheeks.safety.emergency_stop import EmergencyStop
from clapcheeks.safety.emergency_stop import emergency_stop as estop_singleton
from clapcheeks.safety.human_delay import HumanDelayEngine
from clapcheeks.safety.platform_limits import (
    PlatformLimits,
    PLATFORM_SAFETY_LIMITS,
    SelectivityGate,
)
from clapcheeks.safety.ban_monitor import BanMonitor
from clapcheeks.safety.presence import should_be_active
from clapcheeks.safety.send_window import (
    DEFAULT_PEAK_HOURS,
    best_send_hour_for,
    is_within_send_window,
)

__all__ = [
    "EmergencyStop",
    "estop_singleton",
    "HumanDelayEngine",
    "BanMonitor",
    "PlatformLimits",
    "PLATFORM_SAFETY_LIMITS",
    "SelectivityGate",
    "should_be_active",
    "DEFAULT_PEAK_HOURS",
    "best_send_hour_for",
    "is_within_send_window",
]
