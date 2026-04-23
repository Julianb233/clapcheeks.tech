# Phase 35: Anti-Detection & Safety

Linear: [AI-8334](https://linear.app/ai-acrobatics/issue/AI-8334)

## Goal

Keep the Clapcheeks autonomous agent operating inside the safe envelope of every
supported dating platform so that users are never banned because of automation.

## Components

| Module | Responsibility |
|--------|----------------|
| `clapcheeks.safety.emergency_stop` | Process-wide kill switch. Triggered by CLI, file, API, or programmatic call. All workers observe it within 5s via an in-process `threading.Event` plus a cross-process sentinel file. |
| `clapcheeks.safety.human_delay` | Gaussian + fatigue + time-of-day delay distributions. Produces delays per action type ("swipe", "message", "read_bio", …) and enforces session lifetimes + inter-session gaps. |
| `clapcheeks.safety.platform_limits` | Declarative per-platform safety envelope (`PLATFORM_SAFETY_LIMITS`) plus an in-memory tracker (`PlatformLimits`) that enforces hourly caps and session counts. |
| `clapcheeks.safety.ban_monitor` | Enhanced ban detector wrapping `session.ban_detector`. Adds cross-platform family correlation (Match Group, Bumble Inc), JSON body pattern matching, historical event log, and emergency-stop escalation when two hard bans land in a single run. |
| `clapcheeks.safety.proxy_validator` | Health checks for residential proxies: latency, egress IP, DNS, and rotation sanity. |
| `clapcheeks.session.ban_detector` | Persistent per-platform ban state (`ban_state.json`) with soft-ban pause (48h), hard-ban halt, and auto-resume. |
| `clapcheeks.session.safety` | Session-level hourly swipe limits, cooldowns, and match-rate back-off. |

## Safe Operating Limits Per Platform

Free tier daily caps (conservative; paid tiers are higher — see `PLATFORM_SAFETY_LIMITS[<platform>].daily_right_swipes_paid`):

| Platform | Daily right-swipes (free) | Hourly cap | Daily messages | Recovery after soft ban |
|----------|---------------------------|------------|----------------|------------------------|
| Tinder   | 50                        | 30         | 30             | 48h                    |
| Hinge    | 8                         | 15         | 20             | 72h                    |
| Bumble   | 25                        | 20         | 25             | 48h                    |
| Grindr   | 100                       | 50         | 50             | 24h                    |
| Badoo    | 50                        | 25         | 30             | 48h                    |
| Happn    | 50                        | 25         | 30             | 48h                    |
| OkCupid  | 40                        | 20         | 30             | 72h                    |
| POF      | 50                        | 25         | 30             | 48h                    |
| Feeld    | 30                        | 15         | 20             | 72h                    |
| CMB      | 21                        | 21         | 21             | 24h                    |

The authoritative source is `agent/clapcheeks/safety/platform_limits.py` — each
entry carries `ban_risk_factors`, `swipe_speed_min/max_seconds`, and a free-text
`notes` field describing the detection model on that platform. The table above
is a summary; code reads the dataclass directly.

## Success Criteria (AI-8334)

1. **7-day run with zero bans on test accounts** — session-level `ban_log`
   records events; `get_ban_test_report()` returns an `overall_pass` bool and
   per-platform counts consumed by the nightly soak test.
2. **Rate limiter respects per-platform caps** — `PlatformLimits.check_hourly_cap()`
   plus `session.safety.check_hourly_limit()` cover both in-process and
   persistent counters. Exercised by `TestPlatformLimits` and
   `TestSafetyHourlyLimits`.
3. **Ban detector pauses within 1 action** — `BanMonitor.check_response()`
   raises/marks hard bans on the first 403/451 and immediately updates the
   shared detector state that `is_safe_to_proceed()` reads. Verified by
   `TestBanMonitor::test_403_triggers_hard_ban` and the smoke check in this
   phase.
4. **Emergency stop kills automation within 5s** — `EmergencyStop.trigger()`
   sets an in-process event (<1ms) and writes a cross-process stop file that
   the watchdog observes on a 1s poll interval. Verified by
   `TestEmergencyStop::test_trigger_sets_stop`.

## Fixes Landed in This Phase

1. **`BanDetector.get_status()`** — added the accessor that `BanMonitor` and
   status reporting rely on. Previously missing, which made
   `is_safe_to_proceed()` and `get_status_report()` raise `AttributeError`.
2. **`BanDetector` state-file isolation** — under pytest, persistence is
   redirected to a per-test temp file so one test's recorded hard ban cannot
   leak into the next test's `~/.clapcheeks/ban_state.json`. Production
   behaviour is unchanged; the override only activates when
   `PYTEST_CURRENT_TEST` is set (or the explicit `CLAPCHEEKS_BAN_STATE_FILE`
   env var is provided).
3. **`BanMonitor.check_response()` no longer double-records** — for a 403 the
   HTTP-status branch and the keyword-scan fallback both used to invoke
   `_record_and_correlate`, incrementing `_hard_ban_count` twice from a single
   API response and tripping the 2-bans emergency-stop threshold on the very
   first hard ban. The keyword scan now runs only when the HTTP branch did not
   already flag the response. A semantic severity comparator replaces the
   previous string `.value` comparison that was ordering statuses
   alphabetically.
4. **`EmergencyStop` adopts a stale sentinel file only outside pytest** — a
   leftover `~/.clapcheeks/EMERGENCY_STOP` from a prior debug session used to
   latch the test process into a permanently-stopped state at import time,
   before fixtures could monkeypatch `STOP_FILE`. Prod code is unaffected;
   the carve-out is gated on pytest being loaded.

## Operational Runbook

| Situation | Action |
|-----------|--------|
| Agent reports intermittent 429s | Respect `_handle_rate_limit` back-off; if 5+ in an hour, detector escalates to a soft ban and pauses 48h. |
| Account shows selfie verification | Pause platform manually (`BanDetector.pause_platform(platform, hours=24)`). Don't retry syncs until the user confirms unlocked. |
| Multiple platforms flagged same day | Expect family-contamination auto-pause on Match Group / Bumble Inc siblings. Two hard bans trigger emergency stop — investigate before clearing. |
| Need a hard kill | `touch ~/.clapcheeks/EMERGENCY_STOP` — every in-flight worker sees it on the next poll (≤1s in-process, ≤5s cross-process). `rm ~/.clapcheeks/EMERGENCY_STOP` to resume. |

## Tests

Run locally:

```bash
cd agent
python3 -m pytest tests/test_safety.py tests/test_ban_detector.py \
                  tests/test_rate_limiter.py -q
```

Current status: 250 tests pass across the agent test suite.
