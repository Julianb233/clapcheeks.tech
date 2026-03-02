---
phase: 12-tinder
plan: 01
subsystem: platforms
tags: [tinder, playwright, automation, ai, ollama]
dependency-graph:
  requires: [11-playwright]
  provides: [TinderClient, generate_opener]
  affects: [13-bumble, 14-hinge, 15-controller]
tech-stack:
  added: []
  patterns: [platform-client-pattern, selector-dict-resilience, local-ai-with-fallback]
key-files:
  created:
    - agent/clapcheeks/platforms/__init__.py
    - agent/clapcheeks/platforms/tinder.py
    - agent/clapcheeks/ai/__init__.py
    - agent/clapcheeks/ai/opener.py
    - agent/tests/test_tinder.py
  modified: []
decisions:
  - id: manual-auth
    decision: Manual browser login only, no automated credential entry
    reason: Security and ToS compliance; session persists via cookie storage
  - id: selector-dict
    decision: Centralized SELECTORS dict for all DOM queries
    reason: Tinder frequently changes class names; single point of maintenance
  - id: local-ai-first
    decision: Ollama (local) first, Claude API fallback, safe string last
    reason: Privacy — no data leaves device unless user explicitly configures API key
metrics:
  duration: ~3 minutes
  completed: 2026-03-02
---

# Phase 12 Plan 01: Tinder Browser Automation Summary

**TinderClient with manual auth, human-like swipe loop, match detection, and AI opener generation via local Ollama with Claude fallback**

## What Was Built

### TinderClient (`agent/clapcheeks/platforms/tinder.py`)
- **login()**: Navigates to tinder.com, checks for existing session via swipe card selectors, falls back to manual auth with 120s timeout polling every 3s
- **run_swipe_session()**: Main swipe loop with configurable like_ratio and max_swipes, rate-limited to 100/day via rate_limiter integration
- **_should_like()**: Swipe decision based on age preference filtering (when non-default prefs set) plus random ratio
- **_detect_match_async()**: Match modal detection, AI opener generation and sending, modal dismissal
- Centralized SELECTORS dict with multiple fallback selectors per element for DOM resilience

### AI Opener Generator (`agent/clapcheeks/ai/opener.py`)
- **generate_opener()**: Three-tier generation — Ollama local inference first, Claude API fallback if ANTHROPIC_API_KEY set, safe default string last
- Follows existing ai_reply.py patterns: lazy imports, logging, graceful degradation

### Unit Tests (`agent/tests/test_tinder.py`)
- 10 tests covering _should_like() ratio logic, age filtering, login failure handling, rate limit exhaustion, return format validation, and opener fallback behavior
- All tests pass without browser or AI dependencies (fully mocked)

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| b526950 | feat | TinderClient with login, swipe loop, match detection |
| 941e9d6 | feat | AI opener generator with Ollama and Claude fallback |
| 606d154 | test | Unit tests for TinderClient and opener fallback |

## Next Phase Readiness

- **Phase 13 (Bumble)**: Can follow the same TinderClient pattern — platforms package is ready
- **Phase 14 (Hinge)**: Same pattern applies
- **Phase 15 (Controller)**: TinderClient.run_swipe_session() returns the expected dict format that the controller will orchestrate
