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

**Dependency chain:** 39 → 40 → 41 → 42 (41 also feeds 43). Phase 44 depends on 41+42. Phase 45 depends on all.

```
39 Match Profile Engine ──→ 40 Pipeline Dashboard ──→ 41 Conversation Intelligence
                                                        ├──→ 42 Scheduled Messaging ──┐
                                                        └──→ 43 Date Planner ──────────┤
                                                                                       ↓
                                                             44 Autonomy Engine ←──────┘
                                                                      ↓
                                                             45 Polish & Integration
```

---

### Phase 39: Match Profile Engine
**Goal:** Build the data layer — Supabase schema, zodiac engine, Instagram scraper, and communication profiler. Everything downstream depends on this.
**Requirements:** PROFILE-01, PROFILE-02, PROFILE-03, PROFILE-04, PROFILE-05, PROFILE-06, PROFILE-07
**Research needed:** Instagram scraping via Browserbase (anti-detection patterns, rate limits, login requirements for public profiles)

**Success criteria:**
1. `match_profiles` table exists with all columns, RLS active
2. Zodiac engine returns correct sign + compatibility for any birthday pair
3. IG scraper returns structured profile data for a public handle via Browserbase
4. Communication profile generates DISC estimate + strategy from available data
5. Add Match form saves to DB and triggers zodiac + IG scrape + comms profile

---

### Phase 40: Pipeline Dashboard
**Goal:** Visual match management — Kanban board, profile cards, rankings, mobile-first. Julian can manage all matches from his phone.
**Requirements:** PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05
**Depends on:** Phase 39 (match_profiles table + zodiac + IG data)
**Research needed:** None — standard Next.js UI with dnd-kit or similar

**Success criteria:**
1. Kanban board renders all pipeline stages with drag-and-drop that persists
2. Match cards show zodiac icon, compatibility score, IG photo, and scores
3. Ranking sliders update scores in real-time with leaderboard reordering
4. Works on iPhone 14 viewport — no horizontal scroll, touch targets ≥ 44px

---

### Phase 41: Conversation Intelligence
**Goal:** Analyze conversations, generate per-match strategies, draft replies in Julian's voice. The AI brain behind the conversations.
**Requirements:** CONV-01, CONV-02, CONV-03, CONV-04, CONV-05
**Depends on:** Phase 39 (match profiles + comms data), Phase 40 (UI to display strategies)
**Research needed:** Voice profile calibration approach — how to extract Julian's texting style from iMessage DB

**Success criteria:**
1. Message analysis extracts topics, sentiment, and engagement from conversation history
2. Strategy generator produces match-specific (not generic) topics and approach
3. Reply drafter generates 3 distinct options in Julian's voice
4. Red flag detection catches low-effort and suspicious patterns

---

### Phase 42: Scheduled Messaging
**Goal:** Automated follow-ups — sequences, timing optimization, approval queue, god draft integration. Messages fire on schedule without manual intervention.
**Requirements:** SCHED-01, SCHED-02, SCHED-03, SCHED-04, SCHED-05
**Depends on:** Phase 41 (reply drafter + strategy for message content)
**Research needed:** god draft API for programmatic message scheduling

**Success criteria:**
1. Follow-up sequences trigger after configurable delay with AI-drafted content
2. Messages send via god draft at exact scheduled time
3. Approval queue shows pending messages with one-tap approve/edit/reject
4. App-to-text transition fires when warmth threshold crossed

---

### Phase 43: Date Planner
**Goal:** Plan, book, and track dates — calendar integration, personalized venue suggestions, budget tracking, post-date notes.
**Requirements:** DATE-01, DATE-02, DATE-03, DATE-04, DATE-05
**Depends on:** Phase 41 (match interests + conversation data for personalized suggestions)
**Research needed:** Google Calendar API for bi-directional sync

**Success criteria:**
1. Date ideas are personalized to match interests (not generic)
2. Calendar events sync bi-directionally with Google Calendar
3. Budget tracking shows per-date and running totals
4. Post-date rating form updates match rankings

---

### Phase 44: Autonomy Engine
**Goal:** Hands-off operation — auto-swipe, auto-respond, auto-follow-up with configurable approval gates. Julian only intervenes for date booking.
**Requirements:** AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05, AUTO-06
**Depends on:** Phase 41 (conversation AI), Phase 42 (scheduled messaging)
**Research needed:** Preference learning model — lightweight ML or heuristic scoring for swipe prediction

**Success criteria:**
1. Preference model predicts Julian's swipe with > 70% accuracy after training
2. Auto-swipe respects rate limits and stops on low confidence
3. Auto-respond sends high-confidence replies, queues uncertain ones
4. Approval gates configurable: supervised / semi-auto / full-auto

---

### Phase 45: Polish & Integration
**Goal:** End-to-end flow validation, Obsidian sync, push notifications, mobile UX refinement. Ship-ready.
**Requirements:** POLISH-01, POLISH-02, POLISH-03, POLISH-04, POLISH-05
**Depends on:** All previous phases (39-44)

**Success criteria:**
1. Full add-match-to-date-rating flow completes without errors
2. Obsidian dating profiles auto-created at "Date Planned" stage
3. Push notifications fire for approval queue items and date reminders
4. All pages pass mobile usability on iPhone 14
5. Match deletion cascades across all tables

---

### Requirement Coverage Matrix

| Req ID | Phase | Priority | Description |
|--------|-------|----------|-------------|
| PROFILE-01 | 39 | P0 | match_profiles Supabase table |
| PROFILE-02 | 39 | P0 | Zodiac calculation engine |
| PROFILE-03 | 39 | P0 | Zodiac compatibility scoring |
| PROFILE-04 | 39 | P0 | Instagram profile scraper |
| PROFILE-05 | 39 | P1 | Instagram interest extraction |
| PROFILE-06 | 39 | P0 | Communication profile builder |
| PROFILE-07 | 39 | P0 | Add match UI flow |
| PIPE-01 | 40 | P0 | Kanban pipeline view |
| PIPE-02 | 40 | P0 | Match profile cards |
| PIPE-03 | 40 | P0 | Ranking system |
| PIPE-04 | 40 | P1 | Filter & sort |
| PIPE-05 | 40 | P0 | Mobile-first responsive |
| CONV-01 | 41 | P0 | Message analysis engine |
| CONV-02 | 41 | P0 | Strategy generator |
| CONV-03 | 41 | P0 | Reply drafter |
| CONV-04 | 41 | P1 | Voice profile calibration |
| CONV-05 | 41 | P1 | Red flag detection |
| SCHED-01 | 42 | P0 | Follow-up sequences |
| SCHED-02 | 42 | P0 | god draft integration |
| SCHED-03 | 42 | P1 | Optimal send timing |
| SCHED-04 | 42 | P1 | App-to-text transition |
| SCHED-05 | 42 | P0 | Approval queue |
| DATE-01 | 43 | P1 | Date idea generator |
| DATE-02 | 43 | P0 | Google Calendar integration |
| DATE-03 | 43 | P1 | Budget tracking |
| DATE-04 | 43 | P0 | Post-date notes |
| DATE-05 | 43 | P1 | Date history timeline |
| AUTO-01 | 44 | P0 | Preference learning |
| AUTO-02 | 44 | P0 | Auto-swipe mode |
| AUTO-03 | 44 | P0 | Auto-respond |
| AUTO-04 | 44 | P1 | Stale conversation recovery |
| AUTO-05 | 44 | P0 | Approval gates |
| AUTO-06 | 44 | P1 | Confidence dashboard |
| POLISH-01 | 45 | P0 | End-to-end flow test |
| POLISH-02 | 45 | P1 | Obsidian dating profile sync |
| POLISH-03 | 45 | P1 | Push notifications |
| POLISH-04 | 45 | P0 | Mobile UX refinement |
| POLISH-05 | 45 | P1 | Data privacy & cleanup |

**Coverage:** 38/38 requirements mapped. 0 orphans.
