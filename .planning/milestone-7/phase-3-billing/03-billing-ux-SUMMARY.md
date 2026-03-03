# Phase 3 Plan 03: Billing UX & Production Guards Summary

**Requirements:** BILL-04, BILL-05, BILL-06
**Commit:** 86decb4
**Duration:** ~7 min

## One-liner

Fixed misleading cancel button to clear Stripe portal redirect, added payment retry UI with API endpoint for past_due users, and added production Stripe key guards in both Express and Next.js.

## What Was Done

### Task 1: Fix cancel button UX (BILL-04)
- Replaced two-step "Cancel subscription" -> "Yes, cancel" flow that just opened Stripe portal
- New UI: single "Manage in Stripe" button with clear explanatory copy
- Removed unused `cancelConfirm` state variable

### Task 2: Add payment retry UI (BILL-05)
- Added red payment failed banner at top of billing page when `subscription_status === 'past_due'`
- Banner shows retry button and "Update payment method" link to Stripe portal
- Created `/api/billing/retry` endpoint that finds latest open invoice and calls `stripe.invoices.pay()`
- UI shows success/error feedback after retry attempt

### Task 3: Production Stripe key guard (BILL-06)
- Express `api/server.js`: Added check that exits with fatal error if `sk_test_` key used when `NODE_ENV=production`
- Next.js `web/lib/stripe.ts`: Added runtime throw if `sk_test_` key detected in production

## Files Changed

| Action | File |
|--------|------|
| Modified | `web/app/(main)/billing/billing-client.tsx` |
| Created | `web/app/api/billing/retry/route.ts` |
| Modified | `api/server.js` |
| Modified | `web/lib/stripe.ts` |

## Deviations from Plan

None - plan executed as written. Used Option A (label fix) for cancel button as specified.
