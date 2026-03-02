# Clapcheeks — AI Dating Co-Pilot

## ⚠️ CRITICAL BRAND RULE — DO NOT CHANGE

**The product is called "Clapcheeks", NOT "Outward".**

This codebase was previously associated with a product called "Outward" but has been fully rebranded to **Clapcheeks**. Any references to "Outward" in the codebase are bugs and must be changed to "Clapcheeks".

- Brand name: **Clapcheeks**
- Domain: **clapcheeks.tech**
- Do NOT rename back to Outward
- Do NOT change "Clapcheeks" to "Outward" in any file

## Project Structure

```
web/          — Next.js 15 SaaS app (landing page + dashboard)
supabase/     — Database migrations
api/          — Backend API (separate service)
```

## Web App

- **Framework**: Next.js 15.5.12 (App Router)
- **Auth**: Supabase Auth with SSR
- **Payments**: Stripe (checkout + webhooks)
- **Styling**: Tailwind CSS v4 dark mode (bg-black forced on body)
- **Deployment**: Vercel (project: clapcheeks-tech)

## Deployment

```bash
cd web
VERCEL_TOKEN="..." npx vercel --prod --yes
```

The project is linked via `web/.vercel/project.json` to `prj_0Ra8fB9WK2RsKV31xUjnFXy2iAki`.

## Key Files

- `web/app/layout.tsx` — Root layout, has `dark` class + `bg-black` on body
- `web/app/landing.css` — Orb blur, gradient-text, animation utilities
- `web/lib/supabase/middleware.ts` — Auth + route protection
- `web/app/(main)/` — Authenticated app routes (dashboard, billing, etc.)
- `web/app/(main)/pricing/pricing-client.tsx` — Stripe checkout integration

## Database (Supabase)

- Project ref: `oouuoepmkeqdyzsxrnjh`
- Host: `db.oouuoepmkeqdyzsxrnjh.supabase.co`
- Migrations: `supabase/migrations/` and `web/scripts/`

## User Roles

- `user` — default
- `admin` — admin access
- `super_admin` — full access (julianb233@gmail.com, julian@aiacrobatics.com)
