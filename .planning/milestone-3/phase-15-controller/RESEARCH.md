# Phase 15: Automation Controller — Research

**Researched:** 2026-03-01
**Domain:** Unified automation orchestration, scheduling, rate limiting
**Confidence:** HIGH

## Summary

The automation controller is the orchestration layer that ties together all platform clients (Tinder, Bumble, Hinge), manages rate limiting, enforces human-like timing, handles error recovery, and provides a local API for remote control from the cloud dashboard. The existing PLAN.md covers a basic SessionManager + rate limiter — this research covers the full controller scope described in the roadmap.

Key considerations: sessions must run at human-realistic times (not 3am), per-platform rate limits must be enforced persistently, error recovery must handle CAPTCHA/auth expiry/selector failures gracefully, and a local API enables the cloud dashboard to trigger and monitor automation.

**Primary recommendation:** Build a layered controller: ControllerConfig → Scheduler → RateLimiter → StateMachine → PlatformClients, with a local FastAPI server for remote control.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastapi | latest | Local API server for remote control | Already in project stack (Python API server) |
| uvicorn | latest | ASGI server for FastAPI | Standard FastAPI companion |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| apscheduler | >=3.10 | Job scheduling with cron-like syntax | Session scheduling at realistic times |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FastAPI local server | Simple socket/file-based IPC | FastAPI is overkill for local-only but provides WebSocket + REST cleanly |
| apscheduler | Custom cron logic | apscheduler handles timezone, jitter, missed jobs |
| JSON file rate limits | SQLite | JSON is simpler, sufficient for single-user local app |

## Architecture Patterns

### Controller Layer Stack
```
┌─────────────────────────────────┐
│  Local API Server (FastAPI)     │  ← Cloud dashboard calls this
├─────────────────────────────────┤
│  AutomationController           │  ← Orchestrates everything
├─────────────────────────────────┤
│  Scheduler + Rate Limiter       │  ← When to run, how much
├─────────────────────────────────┤
│  State Machine + Recovery       │  ← Track state, handle errors
├─────────────────────────────────┤
│  Platform Clients               │  ← Tinder, Bumble, Hinge
│  (Tinder: Playwright)           │
│  (Bumble: Playwright)           │
│  (Hinge: API-direct)            │
└─────────────────────────────────┘
```

### Session State Machine
```
IDLE → STARTING → AUTHENTICATING → ACTIVE → COMPLETING → IDLE
                                     ↓
                                  PAUSED (manual or CAPTCHA)
                                     ↓
                                  ERROR → RECOVERING → IDLE
```

### Human-Realistic Scheduling

Sessions should occur at times when humans actually use dating apps:
- **Peak hours:** 7-10 PM local time (highest engagement)
- **Active hours:** 9 AM - 11 PM (configurable)
- **Weekend shift:** Start 1-2 hours later on weekends
- **Jitter:** +/- 15 minutes from scheduled time
- **No overnight:** Never schedule between 11 PM - 7 AM

Example daily schedule:
```
10:17 AM — Tinder session 1 (25 min)
12:42 PM — Bumble session 1 (18 min)
2:05 PM  — Hinge like session (10 min)
5:38 PM  — Tinder session 2 (22 min)
7:14 PM  — Bumble session 2 (20 min)
9:50 PM  — All platforms: check messages, send replies
```

### Per-Platform Rate Limits

| Platform | Free Daily | Session Duration | Sessions/Day | Cooldown |
|----------|-----------|-----------------|--------------|----------|
| Tinder | 100 likes | 15-30 min | 2 | 2+ hours |
| Bumble | 25-75 likes | 15-25 min | 2 | 2+ hours |
| Hinge | 8 likes | 5-15 min | 1 | N/A |

### Local API Design
```
GET  /status              → Controller state + all platform states
POST /session/start       → Trigger session (platform param)
POST /session/stop        → Stop current session
POST /pause               → Pause all automation
POST /resume              → Resume
GET  /schedule            → Today's schedule
GET  /metrics             → Today's metrics
GET  /metrics/{platform}  → Platform-specific
WS   /ws                  → Real-time status stream
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job scheduling | Custom sleep/timer loops | apscheduler or simple cron-style | Handles missed jobs, timezone, jitter |
| REST API | Raw socket server | FastAPI | OpenAPI docs, WebSocket, validation built-in |
| Rate limit persistence | In-memory counters | JSON file at ~/.clapcheeks/ | Survives process restarts |
| State persistence | In-memory state | JSON file at ~/.clapcheeks/ | Crash recovery |

## Common Pitfalls

### Pitfall 1: Scheduling at Exact Times
**What goes wrong:** Sessions run at exactly 10:00, 12:00, 14:00 — perfectly regular pattern
**Why it happens:** Using cron-style fixed scheduling
**How to avoid:** Add +/- 15 min jitter to all scheduled times, randomize session duration
**Warning signs:** Identical session start times in logs

### Pitfall 2: No Session Cooling Off
**What goes wrong:** Running Tinder → Bumble → Hinge back-to-back with no break
**Why it happens:** Trying to be "efficient" by running all platforms sequentially
**How to avoid:** 10-30 minute cooldown between different platform sessions
**Warning signs:** All three platforms flagged simultaneously

### Pitfall 3: Ignoring Error Accumulation
**What goes wrong:** Platform keeps failing (selector changed), automation keeps trying
**Why it happens:** No circuit breaker pattern, just retry forever
**How to avoid:** Track error count per platform, disable after N consecutive failures (circuit breaker)
**Warning signs:** Error logs fill up, account banned from failed interactions

### Pitfall 4: Daemon Crashes Without Recovery
**What goes wrong:** Background daemon crashes, no sessions run until user notices
**Why it happens:** No health monitoring, no auto-restart
**How to avoid:** Use launchd (macOS) for auto-restart, health check endpoint, state persistence for recovery
**Warning signs:** Gap in session history, user reports "nothing happened today"

### Pitfall 5: API Server Exposed to Network
**What goes wrong:** Local API server accidentally bound to 0.0.0.0, accessible from network
**Why it happens:** Default bind address not specified
**How to avoid:** Always bind to 127.0.0.1 only, require bearer token authentication
**Warning signs:** Security scanner finds open port

## Code Examples

### Gaussian-Distributed Timing (HIGH confidence)
```python
import random

def human_schedule_jitter(base_hour: int, base_minute: int) -> tuple[int, int]:
    """Add gaussian jitter to a scheduled time."""
    jitter_minutes = int(random.gauss(0, 7))  # mean 0, stddev 7 min
    jitter_minutes = max(-15, min(15, jitter_minutes))  # clamp to +-15
    total_minutes = base_hour * 60 + base_minute + jitter_minutes
    return total_minutes // 60, total_minutes % 60
```

### Rate Limiter with File Persistence (HIGH confidence)
```python
import json
from pathlib import Path
from datetime import date

RATE_FILE = Path.home() / ".clapcheeks" / "rate_limits.json"
DAILY_LIMITS = {"tinder": 100, "bumble": 75, "hinge": 8}

def get_remaining(platform: str) -> int:
    today = date.today().isoformat()
    data = json.loads(RATE_FILE.read_text()) if RATE_FILE.exists() else {}
    used = data.get(today, {}).get(platform, 0)
    return max(0, DAILY_LIMITS.get(platform, 50) - used)
```

### Circuit Breaker Pattern (HIGH confidence)
```python
class CircuitBreaker:
    def __init__(self, platform: str, threshold: int = 5, reset_minutes: int = 60):
        self.platform = platform
        self.threshold = threshold
        self.failures = 0
        self.tripped_at = None

    def record_failure(self):
        self.failures += 1
        if self.failures >= self.threshold:
            self.tripped_at = datetime.now()

    def is_available(self) -> bool:
        if self.tripped_at is None:
            return True
        elapsed = (datetime.now() - self.tripped_at).total_seconds() / 60
        return elapsed > self.reset_minutes
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual CLI invocation | Scheduled daemon with human-realistic timing | 2024-2025 | Hands-off operation |
| Fixed rate limits | Adaptive limits based on subscription tier | 2024 | Better utilization of paid features |
| Crash = restart manually | launchd/systemd auto-restart + state recovery | Standard | Reliable background operation |
| CLI-only control | Local API + cloud dashboard | Current | Remote monitoring and control |

## Open Questions

1. **Cloud dashboard communication**
   - What we know: Agent syncs metrics to `api.clapcheeks.tech` (existing sync mechanism)
   - What's unclear: How dashboard sends commands back to the agent (push vs poll)
   - Recommendation: Agent polls for commands during sync, or dashboard calls local API via tunnel

2. **apscheduler vs simple approach**
   - What we know: apscheduler handles scheduling robustly
   - What's unclear: Whether it's worth the dependency for 2-3 daily jobs
   - Recommendation: Start with simple timer-based scheduling, add apscheduler if needed

## Sources

### Primary (HIGH confidence)
- FastAPI documentation — local API server patterns
- Tinder/Bumble rate limit research (from phase 12/13) — platform-specific limits

### Secondary (MEDIUM confidence)
- Scheduling best practices for anti-detection — community patterns
- Circuit breaker pattern — standard software engineering pattern

## Metadata

**Confidence breakdown:**
- Rate limiting: HIGH — limits well-documented from platform research
- Scheduling: HIGH — standard patterns, human timing well-understood
- Error recovery: HIGH — standard circuit breaker and state machine patterns
- Local API: HIGH — FastAPI is well-documented and straightforward

**Research date:** 2026-03-01
**Valid until:** 2026-06-01 (architecture patterns are stable)
