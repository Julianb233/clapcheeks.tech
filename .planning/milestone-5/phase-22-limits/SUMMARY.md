# Phase 22: Usage Limits Summary

Daily usage tracking and enforcement for per-plan limits using Supabase counter table with increment_usage RPC function.

## What Was Built

### Database
- `clapcheeks_usage_daily` table with composite unique on (user_id, date)
- `increment_usage` RPC function (SECURITY DEFINER) for atomic counter updates
- RLS policy for user-scoped reads

### Library (`lib/usage.ts`)
- `PLAN_LIMITS` constant: Base (500 swipes, 5 coaching, 20 AI replies), Elite (unlimited)
- `checkLimit(userId, field)` - checks if user has remaining quota
- `incrementUsage(userId, field)` - increments daily counter
- `getUsageSummary(userId)` - returns full usage across all resources
- Auto-detects user plan from `clapcheeks_subscriptions` table

### API
- `GET /api/usage` - returns today's usage + limits with X-RateLimit headers
- `/api/coaching/generate` - enforces coaching_calls limit before generating
- `/api/conversation/suggest` - enforces ai_replies limit before generating
- 429 responses include: error, code, resource, used, limit, message, resets_at

### Limit Enforcement Pattern
```
1. checkLimit(userId, 'coaching_calls')
2. If !allowed → return 429 with LIMIT_EXCEEDED
3. Do work
4. incrementUsage(userId, 'coaching_calls')
```

## Key Files
- `web/scripts/008_usage_limits.sql`
- `web/lib/usage.ts`
- `web/app/api/usage/route.ts`
- `web/app/api/coaching/generate/route.ts` (modified)
- `web/app/api/conversation/suggest/route.ts` (modified)

## Commit
- 354b626: feat(limits): phase 22 usage limits
