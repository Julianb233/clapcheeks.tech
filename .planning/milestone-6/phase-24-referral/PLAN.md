# Phase 24: Referral Program

## Status: NOT STARTED

## Overview

Users get 1 free month per successful referral. A referred user must start a paid subscription for the referrer to receive credit. Simple, viral, fraud-resistant.

## Referral Flow

1. User copies their unique referral link from dashboard
2. Friend visits `clapcheeks.tech/?ref=ABCDEF`
3. Referral code stored in cookie (30-day attribution window)
4. Friend signs up and starts paid subscription
5. After friend's first successful payment, referrer gets 1 month credit applied to their next invoice
6. Both parties notified via email

## Technical Approach

### Database Schema

```sql
-- Referral codes and tracking
CREATE TABLE referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID NOT NULL REFERENCES auth.users(id),
  ref_code TEXT NOT NULL UNIQUE,
  referred_user_id UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'signed_up', 'subscribed', 'credited', 'expired')),
  credit_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  converted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_referrals_code ON referrals(ref_code);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);

-- Each user gets one referral code (generated on first request)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ref_code TEXT UNIQUE;
```

### Referral Code Generation

```typescript
// lib/referral.ts
import { nanoid } from 'nanoid'

export function generateRefCode(): string {
  return nanoid(8).toUpperCase() // e.g., "A3BX9K2M"
}
```

### Referral Link Tracking

**Landing page middleware** (`middleware.ts`):
```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get('ref')
  if (ref) {
    const response = NextResponse.next()
    response.cookies.set('ref_code', ref, {
      maxAge: 30 * 24 * 60 * 60, // 30 days
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })
    return response
  }
  return NextResponse.next()
}
```

### Referral Attribution on Signup

In the auth callback or post-signup handler:
```typescript
// After successful signup, check for referral cookie
const refCode = cookies().get('ref_code')?.value
if (refCode) {
  // Find referral code owner
  const { data: referrer } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('ref_code', refCode)
    .single()

  if (referrer && referrer.id !== user.id) { // Prevent self-referral
    await supabaseAdmin.from('referrals').insert({
      referrer_id: referrer.id,
      ref_code: refCode,
      referred_user_id: user.id,
      status: 'signed_up',
    })
  }
}
```

### Credit Application on First Payment

In the Stripe webhook handler, on `invoice.paid`:
```typescript
case 'invoice.paid': {
  const invoice = event.data.object as Stripe.Invoice
  const customerId = invoice.customer as string

  // Check if this is a referred user's first payment
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (profile) {
    const { data: referral } = await supabaseAdmin
      .from('referrals')
      .select('id, referrer_id')
      .eq('referred_user_id', profile.id)
      .eq('status', 'signed_up')
      .single()

    if (referral) {
      // Mark as subscribed
      await supabaseAdmin.from('referrals').update({
        status: 'subscribed',
        converted_at: new Date().toISOString(),
      }).eq('id', referral.id)

      // Get referrer's Stripe customer ID
      const { data: referrerProfile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', referral.referrer_id)
        .single()

      if (referrerProfile?.stripe_customer_id) {
        // Apply credit via Stripe (1 month = plan price as credit)
        const referrerSub = await stripe.subscriptions.list({
          customer: referrerProfile.stripe_customer_id,
          limit: 1,
        })
        const monthlyAmount = referrerSub.data[0]?.items.data[0]?.price.unit_amount || 9700

        await stripe.customers.createBalanceTransaction(
          referrerProfile.stripe_customer_id,
          {
            amount: -monthlyAmount, // Negative = credit
            currency: 'usd',
            description: 'Referral credit - 1 free month',
          }
        )

        await supabaseAdmin.from('referrals').update({
          status: 'credited',
          credit_applied: true,
        }).eq('id', referral.id)
      }
    }
  }
  break
}
```

### Fraud Prevention

| Threat | Prevention |
|--------|-----------|
| Self-referral | Check `referrer_id !== referred_user_id` on attribution |
| Same household / shared IP | Not blocked -- too many false positives (roommates, couples) |
| Fake signups | Credit only after first successful Stripe payment |
| Bulk code abuse | Rate limit: max 10 referral credits per month per user |
| Code sharing on coupon sites | Monitor referral conversion rates; disable codes with >50 signups and <5% conversion |

### Referral Dashboard UI

```
/settings/referrals/
  - Your referral code + copy button
  - Share link: clapcheeks.tech/?ref=ABCDEF
  - Share buttons: Twitter, iMessage, Copy Link
  - Stats: Total referred, Signed up, Subscribed, Credits earned
  - Table: List of referrals with status badges
```

## Implementation Steps

1. **Create Referral Database Migration**
   - `referrals` table with status tracking
   - Add `ref_code` column to profiles
   - Indexes for lookups

2. **Create Referral Code Generator**
   - Generate code on first request (lazy generation)
   - Store in `profiles.ref_code`

3. **Add Referral Cookie Middleware**
   - Capture `?ref=` param on any page visit
   - Store in httpOnly cookie with 30-day expiry

4. **Add Referral Attribution on Signup**
   - Check for referral cookie after auth callback
   - Create referral record linking referrer to new user
   - Prevent self-referral

5. **Add Credit Application in Webhook**
   - On `invoice.paid`, check if user is a referred user
   - Apply Stripe customer balance credit to referrer
   - Update referral status to 'credited'

6. **Build Referral Dashboard Page**
   - Show referral code and share link
   - Stats: total referred, conversions, credits earned
   - Referral list with status badges

7. **Add Referral API Endpoints**
   - `GET /api/referrals` -- get user's referral code and stats
   - `POST /api/referrals/generate` -- generate code if not exists

8. **Add Rate Limiting**
   - Max 10 referral credits per month per user
   - Monitor for abuse patterns

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Referral fraud (fake accounts) | Unearned credits | Only credit after Stripe payment succeeds |
| Self-referral | Free months forever | Check user IDs differ; check payment method uniqueness |
| Cookie blocked by browser | Attribution lost | Accept this loss; cookies are standard approach |
| Referrer cancels before credit applies | Credit on inactive account | Apply credit anyway; it incentivizes resubscription |
| High credit volume | Revenue impact | Cap at 10 credits/month; monitor monthly |
