# Deployment Status

Last updated: 2026-03-02

## Vercel (Web App) ✅ LIVE

- **URL**: https://clapcheeks.tech
- **Project**: `ai-acrobatics/clapcheeks-tech`
- **All env vars set**: Supabase, Stripe, Anthropic, Resend, CRON_SECRET, price IDs
- **Stripe webhook**: Registered → `we_1T6S04E8iqjFMOfSBqt7JCbp`
  - Events: checkout.session.completed, customer.subscription.updated/deleted, invoice.payment_failed/paid
  - Secret stored in Vercel as STRIPE_WEBHOOK_SECRET

## Stripe Webhook ✅ REGISTERED

- Endpoint: `https://clapcheeks.tech/api/stripe/webhook`
- Webhook ID: `we_1T6S04E8iqjFMOfSBqt7JCbp`
- All keys stored in 1Password: `op://API-Keys/STRIPE-clapcheeks`

## Railway (Node.js API) ⏳ PENDING

- Service path: `api/`
- Deploy: `railway login` → `railway link` → `railway up`
- Required env vars in Railway dashboard:
  - `SUPABASE_URL` = `op://API-Keys/Supabase - clapcheeks/url`
  - `SUPABASE_SERVICE_KEY` = `op://API-Keys/Supabase - clapcheeks/service_role_key`
  - `WEB_URL` = `https://clapcheeks.tech`

## Fly.io (Python AI Service) ⏳ PENDING

- App name: `clapcheeks-ai`
- Service path: `ai/`
- Now uses Anthropic Claude (no Kimi key needed)
- Deploy:
  ```bash
  cd ai/
  fly deploy
  fly secrets set ANTHROPIC_API_KEY=$(op read "op://API-Keys/ANTHROPIC-global/credential")
  ```
- After deploy: update `NEXT_PUBLIC_AI_URL` in Vercel to `https://clapcheeks-ai.fly.dev`

## Resend DNS ⏳ PENDING

DNS records to add for email delivery — see `RESEND-DNS-RECORDS.md`.
Keys stored in 1Password: `op://API-Keys/RESEND-clapcheeks`
