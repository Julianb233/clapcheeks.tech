# Outward — AI Dating Co-Pilot SaaS

**Domain:** clapcheeks.tech
**GitHub:** https://github.com/Julianb233/clapcheeks.tech
**Stack:** Next.js 14 (web) · Node.js/Express (API) · Python FastAPI (AI/automation) · Supabase · Vercel

## Vision

Outward is a privacy-first AI dating assistant that runs locally on each user's Mac. It automates dating apps (Tinder, Bumble, Hinge), manages iMessage conversations in the user's voice, books dates on their calendar, tracks spending and conversion rates, and delivers AI coaching — all without personal data leaving their device.

## Architecture

```
User's Mac (local agent)              clapcheeks.tech (cloud SaaS)
├── iMessage reader + AI replies  ←→  ├── Landing page + marketing
├── Dating app automation             ├── User auth + subscriptions
│   (Tinder, Bumble, Hinge)          ├── Analytics dashboard
├── Date calendar booking             ├── AI coaching engine
├── Spending tracker                  ├── Billing (Stripe)
└── Sync client ──────────────────→  └── Anonymized metrics API
```

**Privacy guarantee:** All messages, matches, and conversation data stay on the user's Mac. Only anonymized metrics (swipe counts, conversion rates, spending totals) sync to the cloud.

## Current Milestone

**Milestone 1: Foundation** — Scaffold, landing page, auth, DB schema, Vercel deployment

## Tech Stack

| Layer | Tech |
|-------|------|
| Web frontend | Next.js 14, Tailwind CSS, TypeScript |
| SaaS API | Node.js, Express |
| AI/Automation API | Python, FastAPI |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Payments | Stripe |
| Deployment | Vercel (web) + VPS (API) |
| Local agent | Python CLI, Playwright, Ollama |
| iMessage | imessage-bridge (FastAPI on Mac Mini) |
