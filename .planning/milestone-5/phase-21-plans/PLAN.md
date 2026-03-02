# Phase 21: Subscription Plans -- Feature Gating

## Status: PARTIALLY DONE

## What's Already Built

### Database
- `profiles.plan` column with CHECK constraint: `'base'` or `'elite'`
- `profiles.subscription_status` column (values: `'active'`, `'inactive'`, `'past_due'`)
- Webhook syncs plan and status from Stripe events

### Pricing Page
- Two-tier pricing displayed: Base ($97/mo), Elite ($197/mo)
- Feature comparison table showing Base vs Elite differences
- Checkout flow wired up with plan parameter

### Defined Feature Split (from pricing page)
| Feature | Base | Elite |
|---------|------|-------|
| Dating apps | 1 | Unlimited |
| Daily AI swipes | 500 | Unlimited |
| iMessage AI | Yes | Yes |
| Voice tuning | No | Yes |
| Analytics | Basic | Full + heatmaps |
| Conversion tracking | No | Yes |
| AI coaching | No | Yes |
| Date booking & calendar sync | No | Yes |
| Weekly summary report | Yes | Yes |
| Support | Email | Priority + Slack |
| Early access | No | Yes |
| API access | No | Yes |

## Gaps Remaining

### 1. No Feature Gating Enforcement
The `plan` column exists but nothing checks it. All features are accessible to all users regardless of plan.

### 2. No Subscription Check Middleware
No server-side middleware verifies subscription status before allowing access to protected routes or API endpoints.

### 3. No Client-Side Plan Awareness
UI components don't conditionally render based on user's plan. Elite-only features show to all users.

### 4. No Upgrade Prompts
When a Base user encounters an Elite feature, there's no upgrade CTA or paywall.

### 5. No Free/Unpaid State Handling
No logic for users who haven't subscribed yet (subscription_status = 'inactive').

## Technical Approach

### Server-Side: Plan Check Utility
Create a reusable plan check function, not middleware. Next.js App Router doesn't support traditional middleware for API routes cleanly. Use a utility function called at the top of protected routes.

```typescript
// lib/plan-check.ts
import { createClient } from '@/lib/supabase/server'

export type PlanLevel = 'base' | 'elite'

export interface PlanInfo {
  plan: PlanLevel
  subscriptionStatus: string
  isActive: boolean
  isElite: boolean
}

export async function getPlanInfo(): Promise<PlanInfo | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, subscription_status')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  return {
    plan: profile.plan as PlanLevel,
    subscriptionStatus: profile.subscription_status,
    isActive: profile.subscription_status === 'active',
    isElite: profile.plan === 'elite' && profile.subscription_status === 'active',
  }
}

export function requireElite(planInfo: PlanInfo | null): Response | null {
  if (!planInfo || !planInfo.isActive) {
    return new Response(JSON.stringify({ error: 'Subscription required' }), { status: 403 })
  }
  if (!planInfo.isElite) {
    return new Response(JSON.stringify({ error: 'Elite plan required', upgrade: true }), { status: 403 })
  }
  return null
}
```

### Client-Side: Plan Context Provider
```typescript
// contexts/plan-context.tsx
'use client'
import { createContext, useContext } from 'react'

interface PlanContextType {
  plan: 'base' | 'elite' | null
  isActive: boolean
  isElite: boolean
}

const PlanContext = createContext<PlanContextType>({
  plan: null, isActive: false, isElite: false
})

export const usePlan = () => useContext(PlanContext)
export { PlanContext }
```

### Feature Gate Component
```typescript
// components/feature-gate.tsx
'use client'
import { usePlan } from '@/contexts/plan-context'
import Link from 'next/link'

export function EliteOnly({ children, fallback }: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const { isElite } = usePlan()

  if (!isElite) {
    return fallback ?? (
      <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
        <p className="text-white/50 text-sm mb-2">Elite feature</p>
        <Link href="/pricing" className="text-brand-400 text-sm font-medium hover:underline">
          Upgrade to Elite
        </Link>
      </div>
    )
  }

  return <>{children}</>
}
```

## Elite-Only Features to Gate

These features should be wrapped in plan checks:

| Feature | Gate Location | Type |
|---------|--------------|------|
| Autopilot (auto-swipe) | Automation controller API | Server-side |
| Match Intel (deep profile analysis) | Analytics API endpoint | Server-side |
| Ghost Hunter (inactive match detection) | Analytics API endpoint | Server-side |
| Date Closer (date scheduling AI) | Conversation AI endpoint | Server-side |
| Voice Calibration | iMessage AI settings | Server-side + UI |
| Full analytics + heatmaps | Analytics dashboard page | Client-side |
| Conversion tracking | Analytics dashboard page | Client-side |
| AI coaching | Coaching API endpoint | Server-side |
| Date booking & calendar sync | Calendar integration | Server-side + UI |
| API access | API key management | Server-side |
| Multiple dating apps | Automation controller | Server-side |

## Implementation Steps

1. **Create Plan Check Utility**
   - `lib/plan-check.ts` with `getPlanInfo()` and `requireElite()`
   - Returns plan, subscription status, and boolean helpers

2. **Create Plan Context Provider**
   - `contexts/plan-context.tsx` with React Context
   - Populated from server component in layout, passed to client

3. **Add Plan to Dashboard Layout**
   - In the main dashboard layout, fetch profile plan info
   - Pass to PlanContext.Provider wrapping dashboard children

4. **Create Feature Gate Components**
   - `EliteOnly` wrapper component with upgrade CTA fallback
   - `SubscriptionRequired` wrapper for any-plan features
   - `PlanBadge` component showing current plan in nav/sidebar

5. **Gate Server-Side API Routes**
   - Add `getPlanInfo()` + `requireElite()` check to Elite-only API routes
   - Return 403 with `{ error: 'Elite plan required', upgrade: true }` for gated features

6. **Gate Client-Side UI**
   - Wrap Elite-only dashboard sections in `EliteOnly` component
   - Show upgrade CTA with feature preview (blurred/locked state)

7. **Handle Unpaid/Inactive Users**
   - Users with `subscription_status !== 'active'` see subscription-required prompt
   - Redirect to pricing page from protected dashboard routes
   - Allow access to settings and billing management even when inactive

8. **Add Upgrade Flow**
   - "Upgrade to Elite" button triggers checkout with `plan: 'elite'`
   - For existing subscribers, redirect to Stripe Customer Portal for plan change
   - Show success toast after returning from checkout

9. **Downgrade Handling**
   - When subscription deleted (webhook), reset plan to 'base'
   - Already handled in webhook: `plan: 'base'` on `customer.subscription.deleted`
   - Elite features immediately gated on next page load (plan context re-fetches)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Plan check adds latency | Slower page loads | Cache plan info in session/cookie, re-validate on navigation |
| Stale plan data after upgrade | User doesn't see Elite features immediately | Revalidate plan context on return from Stripe checkout (check `?success=true` param) |
| Missing gate on a feature | Free access to paid feature | Audit checklist of all Elite features; default-deny approach |
| Downgrade leaves orphan data | Elite data visible on Base plan | Gate display, don't delete data (they might re-upgrade) |
