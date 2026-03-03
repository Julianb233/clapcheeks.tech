---
plan: "Real Metrics & Auth Protection"
phase: "Phase 5: Frontend Polish"
wave: 1
autonomous: true
requirements: [FE-01, FE-02]
goal: "Remove fake hero metric, add server-side auth redirect to analytics page"
---

# Plan 01: Real Metrics & Auth Protection

**Phase:** Phase 5 — Frontend Polish
**Requirements:** FE-01, FE-02
**Priority:** P0/P1
**Wave:** 1

## Context

- Hero section shows hardcoded "2,400+ dates booked this month" — fake social proof that's a legal/trust liability
- Analytics page (`web/app/(main)/analytics/page.tsx`) is a client component with no server-side auth check — page shell loads for unauthenticated users

## Tasks

### Task 1: Remove hardcoded fake metric from hero (FE-01)

File: `web/app/components/hero-animated.tsx` (or wherever the "2,400+ dates booked" text lives)

Option A (fastest, cleanest): Remove the stat entirely
```tsx
// Before:
<div className="text-white/60 text-sm">2,400+ dates booked this month</div>

// After: Remove this element completely
```

Option B: Replace with real aggregate from API:
```tsx
const [datesBooked, setDatesBooked] = useState<number | null>(null)

useEffect(() => {
  fetch('/api/stats/aggregate')
    .then(r => r.json())
    .then(d => setDatesBooked(d.dates_booked_this_month))
    .catch(() => {})
}, [])

// Only show if we have real data
{datesBooked !== null && datesBooked > 0 && (
  <div className="text-white/60 text-sm">{datesBooked.toLocaleString()}+ dates booked this month</div>
)}
```

**Implement Option A** (remove entirely). We don't have a real aggregate endpoint yet, and showing nothing is better than showing a lie. Can add real stats later.

Search for ALL instances of this metric:
```bash
grep -r "2,400\|2400\|dates booked" web/app/ web/components/
```
Remove every instance.

### Task 2: Add server-side auth redirect to analytics page (FE-02)

File: `web/app/(main)/analytics/page.tsx`

The page is currently `'use client'` with no auth gate. Convert to a server component wrapper:

1. Create a server component that checks auth:
   ```tsx
   // web/app/(main)/analytics/page.tsx
   import { redirect } from 'next/navigation'
   import { createClient } from '@/lib/supabase/server'
   import AnalyticsClient from './analytics-client'

   export default async function AnalyticsPage() {
     const supabase = await createClient()
     const { data: { user } } = await supabase.auth.getUser()

     if (!user) {
       redirect('/auth/login')
     }

     return <AnalyticsClient />
   }
   ```

2. Move all the existing client-side code to `analytics-client.tsx`:
   ```tsx
   // web/app/(main)/analytics/analytics-client.tsx
   'use client'

   // ... all the existing useEffect, useState, chart rendering code ...
   ```

3. Remove the `console.error('Analytics fetch error')` while we're in this file (also covers FE-04):
   ```tsx
   // Before:
   } catch (err) {
     console.error('Analytics fetch error', err)
   }

   // After:
   } catch {
     // silent in production
   }
   ```

## Acceptance Criteria

- [ ] No "2,400+" or "dates booked" text anywhere in the codebase
- [ ] `grep -r "2,400\|dates booked" web/` returns no results
- [ ] Visiting `/analytics` without a session redirects to `/auth/login`
- [ ] Visiting `/analytics` with a valid session still works normally
- [ ] No `console.error` in analytics page (bonus: covers FE-04)

## Files to Modify

- `web/app/components/hero-animated.tsx` — remove fake metric
- `web/app/(main)/analytics/page.tsx` — convert to server component with auth check
- `web/app/(main)/analytics/analytics-client.tsx` — NEW file (extracted client code)
