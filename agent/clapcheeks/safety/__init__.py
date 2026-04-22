"""Anti-detection and safety module.

Provides:
- Enhanced ban detection with per-platform signal analysis
- Human-like delay patterns (Gaussian, session-aware, time-of-day)
- Proxy rotation validation and health checks
- Emergency stop mechanism (kills all automation within 5s)
- Per-platform safe limits documentation and enforcement
"""
from clapcheeks.safety.emergency_stop import EmergencyStop
from clapcheeks.safety.emergency_stop import emergency_stop as estop_singleton
from clapcheeks.safety.human_delay import HumanDelayEngine
from clapcheeks.safety.platform_limits import PlatformLimits, PLATFORM_SAFETY_LIMITS
from clapcheeks.safety.ban_monitor import BanMonitor

__all__ = [
    "EmergencyStop",
    "estop_singleton",
    "HumanDelayEngine",
    "BanMonitor",
    "PlatformLimits",
    "PLATFORM_SAFETY_LIMITS",
]
