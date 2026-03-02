# Phase 22: Usage Limits

## Status: NOT STARTED

## Overview

Enforce per-plan daily usage limits for swipes, AI calls, and connected apps. The pricing page already defines limits (Base: 500 swipes/day, 1 app; Elite: unlimited). This phase implements the enforcement.

## Plan Limits Definition

| Resource | Base | Elite |
|----------|------|-------|
| AI swipes per day | 500 | Unlimited |
| AI coaching calls per day | 5 | Unlimited |
| AI reply suggestions per day | 20 | Unlimited |
| Connected dating apps | 1 | Unlimited (3+) |
| Profile Doctor uses per month | 0 (add-on only) | 1 free, then add-on |
| Super Opener generations per day | 3 | 20 |

## Technical Approach: Supabase Counter Table

Use a Supabase table for usage tracking rather than Redis. Rationale:
- Project already uses Supabase exclusively (no Redis in stack)
- Usage checks are not high-frequency (swipes are rate-limited by automation already)
- Counter resets are daily, handled by a Supabase cron or pg_cron
- Avoids adding infrastructure (Redis/Upstash) for a simple counter

### Usage Tracking Table

```sql
CREATE TABLE usage_counters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  resource TEXT NOT NULL,  -- 'swipes', 'ai_coaching', 'ai_replies', 'openers'
  count INTEGER DEFAULT 0,
  period_start DATE DEFAULT CURRENT_DATE,
  UNIQUE(user_id, resource, period_start)
);

CREATE INDEX idx_usage_counters_lookup
  ON usage_counters(user_id, resource, period_start);
```

### Increment + Check Function

```sql
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_resource TEXT,
  p_limit INTEGER
) RETURNS JSON AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO usage_counters (user_id, resource, count, period_start)
  VALUES (p_user_id, p_resource, 1, CURRENT_DATE)
  ON CONFLICT (user_id, resource, period_start)
  DO UPDATE SET count = usage_counters.count + 1
  RETURNING count INTO v_count;

  IF p_limit > 0 AND v_count > p_limit THEN
    RETURN json_build_object('allowed', false, 'count', v_count, 'limit', p_limit);
  END IF;

  RETURN json_build_object('allowed', true, 'count', v_count, 'limit', p_limit);
END;
$$ LANGUAGE plpgsql;
```

### Usage Check Utility (TypeScript)

```typescript
// lib/usage-limits.ts
import { createClient } from '@/lib/supabase/server'

const PLAN_LIMITS = {
  base: {
    swipes: 500,
    ai_coaching: 5,
    ai_replies: 20,
    openers: 3,
  },
  elite: {
    swipes: 0,      // 0 = unlimited
    ai_coaching: 0,
    ai_replies: 0,
    openers: 20,
  },
} as const

export async function checkUsage(
  userId: string,
  plan: 'base' | 'elite',
  resource: keyof typeof PLAN_LIMITS.base
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const limit = PLAN_LIMITS[plan][resource]

  if (limit === 0) {
    return { allowed: true, count: 0, limit: 0 } // unlimited
  }

  const supabase = createClient()
  const { data } = await supabase.rpc('increment_usage', {
    p_user_id: userId,
    p_resource: resource,
    p_limit: limit,
  })

  return data ?? { allowed: false, count: 0, limit }
}

export async function getUsageSummary(userId: string, plan: 'base' | 'elite') {
  const supabase = createClient()
  const { data: counters } = await supabase
    .from('usage_counters')
    .select('resource, count')
    .eq('user_id', userId)
    .eq('period_start', new Date().toISOString().split('T')[0])

  const limits = PLAN_LIMITS[plan]
  const summary: Record<string, { used: number; limit: number; percentage: number }> = {}

  for (const [resource, limit] of Object.entries(limits)) {
    const counter = counters?.find(c => c.resource === resource)
    const used = counter?.count ?? 0
    summary[resource] = {
      used,
      limit: limit === 0 ? Infinity : limit,
      percentage: limit === 0 ? 0 : Math.round((used / limit) * 100),
    }
  }

  return summary
}
```

### Communicating Limits to Local Agent

The local agent (macOS CLI) makes API calls to the cloud. Usage enforcement happens server-side:

```typescript
// API response format when limit is hit
{
  "error": "Usage limit reached",
  "code": "LIMIT_EXCEEDED",
  "resource": "swipes",
  "used": 500,
  "limit": 500,
  "resets_at": "2026-03-02T00:00:00Z"
}

// API response headers for usage info (on every successful request)
// X-Usage-Swipes-Used: 342
// X-Usage-Swipes-Limit: 500
// X-Usage-Swipes-Reset: 2026-03-02T00:00:00Z
```

### Graceful Degradation

When limits are hit:
- **Swipes**: Pause automation, show "Daily limit reached. Resets at midnight." message. Don't hard-stop -- queue remaining swipes for next day.
- **AI calls**: Return a friendly message instead of AI response: "You've used all your AI coaching sessions today. Upgrade to Elite for unlimited."
- **Connected apps**: Prevent adding new app connections, don't disconnect existing ones.

### Daily Reset

```sql
-- pg_cron job to clean up old counters (keep 30 days for analytics)
SELECT cron.schedule('cleanup-usage-counters', '0 1 * * *',
  $$DELETE FROM usage_counters WHERE period_start < CURRENT_DATE - INTERVAL '30 days'$$
);
```

No explicit reset needed -- new day = new `period_start` value = new counter row.

## Connected Apps Limit

Separate from daily counters. Enforce at app-connection time:

```typescript
// When user tries to connect a new dating app
const { data: connectedApps } = await supabase
  .from('connected_apps')
  .select('id')
  .eq('user_id', userId)

const appLimit = plan === 'base' ? 1 : Infinity
if (connectedApps && connectedApps.length >= appLimit) {
  return { error: 'App limit reached', upgrade: true }
}
```

## Implementation Steps

1. **Create Usage Counter Migration**
   - `usage_counters` table with composite unique constraint
   - `increment_usage` RPC function
   - Index for fast lookups

2. **Create Usage Limits Utility**
   - `lib/usage-limits.ts` with `checkUsage()` and `getUsageSummary()`
   - Plan limits constants

3. **Add Usage Checks to Automation API**
   - Before executing swipes, call `checkUsage(userId, plan, 'swipes')`
   - Return 429 with limit info if exceeded

4. **Add Usage Checks to AI Endpoints**
   - Coaching endpoint: check `ai_coaching` limit
   - Reply suggestion endpoint: check `ai_replies` limit
   - Opener generation: check `openers` limit

5. **Add Usage Response Headers**
   - On every successful API response, include `X-Usage-*` headers
   - Local agent can read these to show usage progress to user

6. **Add Connected Apps Limit Check**
   - Check app count on connection attempt
   - Return upgrade prompt if limit reached

7. **Add Usage Summary API Endpoint**
   - `GET /api/usage` returns current usage across all resources
   - Used by dashboard (Phase 23) and local agent

8. **Set Up pg_cron Cleanup**
   - Schedule old counter cleanup to prevent table bloat
   - Keep 30 days of history for analytics

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supabase counter has write contention | Slow increment under load | UPSERT with ON CONFLICT is atomic; single user won't have concurrent writes |
| User changes timezone to dodge reset | Gets extra swipes | Use UTC for all period_start dates; server-side only |
| Limit too strict, users churn | Revenue loss | Start generous, tighten based on data; Elite unlimited removes friction |
| Counter table grows large | Slow queries | Daily cleanup of 30+ day old rows; indexed on (user_id, resource, period_start) |
| Local agent caches stale limits | Continues past limit | Server rejects requests past limit regardless of client cache |
