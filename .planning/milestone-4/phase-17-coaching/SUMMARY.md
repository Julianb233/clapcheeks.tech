# Phase 17: AI Coaching Engine Summary

**One-liner:** Claude-powered weekly coaching tips from anonymized dating stats with thumbs up/down feedback loop

## What Was Built

### DB Migration (`web/scripts/006_coaching.sql`)
- `clapcheeks_coaching_sessions` table: stores weekly AI coaching sessions per user with tips (JSONB), stats snapshot, and week-based deduplication
- `clapcheeks_tip_feedback` table: per-tip thumbs up/down feedback with unique constraint on (user, session, tip_index)
- RLS policies: users can only see/modify their own data

### Coaching Generation Engine (`web/lib/coaching/generate.ts`)
- `getLatestCoaching()`: fetches current week's cached session with feedback
- `generateCoaching()`: aggregates 30 days of analytics, computes match/reply/date-conversion rates, builds per-platform breakdown, calls Claude claude-sonnet-4-6 with structured JSON output
- Week-based caching: won't regenerate if session exists for current week
- Privacy-first: only anonymized aggregate stats sent to Claude, never personal messages

### API Routes
- `POST /api/coaching/generate`: authenticated endpoint, integrated with usage limits (added by plan-gating agent), calls generateCoaching
- `POST /api/coaching/feedback`: upserts tip feedback (thumbs up/down) per session+tip_index

### Dashboard Integration
- `coaching-section.tsx`: client component with category-colored tip cards (timing/messaging/platform/general), priority badges, thumbs up/down feedback buttons, regenerate button
- Integrated into dashboard page below platform breakdown section

### Environment
- Added `@anthropic-ai/sdk` dependency
- Added `ANTHROPIC_API_KEY` to `.env.local.example`

## Deviations from Plan

None -- plan executed as written.

## Key Files

| File | Purpose |
|------|---------|
| `web/scripts/006_coaching.sql` | DB migration |
| `web/lib/coaching/generate.ts` | Core coaching generation logic |
| `web/app/api/coaching/generate/route.ts` | Generate API route |
| `web/app/api/coaching/feedback/route.ts` | Feedback API route |
| `web/app/(main)/dashboard/components/coaching-section.tsx` | Dashboard UI component |

## Commit
- `11bad1b`: feat(coaching): phase 17 AI coaching engine
