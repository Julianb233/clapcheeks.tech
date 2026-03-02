---
phase: 13
plan: 01
subsystem: platform-automation
tags: [bumble, playwright, automation, beehive, ai-opener]
dependency-graph:
  requires: [11-playwright, 12-tinder]
  provides: [bumble-client, beehive-scanner, bumble-openers]
  affects: [15-unified-session]
tech-stack:
  added: []
  patterns: [centralized-selectors, sync-async-bridge, per-direction-rate-limits]
key-files:
  created: []
  modified:
    - agent/clapcheeks/platforms/bumble.py
decisions:
  - id: bumble-selectors
    decision: "data-qa-role primary selectors with class fallbacks"
    reason: "Bumble uses data-qa-role extensively; matches Phase 12 pattern"
  - id: existing-rate-limits
    decision: "Keep existing per-direction bumble limits (60 right, 250 left)"
    reason: "Already registered in rate_limiter.py from Phase 12 scaffold; more granular than plan's flat 75"
  - id: session-via-driver
    decision: "Session persistence via BrowserDriver/SessionStore, not custom bumble_state.json"
    reason: "Phase 11 established SessionStore pattern; reuse avoids duplication"
metrics:
  duration: ~5min
  completed: 2026-03-02
---

# Phase 13 Plan 01: Bumble Automation Summary

BumbleClient with Playwright-driven swipe loop, Beehive match queue scanner, and AI-generated opener messaging with human-like keystroke simulation.

## What Was Built

### BumbleClient (`agent/clapcheeks/platforms/bumble.py`)

Full browser automation client mirroring TinderClient's architecture:

- **login()** — navigates to bumble.com/app, detects existing session or prompts manual auth with 120s timeout
- **run_swipe_session(like_ratio, max_swipes)** — main swipe loop with:
  - Per-direction rate limit enforcement (60 right, 250 left daily)
  - Pre-swipe delays (1.5-4.0s) and inter-swipe delays (0.8-2.5s)
  - Periodic long pauses every 8-15 swipes (5-15s) for human-like behavior
  - Per-decision like_ratio jitter (+/-0.05)
  - Match popup detection and dismissal
  - Returns `{liked, passed, errors, openers_sent, new_matches}`
- **check_beehive()** — scans match queue, detects "Your turn" badges and 24h expiry timers, returns actionable matches only
- **send_opener(match)** — opens conversation, generates AI opener via `ai/opener.py`, types with 30-80ms keystroke delay simulation
- **_send_pending_openers()** — auto-runs after swipe session, capped at 5 openers with 10-30s delays between sends

### Centralized Selectors

14 data-qa-role selectors covering encounters, chat, and messenger elements. Fallback class selectors for resilience.

### Rate Limiter Integration

Bumble was already registered in `session/rate_limiter.py` with per-direction limits (`right: 60, left: 250, messages: 25`). BumbleClient enforces these via `can_swipe()` / `record_swipe()` calls.

## Deviations from Plan

### Adaptation: Rate limiter already had bumble entry

- **Found during:** Task 3
- **Issue:** Plan assumed bumble needed to be added to DAILY_LIMITS with flat `75` limit
- **Reality:** Phase 12 scaffold already registered `"bumble": {"right": 60, "left": 250, "messages": 25}`
- **Action:** Kept existing per-direction structure; no changes needed to rate_limiter.py
- **Impact:** More granular limits than plan specified

### Adaptation: Session persistence via existing SessionStore

- **Found during:** Task 1
- **Issue:** Plan specified saving to `~/.clapcheeks/bumble_state.json`
- **Reality:** BrowserDriver already uses SessionStore saving to `~/.clapcheeks/sessions/bumble.json`
- **Action:** Relied on existing Phase 11 session infrastructure
- **Impact:** Consistent session handling across all platforms

### Adaptation: generate_opener signature

- **Found during:** Task 2
- **Issue:** Plan specified `generate_opener(match_name, platform="bumble")`
- **Reality:** Actual signature is `generate_opener(match_name, profile_data, model)`
- **Action:** Passed `profile_data={"name": ..., "platform": "bumble"}` to match actual API
- **Impact:** None — works correctly

## Commits

| Hash | Description |
|------|-------------|
| 73ec49d | feat(13-01): implement BumbleClient with swipe, beehive, and AI openers |

## Next Phase Readiness

Phase 13 complete. BumbleClient follows identical patterns to TinderClient, ready for:
- Phase 14 (Hinge) — same architecture
- Phase 15 (Unified session) — BumbleClient exposes same interface as TinderClient
