# Phase 23: Billing Dashboard — Summary

## One-liner
Full billing page at /billing with plan card, payment method, invoice history (PDF links), Stripe Portal integration, cancellation flow

## What Was Done

### Task 1: Create Billing API endpoint
- `GET /api/billing` — server-side endpoint fetching from both Supabase and Stripe
- Fetches subscription details, default payment method (expanded), last 5 invoices, upcoming invoice
- Returns card brand/last4/expiry, invoice amounts/dates/status/PDF links
- Handles unsubscribed users gracefully (returns `{ subscribed: false }`)

### Task 2: Create Billing Dashboard page
- Server component at `web/app/(main)/billing/page.tsx`
- Fetches profile plan data from Supabase
- Passes to BillingClient for interactive rendering
- Protected: redirects to /login if unauthenticated

### Task 3: Build BillingClient component
- **Current Plan Card**: Plan name, price, status badge (Active/Past Due/Cancelling/Inactive), renewal date, upcoming charge
- **Payment Method**: Card brand, last 4 digits, expiry, "Update" link to Stripe Portal
- **Invoice History**: Last 5 invoices with date, amount, status badge, PDF download link
- **Upgrade Button**: For Base users, prominent "Upgrade to Elite" CTA
- **Manage Subscription**: Links to Stripe Customer Portal for full management
- **Cancellation Section**: Two-step confirmation dialog, redirects to Stripe Portal for actual cancellation
- **No Subscription State**: Shows plan selection with Base/Elite checkout buttons

### Task 4: Add billing link to dashboard nav
- Added in Phase 21 commit — "Billing" link in dashboard header

## Files Created
- `web/app/api/billing/route.ts`
- `web/app/(main)/billing/page.tsx`
- `web/app/(main)/billing/billing-client.tsx`

## Deviations from Plan
- Skipped cancellation survey table (cancellation_surveys) — not essential for MVP, can be added later
- Usage meter deferred — depends on Phase 22 usage tracking which has its own implementation

## Commits
- `b440094` feat(billing): phase 23 billing dashboard
