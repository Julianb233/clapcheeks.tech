# Phase 3 Plan 01: Payment Failure Handling & Trial Periods Summary

**Requirements:** BILL-01, BILL-02
**Commit:** ea631f1
**Duration:** ~10 min

## One-liner

7-day grace period on payment failure with access_expires_at column, trialing status handling with trial_end tracking, and 402 enforcement in requirePlan middleware.

## What Was Done

### Task 1: Handle invoice.payment_failed with grace period (BILL-01)
- Updated `invoice.payment_failed` webhook to set `access_expires_at` to now + 7 days
- Logs payment failure with user email and expiry date
- `invoice.paid` clears `access_expires_at` on successful payment
- `customer.subscription.deleted` clears all billing fields and sets status to `canceled`

### Task 2: Handle trialing subscription status (BILL-02)
- `customer.subscription.updated` now handles `trialing` status, grants pro-level access during trial
- Stores `trial_end` timestamp from Stripe subscription object
- Added `customer.subscription.trial_will_end` event handler (logs upcoming expiry)
- `requirePlan` middleware checks both `access_expires_at` and `trial_end` — returns 402 when expired

### Migration
- Created `20260303000008_billing_fields.sql`: adds `access_expires_at` and `trial_end` columns with index

## Files Changed

| Action | File |
|--------|------|
| Modified | `web/app/api/stripe/webhook/route.ts` |
| Modified | `api/middleware/requirePlan.js` |
| Created | `supabase/migrations/20260303000008_billing_fields.sql` |

## Deviations from Plan

None - plan executed as written.
