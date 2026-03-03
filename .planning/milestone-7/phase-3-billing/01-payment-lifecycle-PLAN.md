---
plan: "Payment Failure Handling & Trial Periods"
phase: "Phase 3: Billing Completion"
wave: 1
autonomous: true
requirements: [BILL-01, BILL-02]
goal: "Implement 7-day grace period on payment failure, handle trialing subscription status end-to-end"
---

# Plan 01: Payment Failure Handling & Trial Periods

**Phase:** Phase 3 — Billing Completion
**Requirements:** BILL-01, BILL-02
**Priority:** P0 (hard blockers)
**Wave:** 1

## Context

- Failed payments set status to `past_due` but access never cuts off — subscribers get free access indefinitely
- `trialing` Stripe status not handled in webhook; trial users get set to `active` immediately
- No email notification on payment failure

## Tasks

### Task 1: Handle invoice.payment_failed with grace period (BILL-01)

Find the Stripe webhook handler. Likely in `api/src/routes/stripe.js` or `web/app/api/stripe/webhook/route.ts`.

1. Add handler for `invoice.payment_failed` event:
   ```javascript
   case 'invoice.payment_failed': {
     const invoice = event.data.object
     const customerId = invoice.customer

     // Look up user by customer ID
     const { data: profile } = await supabase
       .from('profiles')
       .select('id, email')
       .eq('stripe_customer_id', customerId)
       .single()

     if (!profile) break

     // Set grace period — access expires in 7 days
     const graceExpiry = new Date()
     graceExpiry.setDate(graceExpiry.getDate() + 7)

     await supabase
       .from('profiles')
       .update({
         subscription_status: 'past_due',
         access_expires_at: graceExpiry.toISOString(),
       })
       .eq('id', profile.id)

     // TODO: Send email notification (can use Supabase email or Resend)
     // For now, log it clearly
     console.log(`[BILLING] Payment failed for ${profile.email} — access expires ${graceExpiry.toISOString()}`)
     break
   }
   ```

2. Add cron or check in access middleware:
   - When user requests any gated route, check `access_expires_at`
   - If past due AND `access_expires_at < now()`, reject with payment required message

3. Handle `customer.subscription.deleted` — revoke access immediately:
   ```javascript
   case 'customer.subscription.deleted': {
     await supabase
       .from('profiles')
       .update({ subscription_status: 'canceled', subscription_tier: 'free' })
       .eq('stripe_customer_id', event.data.object.customer)
     break
   }
   ```

### Task 2: Handle trialing subscription status (BILL-02)

1. In webhook handler, fix `customer.subscription.updated` and `checkout.session.completed`:
   ```javascript
   case 'customer.subscription.updated': {
     const sub = event.data.object
     const status = sub.status // 'trialing', 'active', 'past_due', 'canceled'

     await supabase
       .from('profiles')
       .update({
         subscription_status: status,
         // Only set tier if not trialing (trial may have different access level)
         subscription_tier: status === 'trialing' ? 'pro' : mapPriceToTier(sub.items.data[0].price.id),
         trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
       })
       .eq('stripe_customer_id', sub.customer)
     break
   }
   ```

2. Handle `customer.subscription.trial_will_end` (fires 3 days before trial ends):
   ```javascript
   case 'customer.subscription.trial_will_end': {
     const sub = event.data.object
     // Log/notify user their trial is ending soon
     console.log(`[BILLING] Trial ending soon for customer ${sub.customer}`)
     // TODO: send email "Your trial ends in 3 days"
     break
   }
   ```

3. Add `trial_end` and `access_expires_at` columns to profiles if not present:
   ```sql
   -- Migration: supabase/migrations/20260303000008_billing_fields.sql
   ALTER TABLE profiles
     ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
     ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
   ```

4. In `requirePlan` middleware, check trial access:
   ```javascript
   const now = new Date()
   if (status === 'trialing' && profile.trial_end && new Date(profile.trial_end) < now) {
     return res.status(402).json({ error: 'Trial expired. Please subscribe to continue.' })
   }
   ```

## Acceptance Criteria

- [ ] `invoice.payment_failed` sets `subscription_status: 'past_due'` and `access_expires_at: now + 7 days`
- [ ] After grace period, gated API routes return 402/403 with upgrade message
- [ ] `trialing` status stored correctly in DB after checkout
- [ ] `customer.subscription.trial_will_end` event handled (logs)
- [ ] `trial_end` and `access_expires_at` columns exist in profiles table
- [ ] Webhook logs payment events with email and expiry info

## Files to Modify

- `api/src/routes/stripe.js` OR `web/app/api/stripe/webhook/route.ts` — webhook handlers
- `supabase/migrations/20260303000008_billing_fields.sql` — NEW migration
- `api/src/middleware/requirePlan.js` — check `access_expires_at` and trial status
