# Milestone 5: Monetization (v0.5)

Stripe billing, subscription plans, and usage enforcement.

## Goal

Convert Clap Cheeks from a free product to a paying SaaS. Integrate Stripe for checkout and subscription management, define the two pricing tiers, enforce per-plan usage limits, and give users a self-serve billing dashboard.

## Phases

| Phase | Name | Description | Status |
|-------|------|-------------|--------|
| 20 | Stripe integration | Checkout sessions, webhook handling, subscription lifecycle | Partial |
| 21 | Subscription plans | Enforce Base vs Elite plan differences throughout the app | Partial |
| 22 | Usage limits | Enforce per-plan caps on swipes/day, connected apps, and AI calls | Not started |
| 23 | Billing dashboard | Self-serve invoices, plan management, and usage meter in web UI | Partial |

## Pricing Tiers (Updated)

| Plan | Price | Limits |
|------|-------|--------|
| Base | $97/mo | 1 dating app, 500 swipes/day, basic analytics, iMessage AI |
| Elite | $197/mo | Unlimited apps, unlimited swipes, full analytics + coaching + voice tuning |

## Add-ons

| Add-on | Price | Description |
|--------|-------|-------------|
| Profile Doctor | $15 | AI profile review and optimization |
| Super Opener 10-pack | $27 | Custom opening messages |
| Turbo Session | $9 | One-hour max-speed swiping burst |
| Voice Calibration | $97 | Fine-tune AI voice model |

## Key Considerations

- Graceful degradation when limits are hit (notify user, don't break the app)
- Webhook reliability for subscription events (payment failed, cancelled, renewed)
- Proration when users upgrade/downgrade mid-cycle
- Idempotency for webhook processing and checkout creation

## Dependencies

Milestone 4 (Analytics & AI Coaching) should be complete or in progress.
Auth and database schema (Milestone 1) are prerequisites.
Stripe Products/Prices must be created in Stripe Dashboard.
