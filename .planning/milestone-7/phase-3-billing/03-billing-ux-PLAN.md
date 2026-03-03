---
plan: "Billing UX & Production Guards"
phase: "Phase 3: Billing Completion"
wave: 3
autonomous: true
requirements: [BILL-04, BILL-05, BILL-06]
goal: "Fix misleading cancel button, add payment retry UI, add Stripe key mode guard"
---

# Plan 03: Billing UX & Production Guards

**Phase:** Phase 3 — Billing Completion
**Requirements:** BILL-04, BILL-05, BILL-06
**Priority:** P1/P2
**Wave:** 3

## Context

- "Yes, cancel" button redirects to Stripe portal instead of cancelling — confusing UX
- No way for users with `past_due` status to retry payment within the app
- No check that live Stripe keys are used in production (test keys could accidentally go live)

## Tasks

### Task 1: Fix cancel button UX (BILL-04)

File: `web/app/(main)/billing/` — find the cancel subscription UI

Option A (preferred): Change button label to set clear expectations:
```tsx
// Instead of "Yes, cancel my subscription"
// Use: "Manage subscription in Stripe"
<button onClick={openPortal}>
  Manage in Stripe →
</button>
<p className="text-white/40 text-xs mt-1">
  You'll be redirected to Stripe to modify or cancel your subscription.
</p>
```

Option B: Implement in-app cancellation via API:
```typescript
// web/app/api/billing/cancel/route.ts
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // ... get stripe customer ID, call stripe.subscriptions.update({ cancel_at_period_end: true })
  // ... update DB status
}
```

Implement Option A (label fix) since it's lower risk and still correct. Option B is a future enhancement.

### Task 2: Add payment retry UI for past_due accounts (BILL-05)

1. In billing page, show retry button when `subscription_status === 'past_due'`:
   ```tsx
   {profile.subscription_status === 'past_due' && (
     <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
       <div className="text-red-400 font-semibold text-sm mb-1">Payment Failed</div>
       <p className="text-white/50 text-xs mb-3">
         Your last payment didn't go through. Please update your payment method or retry.
       </p>
       <button
         onClick={handleRetryPayment}
         className="text-sm bg-red-500/20 hover:bg-red-500/30 text-red-300 px-4 py-2 rounded-lg transition-colors"
       >
         Retry Payment
       </button>
     </div>
   )}
   ```

2. Create API route `web/app/api/billing/retry/route.ts`:
   ```typescript
   import Stripe from 'stripe'
   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

   export async function POST() {
     const supabase = await createClient()
     const { data: { user } } = await supabase.auth.getUser()
     if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

     const { data: profile } = await supabase
       .from('profiles')
       .select('stripe_customer_id')
       .eq('id', user.id)
       .single()

     // Get latest unpaid invoice and retry
     const invoices = await stripe.invoices.list({
       customer: profile.stripe_customer_id,
       status: 'open',
       limit: 1,
     })

     if (invoices.data.length === 0) {
       return NextResponse.json({ error: 'No open invoices found' }, { status: 404 })
     }

     await stripe.invoices.pay(invoices.data[0].id)

     return NextResponse.json({ ok: true, message: 'Payment retry initiated' })
   }
   ```

### Task 3: Add production mode guard for Stripe keys (BILL-06)

In `api/src/index.js` startup validation (alongside SEC-01 guard):
```javascript
// Guard against test keys in production
if (process.env.NODE_ENV === 'production') {
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  if (stripeKey.startsWith('sk_test_')) {
    console.error('[FATAL] STRIPE_SECRET_KEY is a test key but NODE_ENV=production')
    console.error('Use live Stripe keys in production. Refusing to start.')
    process.exit(1)
  }
}
```

Also add to Next.js API entry or `next.config.ts`:
```typescript
// In a server-only utility or stripe.ts initialization
if (process.env.NODE_ENV === 'production' && process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('Using Stripe test keys in production is not allowed')
}
```

## Acceptance Criteria

- [ ] Cancel button labeled "Manage in Stripe" with explanatory copy (not "Yes, cancel")
- [ ] `past_due` accounts see a "Retry Payment" button on billing page
- [ ] Retry payment API endpoint created and functional
- [ ] Server exits with fatal error if `sk_test_` key used in production
- [ ] Error message clearly identifies the problem and solution

## Files to Modify

- `web/app/(main)/billing/billing-client.tsx` (or equivalent) — fix cancel label, add retry UI
- `web/app/api/billing/retry/route.ts` — NEW file
- `api/src/index.js` — test key guard
