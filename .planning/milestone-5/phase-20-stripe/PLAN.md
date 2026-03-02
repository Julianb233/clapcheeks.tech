# Phase 20: Stripe Integration

## Status: PARTIALLY DONE

## What's Already Built

### Checkout Route (`web/app/api/stripe/checkout/route.ts`)
- Creates Stripe Checkout Sessions in `subscription` mode
- Looks up prices via `lookup_keys` (`base_monthly`, `elite_monthly`)
- Supports add-on line items (Profile Doctor $15, Super Opener $27, Turbo Session $9, Voice Calibration $97)
- Sets `client_reference_id` to Supabase user ID
- Stores `plan` and `user_id` in session metadata
- Redirects to `/home?success=true` on success, `/pricing` on cancel

### Webhook Route (`web/app/api/stripe/webhook/route.ts`)
- Verifies webhook signature with `STRIPE_WEBHOOK_SECRET`
- Uses Supabase admin client (service role key) for DB writes
- Handles 3 event types:
  - `checkout.session.completed` -- sets `stripe_customer_id`, `stripe_subscription_id`, `plan`, `subscription_status = 'active'`
  - `customer.subscription.updated` -- syncs `subscription_status`
  - `customer.subscription.deleted` -- sets `subscription_status = 'inactive'`, resets `plan = 'base'`

### Portal Route (`web/app/api/stripe/portal/route.ts`)
- Creates Stripe Customer Portal session
- Looks up `stripe_customer_id` from Supabase profile
- Returns portal URL; redirects back to `/home`

### Stripe Client (`web/lib/stripe.ts`)
- Initializes Stripe SDK with `STRIPE_SECRET_KEY`
- Fallback to `'sk_not_configured'` if env var missing

### Checkout Button (`web/components/checkout-button.tsx`)
- Client component that POSTs to `/api/stripe/checkout`
- Shows loading spinner during redirect
- Passes `plan` and optional `addons` array

### Pricing Page (`web/app/(main)/pricing/page.tsx`)
- Two tiers: Base ($97/mo) and Elite ($197/mo)
- Four add-ons with pricing
- Feature comparison table
- FAQ section

### Database Schema (`web/scripts/004_clap_cheeks_profile.sql`)
- `plan` column: TEXT, default 'base', CHECK ('base', 'elite')
- `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` columns
- Additional analytics columns (rizz_score, total_matches, etc.)

## Gaps Remaining

### 1. Stripe Dashboard Setup (Manual)
Products and Prices need to be created in the Stripe dashboard:
- **Product: Clap Cheeks Base** -- recurring price $97/mo with lookup key `base_monthly`
- **Product: Clap Cheeks Elite** -- recurring price $97/mo with lookup key `elite_monthly`
- **Product: Profile Doctor** -- one-time price $15 (note: checkout route uses `price_data` inline, not a stored price)
- **Product: Super Opener 10-pack** -- one-time price $27
- **Product: Turbo Session** -- one-time price $9
- **Product: Voice Calibration** -- one-time price $97

### 2. Webhook Endpoint Registration
- Register `https://clapcheeks.tech/api/stripe/webhook` in Stripe Dashboard > Webhooks
- Select events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET` env var

### 3. Missing Webhook Events
The current webhook handler is missing critical events:
- **`invoice.payment_failed`** -- no handler for failed payments (dunning)
- **`invoice.paid`** -- no handler for successful renewal confirmation
- **`customer.subscription.trial_will_end`** -- if trial periods are added

### 4. Idempotency
- Webhook handler lacks idempotency checks -- if Stripe retries a webhook, the same update runs again
- Should store processed event IDs to prevent duplicate processing
- Checkout route should include `idempotency_key` on `stripe.checkout.sessions.create` to prevent duplicate sessions on network retry

### 5. Failed Payment / Dunning Handling
- No `invoice.payment_failed` webhook handler
- No user notification when payment fails
- No grace period logic before downgrade
- No dunning email configuration in Stripe Dashboard (Smart Retries, email reminders)

### 6. Add-on Price Mismatch
- Checkout route uses `price_data` (inline prices) for add-ons, meaning they create a new price object each time
- Should use stored Stripe Prices with lookup keys for consistency
- Add-on IDs in checkout route use underscores (`profile_doctor`) but pricing page uses hyphens (`profile-doctor`) -- mismatch will cause add-ons to not be found

### 7. Customer Email Not Set
- Checkout session doesn't set `customer_email` -- Stripe will prompt for it
- Should pass authenticated user's email for pre-fill: `customer_email: user.email`

### 8. Existing Customer Handling
- No check for existing `stripe_customer_id` -- returning customers create duplicate Stripe Customers
- Should use `customer` param instead of `client_reference_id` for returning subscribers

## Technical Approach

### Webhook Idempotency
```typescript
// Add event tracking table
CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

// In webhook handler, check before processing:
const { data: existing } = await supabaseAdmin
  .from('stripe_events')
  .select('event_id')
  .eq('event_id', event.id)
  .single()

if (existing) return NextResponse.json({ received: true })

// After processing, insert:
await supabaseAdmin.from('stripe_events').insert({ event_id: event.id, event_type: event.type })
```

### Failed Payment Handler
```typescript
case 'invoice.payment_failed': {
  const invoice = event.data.object as Stripe.Invoice
  const customerId = invoice.customer as string
  const attemptCount = invoice.attempt_count

  if (attemptCount >= 3) {
    // After 3 failed attempts, downgrade
    await supabaseAdmin.from('profiles').update({
      subscription_status: 'past_due',
    }).eq('stripe_customer_id', customerId)
  }
  // TODO: Send notification to user about failed payment
  break
}
```

### Existing Customer Reuse
```typescript
// In checkout route, check for existing customer
const { data: profile } = await supabase
  .from('profiles')
  .select('stripe_customer_id')
  .eq('id', user.id)
  .single()

const sessionParams: Stripe.Checkout.SessionCreateParams = {
  mode: 'subscription',
  line_items: lineItems,
  success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/home?success=true`,
  cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/pricing`,
  metadata: { plan, user_id: user.id },
}

if (profile?.stripe_customer_id) {
  sessionParams.customer = profile.stripe_customer_id
} else {
  sessionParams.client_reference_id = user.id
  sessionParams.customer_email = user.email
}
```

## Implementation Steps

1. **Create Stripe Products/Prices** (manual, Stripe Dashboard)
   - Create Base and Elite products with monthly recurring prices
   - Set lookup keys: `base_monthly`, `elite_monthly`
   - Create add-on products with one-time prices and lookup keys

2. **Register Webhook Endpoint** (manual, Stripe Dashboard)
   - URL: `https://clapcheeks.tech/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`
   - Set `STRIPE_WEBHOOK_SECRET` env var

3. **Fix Add-on ID Mismatch**
   - Normalize add-on keys to use hyphens everywhere, or map in checkout route

4. **Add Webhook Idempotency**
   - Create `stripe_events` table
   - Add idempotency check to webhook handler

5. **Add Failed Payment Handler**
   - Handle `invoice.payment_failed` event
   - Implement grace period (mark `past_due` instead of immediate downgrade)
   - Configure Stripe Smart Retries in dashboard

6. **Fix Existing Customer Handling**
   - Check for `stripe_customer_id` before creating checkout session
   - Use `customer` param for returning subscribers
   - Pre-fill `customer_email` for new customers

7. **Configure Dunning in Stripe Dashboard** (manual)
   - Enable Smart Retries (retry schedule: days 1, 3, 5, 7)
   - Enable failed payment email notifications
   - Set subscription cancellation after final retry failure

8. **Add `invoice.paid` Handler**
   - Confirm subscription renewal in profiles table
   - Clear any `past_due` status

## Environment Variables Required

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Webhook endpoint not registered | Subscriptions never activate in DB | Manual checklist; test with Stripe CLI `stripe listen --forward-to` |
| Duplicate webhook processing | Double charges, data corruption | Idempotency table + event ID check |
| Failed payments not handled | Users stay active without paying | Add `invoice.payment_failed` handler + dunning config |
| Add-on ID mismatch | Add-ons silently dropped from checkout | Normalize IDs; add validation logging |
| Returning customer creates duplicate | Multiple Stripe Customers per user | Check `stripe_customer_id` before session create |

## Stripe Dashboard Dunning Configuration

1. Go to Settings > Billing > Subscriptions and emails
2. Enable Smart Retries
3. Set retry schedule: 1, 3, 5, 7 days after failure
4. Enable "Send emails when payments fail"
5. After final retry: cancel subscription (webhook handles DB cleanup)
