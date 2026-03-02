# Phase 25: Affiliate Dashboard

## Status: NOT STARTED

## Overview

Commission tracking for promoters (YouTubers, influencers, dating coaches). Affiliates earn recurring commission on every subscription they refer. Separate from the user referral program (Phase 24) -- this is for professional promoters with higher payouts and dedicated tracking.

## Build vs Buy Decision

**Recommendation: Use Rewardful**

| Option | Cost | Effort | Features |
|--------|------|--------|----------|
| **Rewardful** | $49/mo (Starter) | 1-2 days integration | Stripe-native, affiliate portal, fraud detection, payout tracking |
| PartnerStack | $15,000+/yr | 1 week | Overkill for early stage |
| Custom build | $0 | 2-3 weeks | Full control but massive maintenance burden |

**Why Rewardful:**
- Direct Stripe integration -- two-way sync, sees all subscription events
- Hosted affiliate portal (no UI to build)
- Handles payout calculations, cookie tracking, fraud detection
- $49/mo is negligible vs engineering time to build custom
- Can upgrade to higher tier as affiliate program grows
- Used by 10,000+ SaaS companies

## Commission Structure

| Metric | Value |
|--------|-------|
| Commission rate | 25% recurring |
| Cookie window | 60 days |
| Payment threshold | $50 minimum |
| Payout frequency | Monthly, via Stripe |
| Commission duration | Lifetime of subscription |
| First payment delay | 30 days (refund protection) |

### Example Earnings

| Plan | Monthly Price | Affiliate Commission | Annual per Customer |
|------|--------------|---------------------|---------------------|
| Base | $97 | $24.25/mo | $291/yr |
| Elite | $197 | $49.25/mo | $591/yr |

## Technical Approach

### Rewardful Integration

**1. Install Rewardful Snippet**

Add to `web/app/layout.tsx` (or root layout):
```html
<script async src='https://r.wdfl.co/rw.js' data-rewardful='YOUR_API_KEY'></script>
```

**2. Pass Referral ID to Stripe Checkout**

Modify `web/app/api/stripe/checkout/route.ts`:
```typescript
// Get Rewardful referral from request
const { plan, addons, referral } = body

const session = await stripe.checkout.sessions.create({
  // ... existing params
  client_reference_id: user.id,
  metadata: {
    plan,
    user_id: user.id,
    rewardful_referral: referral || '', // Rewardful tracking ID
  },
})
```

**3. Client-Side Referral Capture**

Modify checkout button to include Rewardful referral:
```typescript
// In checkout-button.tsx
async function handleCheckout() {
  const referral = (window as any).Rewardful?.referral || ''
  const res = await fetch('/api/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan, addons, referral }),
  })
  // ...
}
```

### Affiliate Onboarding Flow

1. Promoter applies via `/affiliates` page
2. Application reviewed (manual approval for quality control)
3. Approved affiliates get Rewardful portal access
4. Affiliate gets unique tracking link: `clapcheeks.tech/?via=affiliate-name`
5. Rewardful handles cookie tracking, attribution, commission calculation

### Affiliate Application Page

```
web/app/(main)/affiliates/
  page.tsx -- Public-facing affiliate program landing page
```

Content:
- Commission rates and earning potential
- How it works (3-step process)
- Apply form: name, email, platform (YouTube/Twitter/TikTok/Blog/Other), audience size, link to channel
- Stored in Supabase `affiliate_applications` table
- Email notification to admin on new application

### Database Schema

```sql
CREATE TABLE affiliate_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  platform TEXT NOT NULL,
  audience_size TEXT,
  channel_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
```

### Affiliate Portal (Hosted by Rewardful)

Rewardful provides a hosted affiliate portal where affiliates can:
- View their tracking link
- See real-time clicks, signups, conversions
- Track commission earnings and payouts
- Access promotional assets (uploaded by admin)

No custom affiliate dashboard UI needed -- Rewardful handles this.

### Promotional Assets

Provide affiliates with:
- Logo files (SVG, PNG)
- Banner images (various sizes)
- Email templates
- Social media post templates
- Product screenshots
- Talking points / key features list

Store in `/public/affiliates/` or provide via Rewardful's asset management.

## Implementation Steps

1. **Sign Up for Rewardful**
   - Create account at rewardful.com
   - Connect Stripe account
   - Configure commission: 25% recurring, 60-day cookie, lifetime duration

2. **Install Rewardful Tracking Script**
   - Add `<script>` tag to root layout
   - Verify tracking in Rewardful dashboard

3. **Modify Checkout Route**
   - Accept `referral` parameter from request body
   - Pass to Stripe Checkout session metadata

4. **Modify Checkout Button**
   - Capture `Rewardful.referral` from window and include in checkout request

5. **Create Affiliate Landing Page**
   - `/affiliates` page with program details, earning calculator, apply form

6. **Create Application Backend**
   - `affiliate_applications` table migration
   - `POST /api/affiliates/apply` endpoint
   - Email notification to admin (or Slack webhook)

7. **Upload Promotional Assets**
   - Logo files, banners, screenshots
   - Link from Rewardful portal or `/affiliates/assets` page

8. **Configure Rewardful Portal**
   - Custom branding (logo, colors)
   - Set up payout schedule (monthly, $50 minimum)
   - Enable fraud detection

9. **Test Full Flow**
   - Create test affiliate in Rewardful
   - Click tracking link, sign up, subscribe
   - Verify commission appears in Rewardful dashboard

## Target Affiliates

| Category | Examples | Why |
|----------|---------|-----|
| Dating coaches | YouTube dating coaches, pickup coaches | Direct audience overlap |
| Self-improvement creators | Motivation/productivity YouTubers | Male self-improvement audience |
| Tech reviewers | Mac app reviewers, productivity tool reviewers | macOS user base |
| Podcast hosts | Dating/relationships podcasts | Long-form trust building |
| Twitter/X influencers | Dating tips, masculinity accounts | High engagement, easy link sharing |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Affiliate sends low-quality traffic | High churn, wasted commissions | 30-day payment delay; monitor per-affiliate retention |
| Rewardful goes down | Tracking lost | Rewardful has 99.9% uptime; Stripe integration is webhook-based, catches up |
| Cookie blockers prevent attribution | Lost commissions, unhappy affiliates | Accept -- industry standard problem; Rewardful uses multiple attribution methods |
| High commission eats margin | Revenue impact | 25% of $97-197 leaves healthy margin; can adjust rate per affiliate |
| Brand-unsafe affiliate content | Reputation damage | Manual approval process; terms of service; right to terminate |
