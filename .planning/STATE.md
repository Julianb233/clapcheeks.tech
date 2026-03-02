# Project State

## Current Position

- Phase: 18 of 23 (Conversation AI)
- Plan: 01 of 01
- Status: Phase complete — Milestone 4 in progress
- Last activity: 2026-03-02 - Completed 18-01-PLAN.md

Progress: ██████████████████ (M4: 3/8 phases)

## Decisions

| ID | Decision | Reason | Phase |
|----|----------|--------|-------|
| stealth-approach | Init script injection for anti-detection | Lightweight, no external library needed | 11 |
| session-format | JSON cookie files at ~/.clapcheeks/sessions/ | Simple, debuggable, per-platform isolation | 11 |
| event-loop | asyncio.new_event_loop() for sync-async bridging | CLI is sync Click, browser is async Playwright | 11 |
| manual-auth | Manual browser login only, no automated credential entry | Security and ToS compliance; session persists via cookies | 12 |
| selector-dict | Centralized SELECTORS dict for all DOM queries | Tinder changes class names frequently; single maintenance point | 12 |
| local-ai-first | Ollama local first, Claude API fallback, safe string last | Privacy — no data leaves device unless user configures API key | 12 |
| bumble-selectors | data-qa-role primary selectors with class fallbacks | Bumble uses data-qa-role extensively; matches Phase 12 pattern | 13 |
| existing-rate-limits | Keep existing per-direction bumble limits (60 right, 250 left) | Already registered in rate_limiter.py; more granular than flat 75 | 13 |
| session-via-driver | Session persistence via BrowserDriver/SessionStore | Phase 11 established SessionStore pattern; reuse avoids duplication | 13 |
| playwright-over-api | Rewrote Hinge from REST API to Playwright browser automation | Matches Tinder/Bumble pattern, no token management needed | 14 |
| ai-comment-quality-gate | Regenerate AI comment if 3+ emojis, quotes, or >2 sentences | Natural-sounding comments avoid spam detection | 14 |
| hinge-50-limit | 50/day enforced via rate_limiter integration | Hinge's actual daily free like cap | 14 |
| aggregate-caps | Added aggregate daily caps (100/75/50) alongside per-direction limits | Plan specifies total caps; per-direction limits remain for finer control | 15 |
| api-date-range | Added ?days=7|30|90 to analytics API with whitelist validation | User needs flexible date range filtering; defaults to 30 | 16 |
| separate-analytics-page | Dedicated /analytics page with client-side date range state | Full-screen analytics view separate from dashboard overview | 16 |
| reply-style-rename | Renamed tones from playful/direct/flirty to witty/warm/direct with reasoning | Better differentiation, reasoning helps users understand suggestions | 18 |
| claude-preferred-fallback | Python reply module uses Claude API as preferred fallback over Kimi | Higher quality replies for conversation context vs openers | 18 |

## Blockers / Concerns

- None

## Session Continuity

- Last session: 2026-03-02T07:06:00Z
- Stopped at: Completed 18-01-PLAN.md
- Resume file: None
