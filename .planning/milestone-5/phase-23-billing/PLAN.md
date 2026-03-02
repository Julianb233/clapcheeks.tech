# Phase 23: Billing Dashboard

## Status: PARTIALLY DONE

## What's Already Built

### Stripe Customer Portal (`web/app/api/stripe/portal/route.ts`)
- Creates Stripe Customer Portal session via `stripe.billingPortal.sessions.create`
- Looks up `stripe_customer_id` from profile
- Returns portal URL, redirects back to `/home`
- Portal handles: payment method updates, subscription cancellation, invoice history

### Database Fields
- `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` on profiles table
- Plan stored as `'base'` or `'elite'`

## Gaps Remaining

### 1. No Billing Dashboard Page
No `/billing` or `/settings/billing` page exists in the dashboard. Users have no way to see their plan, usage, or manage billing from within the app.

### 2. No Invoice List
Invoices are only viewable through Stripe Customer Portal (external redirect). No in-app invoice display.

### 3. No Usage Meter
No visual representation of daily usage against limits.

### 4. No Plan Upgrade/Downgrade Flow
No in-app upgrade button (only pricing page checkout for new subscriptions). No downgrade flow.

### 5. No Cancellation Flow
No cancel button or offboarding survey within the app. Only via Stripe Customer Portal.

## Technical Approach

### Billing Page Structure
```
web/app/(main)/settings/billing/
  page.tsx           -- Server component, fetches billing data
  billing-client.tsx -- Client component, interactive elements
```

### Data Sources

**From Supabase (fast, already available):**
- Current plan (base/elite)
- Subscription status
- Usage counters (from Phase 22)

**From Stripe API (server-side fetch):**
- Invoices list: `stripe.invoices.list({ customer: stripeCustomerId, limit: 12 })`
- Current subscription details: `stripe.subscriptions.retrieve(subscriptionId)`
- Upcoming invoice: `stripe.invoices.retrieveUpcoming({ customer: stripeCustomerId })`
- Payment method: from subscription's `default_payment_method`

### Billing API Endpoint

```typescript
// app/api/billing/route.ts
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized()

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, subscription_status, stripe_customer_id, stripe_subscription_id')
    .eq('id', user.id)
    .single()

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ subscribed: false })
  }

  const [subscription, invoices, upcoming] = await Promise.all([
    stripe.subscriptions.retrieve(profile.stripe_subscription_id, {
      expand: ['default_payment_method'],
    }),
    stripe.invoices.list({ customer: profile.stripe_customer_id, limit: 12 }),
    stripe.invoices.retrieveUpcoming({ customer: profile.stripe_customer_id }).catch(() => null),
  ])

  return NextResponse.json({
    subscribed: true,
    plan: profile.plan,
    status: profile.subscription_status,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    paymentMethod: subscription.default_payment_method,
    invoices: invoices.data.map(inv => ({
      id: inv.id,
      date: inv.created,
      amount: inv.amount_paid,
      status: inv.status,
      pdf: inv.invoice_pdf,
    })),
    upcomingAmount: upcoming?.amount_due,
    upcomingDate: upcoming?.next_payment_attempt,
  })
}
```

### Billing Dashboard UI Components

**1. Plan Card**
- Current plan name and price
- Status badge (Active, Past Due, Cancelled)
- Next billing date and amount
- Upgrade/downgrade button
- Cancel subscription button

**2. Usage Meter**
- Progress bars showing daily usage vs limits
- Resources: swipes, AI calls, openers
- Color coding: green (<70%), yellow (70-90%), red (>90%)
- "Resets at midnight UTC" label

**3. Invoice History**
- Table: Date, Amount, Status, PDF download link
- Last 12 invoices
- Link to Stripe Customer Portal for full history

**4. Payment Method**
- Card brand, last 4 digits, expiry
- "Update payment method" button (opens Stripe Portal)

**5. Cancel/Downgrade Section**
- If Elite: "Downgrade to Base" option
- "Cancel subscription" with confirmation modal
- Offboarding survey: reason dropdown (too expensive, not using, found alternative, other)
- Store survey response in Supabase before redirecting to Stripe Portal for actual cancellation

### Upgrade/Downgrade Flow

**Upgrade (Base to Elite):**
1. User clicks "Upgrade to Elite" on billing page
2. Redirect to Stripe Customer Portal with `flow_data` for subscription update
3. Stripe handles proration and plan change
4. Webhook `customer.subscription.updated` fires, updates profile

```typescript
const session = await stripe.billingPortal.sessions.create({
  customer: profile.stripe_customer_id,
  return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/settings/billing?upgraded=true`,
  flow_data: {
    type: 'subscription_update',
    subscription_update: {
      subscription: profile.stripe_subscription_id,
    },
  },
})
```

**Downgrade (Elite to Base):**
Same flow via Customer Portal. Stripe handles proration. Webhook updates plan.

### Cancellation with Offboarding Survey

```typescript
// app/api/billing/cancel-survey/route.ts
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { reason, feedback } = await request.json()

  // Store survey response
  await supabaseAdmin.from('cancellation_surveys').insert({
    user_id: user.id,
    reason,
    feedback,
    created_at: new Date().toISOString(),
  })

  // Create portal session for actual cancellation
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/settings/billing`,
    flow_data: {
      type: 'subscription_cancel',
      subscription_cancel: {
        subscription: profile.stripe_subscription_id,
      },
    },
  })

  return NextResponse.json({ url: session.url })
}
```

## Implementation Steps

1. **Create Billing API Endpoint**
   - `GET /api/billing` returns plan, subscription details, invoices, upcoming invoice
   - Fetches from both Supabase (plan) and Stripe API (invoices, payment method)

2. **Create Billing Dashboard Page**
   - Server component at `app/(main)/settings/billing/page.tsx`
   - Client component for interactive elements

3. **Build Plan Card Component**
   - Show current plan, status, next billing date
   - Upgrade/downgrade button routing to Stripe Portal

4. **Build Usage Meter Component**
   - Fetch usage from `/api/usage` (Phase 22)
   - Progress bars with color coding
   - Real-time updates not needed (refresh on page load)

5. **Build Invoice History Table**
   - Display last 12 invoices from Stripe
   - PDF download links
   - Status badges (paid, open, void)

6. **Build Payment Method Display**
   - Show card info from Stripe subscription
   - "Update" button opens Stripe Portal

7. **Create Cancellation Flow**
   - Cancel button opens confirmation modal
   - Offboarding survey (reason dropdown + text feedback)
   - Store survey in `cancellation_surveys` table
   - Redirect to Stripe Portal for actual cancellation

8. **Create Cancellation Survey Migration**
   - `cancellation_surveys` table: id, user_id, reason, feedback, created_at

9. **Add Billing Link to Navigation**
   - Add "Billing" link to dashboard sidebar/settings menu

10. **Configure Stripe Customer Portal**
    - In Stripe Dashboard > Customer Portal settings
    - Enable: invoice history, payment method update, subscription cancellation
    - Configure cancellation to cancel at period end (not immediately)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Stripe API calls slow down billing page | Bad UX | Cache billing data, show skeleton loaders, parallel API calls |
| Customer Portal branding mismatch | Confusing UX | Configure Portal branding in Stripe Dashboard (logo, colors) |
| User cancels via Portal without survey | Lose feedback data | Accept this; survey is best-effort, not required |
| Proration confusion | Support tickets | Show clear messaging about proration on upgrade/downgrade |
