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

## iMessage (BlueBubbles + god CLI) — Integration 2026-04-24

All outbound iMessages from the python agent route through `god mac send`,
which tries BlueBubbles HTTP → AppleScript (SSH) → SMS. Entry points:

- `agent/clapcheeks/imessage/sender.py::send_imessage(phone, body)` —
  single source of truth for sends. Loads `BLUEBUBBLES_*` env from
  `/opt/agency-workspace/.fleet-config/env/bluebubbles.env` and
  `/etc/bluebubbles/secrets.env` so non-login shells (PM2, systemd,
  Claude Code Bash, Vercel builds) get the fleet config. Surfaces the
  chosen channel (`god-mac-bluebubbles` vs `god-mac-applescript`).
- `watcher._send_imessage` and `queue_poller` now delegate to the above —
  no more direct `osascript` from clapcheeks.

Inbound (replies) has two options:

- `agent/clapcheeks/imessage/watcher.py::IMMessageWatcher` — chat.db
  polling (Mac-hosted deployments, 5s latency).
- `agent/clapcheeks/imessage/bluebubbles_inbox.py::BlueBubblesInbox` —
  tails `/opt/agency-workspace/fleet-shared/inbox/<slug>/<date>.ndjson`
  that the VPS BlueBubbles webhook writes (~300ms, no Mac required).

### CLI

- `clapcheeks bb-register-phone +1... --slug clapcheeks` — register a
  match's phone in `fleet-shared/clients/contact-index.json` so inbound
  webhooks from that number land in `inbox/clapcheeks/` instead of
  `inbox/unknown/`.
- `clapcheeks bb-inbox-watch [--also-unknown] [--print-only]` — long-
  running tailer for the inbox; replaces chat.db polling on VPS.

### Smoke test

```bash
./scripts/test-bluebubbles-integration.sh --dry-run           # env + tunnel + inbox + index
./scripts/test-bluebubbles-integration.sh --send +16195090699 # live iMessage to Julian
```

### Known fleet-side issue (flagged 2026-04-24)

BlueBubbles HTTP `/api/v1/message/text` currently returns HTTP 400 on
both `bubbles-macbook.aiacrobatics.com` and `bubbles-macmini.aiacrobatics.com`
— the mac CLI's request payload needs debugging. Until that's fixed,
`god mac send` transparently falls through to AppleScript (same
end-user experience, just slower). The clapcheeks wiring above will
automatically upgrade to BlueBubbles once the fleet-side bug is
resolved — no clapcheeks changes needed.
