# Milestone 5: Monetization (v0.5)

Stripe billing, subscription plans, and usage enforcement.

## Goal

Convert Outward from a free product to a paying SaaS. Integrate Stripe for checkout and subscription management, define the three pricing tiers, enforce per-plan usage limits, and give users a self-serve billing dashboard.

## Phases

| Phase | Name | Description |
|-------|------|-------------|
| 20 | Stripe integration | Checkout sessions, webhook handling, subscription lifecycle |
| 21 | Subscription plans | Define Starter ($29), Pro ($59), and Elite ($99) plans in Stripe |
| 22 | Usage limits | Enforce per-plan caps on swipes/day, connected apps, and AI calls |
| 23 | Billing dashboard | Self-serve invoices, plan management, and usage meter in web UI |

## Pricing Tiers

| Plan | Price | Limits |
|------|-------|--------|
| Starter | $29/mo | 1 dating app, 50 swipes/day, basic AI coaching |
| Pro | $59/mo | 3 dating apps, 200 swipes/day, full AI coaching + conversation AI |
| Elite | $99/mo | All apps, unlimited swipes, priority AI, weekly reports, white-glove onboarding |

## Key Considerations

- Trial period (7 or 14 days free) before billing begins
- Graceful degradation when limits are hit (notify user, don't break the app)
- Webhook reliability for subscription events (payment failed, cancelled, renewed)
- Proration when users upgrade/downgrade mid-cycle

## Dependencies

Milestone 4 (Analytics & AI Coaching) should be complete or in progress before launching Milestone 5.
Auth and database schema (Milestone 1) are prerequisites.
