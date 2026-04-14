# Clapcheeks Roadmap

## Milestone 1: Foundation (v0.1)
Core scaffold, landing page, auth, and deployment.

- Phase 1: Project scaffold — Next.js web, Node.js API, Python FastAPI, monorepo structure
- Phase 2: Landing page — clapcheeks.tech marketing site (hero, features, pricing, install CTA)
- Phase 3: Auth — Supabase Auth (email + Google OAuth), protected dashboard routes
- Phase 4: Database schema — Users, subscriptions, devices, analytics tables
- Phase 5: Vercel deployment — CI/CD pipeline, domain connection, environment secrets

## Milestone 2: Local Agent (v0.2)
The downloadable CLI that runs on each user's Mac.

- Phase 6: Install script — `curl -fsSL https://clapcheeks.tech/install.sh | bash` one-command setup
- Phase 7: iMessage integration — Read conversations, AI replies in user's voice (builds on imessage-ai)
- Phase 8: Dating profile manager — User preferences, target preferences, dealbreakers
- Phase 9: Spending tracker — Log date costs, categorize spending, calculate ROI
- Phase 10: Cloud sync — Push anonymized metrics to Outward API on user's behalf

## Milestone 3: Dating App Automation (v0.3)
Browser automation for Tinder, Bumble, Hinge using local Playwright.

- Phase 11: Playwright setup — Local browser automation framework, anti-detection measures
- Phase 12: Tinder automation — Login, swipe logic, match detection, opener messages
- Phase 13: Bumble automation — Swipe, first-move messages, conversation starters
- Phase 14: Hinge automation — Like/comment, prompt responses, conversation flow
- Phase 15: Automation controller — Unified interface, rate limiting, human-like delays, session management

## Milestone 4: Analytics & AI Coaching (v0.4)
Dashboard, conversion tracking, and AI coaching engine.

- Phase 16: Analytics dashboard — Swipes, matches, conversations, dates, spending, conversion rates
- Phase 17: AI coaching engine — Claude API analyzes patterns and generates personalized tips
- Phase 18: Conversation AI — AI reply suggestions for dating app chats (not just iMessage)
- Phase 19: Weekly reports — Automated PDF/email performance report with AI recommendations

## Milestone 5: Monetization (v0.5)
Stripe billing, subscription plans, and usage enforcement.

- Phase 20: Stripe integration — Checkout, webhooks, subscription lifecycle
- Phase 21: Subscription plans — Starter ($29), Pro ($59), Elite ($99)
- Phase 22: Usage limits — Enforce per-plan limits (swipes/day, apps connected, AI calls)
- Phase 23: Billing dashboard — Invoices, plan management, usage meter

## Milestone 6: Growth (v0.6)
Referral system, affiliate program, and public launch.

- Phase 24: Referral program — Users get 1 free month per referral
- Phase 25: Affiliate dashboard — Commission tracking for promoters
- Phase 26: Public launch — Product Hunt, social launch, press kit

## Milestone 7: Production Hardening (v0.7)
Close all production-blocking gaps before real user traffic. 28 fixes across DB, security, billing, agent, and frontend layers — identified by 5-agent audit on 2026-03-03.

- Phase 27: DB Schema Fixes — Table renames, indexes, RLS policies, constraints (DB-01 through DB-08)
- Phase 28: Security & API Hardening — Plan gating, rate limiting, error handling, input validation (SEC-01 through SEC-07)
- Phase 29: Billing Completion — Payment failure handling, trials, plan field consolidation (BILL-01 through BILL-06)
- Phase 30: Agent Reliability — Degraded state surfacing, env validation, queue backoff, log rotation (AGENT-01 through AGENT-05)
- Phase 31: Frontend Polish — Remove fake metrics, auth redirects, SEO metadata (FE-01 through FE-05)

## Milestone 8: GTM Testing & Launch (v0.8)
Deploy, dogfood, alpha test, and soft-launch the SaaS product.

- Phase 32: Infrastructure Deploy — Apply DB migrations, deploy Express API + FastAPI + Next.js
- Phase 33: Founder Dogfooding — Install agent, test swiping, conversation AI, Stripe checkout, coaching
- Phase 34: Closed Alpha — Onboarding materials, Sentry, analytics, 2-week alpha with 5-10 friends
- Phase 35: Anti-Detection & Safety — Platform ban testing, rate limit rules per platform
- Phase 36: Beta Readiness — Production Stripe, dunning flow, load test, security audit
- Phase 37: Launch Prep — Demo video, email onboarding sequence, weekly reports, landing page optimization
- Phase 38: Soft Launch — First 50 users, referral program, admin monitoring

## Milestone 9: Personal Dating Command Center (v0.9)
Julian's personal dating power tool — zodiac intelligence, Instagram scraping, communication profiling, match pipeline, scheduled messaging, date planning, and full autonomy.

- Phase 39: Match Profile Engine — Supabase schema for matches, zodiac calculation from birthday, Instagram profile scraper via Browserbase, DISC/VAK communication profiling adapted for dating
- Phase 40: Pipeline Dashboard — Kanban UI (New → Talking → Number Got → Date Planned → Dated → Ranked), match cards with zodiac/photo/score, mobile-first responsive design
- Phase 41: Conversation Intelligence — Message analysis engine, strategy generation per match, reply drafting in Julian's voice, topic recommendations from IG + conversation data
- Phase 42: Scheduled Messaging — Follow-up sequences with configurable delays, god draft integration, optimal send timing based on response patterns, app-to-iMessage transition prompts
- Phase 43: Date Planner — Google Calendar integration, date idea suggestions from match interests, budget tracking per date, post-date rating and notes, San Diego venue database
- Phase 44: Autonomy Engine — Auto-swipe based on preference learning, auto-respond in Julian's voice, auto-follow-up on stale conversations, approval gates for date booking only
- Phase 45: Polish & Integration — End-to-end flow testing, Obsidian dating profile sync, notification system, mobile UX refinement, edge case handling
