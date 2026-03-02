# Phase 20: Stripe Integration Gaps — Summary

## One-liner
Webhook idempotency via stripe_events table, invoice.payment_failed/paid handlers, customer reuse in checkout, email pre-fill

## What Was Done

### Task 1: Add invoice.payment_failed webhook handler
- Added handler that sets `subscription_status = 'past_due'` when payment fails
- Triggers on any failed invoice, marks account immediately

### Task 2: Add invoice.paid webhook handler
- Clears `past_due` status back to `active` on successful payment
- Handles renewal confirmation after retry succeeds

### Task 3: Enhance customer.subscription.updated handler
- Now syncs `plan` field based on price lookup key (elite_monthly vs base_monthly)
- Supports plan upgrades/downgrades via Stripe Customer Portal

### Task 4: Webhook idempotency
- Created `stripe_events` table (005_stripe_events.sql) with event_id primary key
- All webhook events checked against table before processing
- After processing, event recorded to prevent duplicate handling on retries

### Task 5: Existing customer handling in checkout
- Checkout route now checks for existing `stripe_customer_id` on profile
- Returning customers use `customer` param (no duplicate Stripe customers)
- New customers get `client_reference_id` and `customer_email` pre-filled

### Task 6: Idempotency key on checkout session creation
- Added `idempotencyKey` to `stripe.checkout.sessions.create` call
- Prevents duplicate checkout sessions on network retries

### Task 7: Normalize addon key format
- ADDON_PRICES map now accepts both hyphen (`profile-doctor`) and underscore (`profile_doctor`) formats
- Fixes mismatch between pricing page (hyphens) and checkout route (underscores)

## Files Modified
- `web/app/api/stripe/webhook/route.ts` — Added 3 event handlers + idempotency
- `web/app/api/stripe/checkout/route.ts` — Customer reuse, email prefill, idempotency key, addon normalization
- `web/scripts/005_stripe_events.sql` — New migration for idempotency table

## Deviations from Plan
None — plan executed as written.

## Commit
- `3d98271` feat(stripe): phase 20 stripe integration gaps
