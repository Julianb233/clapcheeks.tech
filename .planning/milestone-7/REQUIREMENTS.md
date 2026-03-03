# Clapcheeks v7.0 — Production Hardening Requirements

**Milestone:** 7
**Version:** 7.0
**Date:** 2026-03-02
**Status:** Draft

---

## Summary

This milestone focuses on production hardening: fixing broken database references, closing security gaps, completing billing logic, improving agent reliability, and polishing the frontend. All P0 items are blockers for production confidence.

**Total requirements:** 28
**Breakdown:** P0 = 8 | P1 = 13 | P2 = 7

---

## Requirements Overview

| ID | Title | Category | Priority |
|----|-------|----------|----------|
| DB-01 | Rename outward_agent_tokens table | Database & Schema | P0 |
| DB-02 | Fix analytics table name mismatch | Database & Schema | P0 |
| DB-03 | Add missing indexes on user_id and date columns | Database & Schema | P1 |
| DB-04 | Fix conflicting profiles schema | Database & Schema | P1 |
| DB-05 | Fix public read RLS on profiles table | Database & Schema | P1 |
| DB-06 | Add RLS UPDATE/DELETE policies on clapcheeks_queued_replies | Database & Schema | P1 |
| DB-07 | Add CHECK constraint on queued_replies.status | Database & Schema | P2 |
| DB-08 | Add index on clapcheeks_queued_replies(user_id, status) | Database & Schema | P2 |
| SEC-01 | Hard-fail server startup if STRIPE_WEBHOOK_SECRET not set | Security & API | P0 |
| SEC-02 | Add server-side subscription plan gating | Security & API | P0 |
| SEC-03 | Add rate limiting to Express API | Security & API | P1 |
| SEC-04 | Add try-catch to all async Express routes | Security & API | P1 |
| SEC-05 | Validate and sanitize platform and text inputs | Security & API | P1 |
| SEC-06 | Add explicit request body size limits | Security & API | P2 |
| SEC-07 | Enhance health check with DB connectivity probe | Security & API | P2 |
| BILL-01 | Add payment failure grace period and user notification | Billing | P0 |
| BILL-02 | Implement trial period support | Billing | P0 |
| BILL-03 | Consolidate plan vs subscription_tier field | Billing | P1 |
| BILL-04 | Fix billing portal cancel button UX | Billing | P1 |
| BILL-05 | Add payment retry UI | Billing | P2 |
| BILL-06 | Add production mode guard for Stripe keys | Billing | P2 |
| AGENT-01 | Surface daemon degraded status to dashboard | Agent Reliability | P0 |
| AGENT-02 | Add env var validation at startup | Agent Reliability | P1 |
| AGENT-03 | Add exponential backoff to queue retry logic | Agent Reliability | P1 |
| AGENT-04 | Add log rotation for daemon.log | Agent Reliability | P2 |
| AGENT-05 | Add runtime Full Disk Access re-check | Agent Reliability | P2 |
| FE-01 | Remove hardcoded "2,400+ dates booked" from hero | Frontend Polish | P0 |
| FE-02 | Add auth redirect to analytics page | Frontend Polish | P1 |
| FE-03 | Add SEO metadata to 20 pages | Frontend Polish | P1 |
| FE-04 | Remove console.error from analytics page | Frontend Polish | P2 |
| FE-05 | Remove or complete press kit screenshot stubs | Frontend Polish | P2 |

---

## Category 1: Database & Schema (DB)

### DB-01 — Rename outward_agent_tokens table [P0]

**Description:**
Migration creates `outward_agent_tokens` but code references `clapcheeks_agent_tokens`. Agent auth is completely broken.

**Acceptance Criteria:**
- Agent registration, heartbeat, and device polling all succeed.
- No DB errors in logs referencing missing table or column.

---

### DB-02 — Fix analytics table name mismatch [P0]

**Description:**
Migration creates `analytics_daily`, API code references `clapcheeks_analytics_daily`. Dashboard shows no data.

**Acceptance Criteria:**
- `/api/analytics/summary` returns real data.
- Dashboard charts populate correctly.

---

### DB-03 — Add missing indexes on user_id and date columns [P1]

**Description:**
`clapcheeks_conversation_stats` and `clapcheeks_spending` have no indexes on user_id or date. Full table scans on every dashboard load.

**Acceptance Criteria:**
- Indexes exist on `user_id` and `date` columns for both tables.
- Query time for dashboard load < 200ms.

---

### DB-04 — Fix conflicting profiles schema [P1]

**Description:**
Two SQL files define `profiles` table with different columns. Unclear which is authoritative.

**Acceptance Criteria:**
- Single canonical migration defines profiles.
- No duplicate table definitions across migration files.

---

### DB-05 — Fix public read RLS on profiles table [P1]

**Description:**
Any authenticated user can read any other user's full profile row.

**Acceptance Criteria:**
- RLS policy restricts profile reads to own row only.

---

### DB-06 — Add RLS UPDATE/DELETE policies on clapcheeks_queued_replies [P1]

**Description:**
Users can queue messages but cannot cancel or update them from the web.

**Acceptance Criteria:**
- Users can update/delete their own `clapcheeks_queued_replies` rows.
- Users cannot modify other users' rows.

---

### DB-07 — Add CHECK constraint on queued_replies.status [P2]

**Description:**
No constraint enforcing valid status values. Any string accepted.

**Acceptance Criteria:**
- `CHECK (status IN ('queued','sent','failed'))` constraint exists on `clapcheeks_queued_replies`.

---

### DB-08 — Add index on clapcheeks_queued_replies(user_id, status) [P2]

**Description:**
Missing composite index causes slow lookups when filtering queued replies by status.

**Acceptance Criteria:**
- Composite index on `(user_id, status)` exists.

---

## Category 2: Security & API (SEC)

### SEC-01 — Hard-fail server startup if STRIPE_WEBHOOK_SECRET not set [P0]

**Description:**
Express API silently accepts all webhooks if env var missing. Attacker can forge events to grant free subscriptions.

**Acceptance Criteria:**
- Server refuses to start in production if `STRIPE_WEBHOOK_SECRET` is undefined.
- Error message is clear and actionable.

---

### SEC-02 — Add server-side subscription plan gating [P0]

**Description:**
EliteOnly is UI-only. Free users can call `/api/coaching/generate`, `/api/photos/score`, and AI endpoints with no plan check.

**Acceptance Criteria:**
- `requirePlan()` middleware added to protected routes.
- Free users get 403 with upgrade prompt.
- Verified with test requests from free-tier accounts.

---

### SEC-03 — Add rate limiting to Express API [P1]

**Description:**
Zero rate limiting on any route. Auth device codes, AI endpoints, analytics sync all unlimited.

**Acceptance Criteria:**
- `express-rate-limit` added.
- Auth endpoints: 5 req/min per IP.
- AI endpoints: per-user quota per minute.

---

### SEC-04 — Add try-catch to all async Express routes [P1]

**Description:**
Multiple routes in `auth.js`, `agent.js`, `analytics.js`, `events.js` have no error handling. DB timeout crashes server.

**Acceptance Criteria:**
- All async route handlers wrapped in try-catch with proper error responses.
- Server survives DB errors without crashing.

---

### SEC-05 — Validate and sanitize platform and text inputs [P1]

**Description:**
`platform` param not validated against enum. `opener_text` inserted to DB without length limits.

**Acceptance Criteria:**
- Platform validated against allowlist.
- Text fields limited to 2000 chars.
- Invalid input returns 400.

---

### SEC-06 — Add explicit request body size limits [P2]

**Description:**
`express.json()` limit not explicit. Photo scoring accepts arbitrary-size base64.

**Acceptance Criteria:**
- `express.json({ limit: '10mb' })` explicit.
- Photo scoring rejects images > 5MB.

---

### SEC-07 — Enhance health check with DB connectivity probe [P2]

**Description:**
`/health` returns 200 OK even when Supabase is down.

**Acceptance Criteria:**
- `/health` queries DB.
- Returns 503 if DB unreachable.

---

## Category 3: Billing (BILL)

### BILL-01 — Add payment failure grace period and user notification [P0]

**Description:**
Failed card sets status to `past_due` but access never cuts off. User gets no notification.

**Acceptance Criteria:**
- 7-day grace period after `invoice.payment_failed`.
- Access revoked after grace period expires.
- Email sent to user on payment failure.

---

### BILL-02 — Implement trial period support [P0]

**Description:**
Webhook doesn't handle `trialing` status. Sets users to `active` immediately on checkout regardless of trial.

**Acceptance Criteria:**
- `trialing` status stored correctly in the database.
- `customer.subscription.trial_will_end` event handled.
- Access gated appropriately during trial.

---

### BILL-03 — Consolidate plan vs subscription_tier field [P1]

**Description:**
Two fields store the same thing. Next.js sets both; Express sets only one. Billing UI reads one, plan-server reads the other.

**Acceptance Criteria:**
- Single authoritative field used everywhere.
- Migration to consolidate.
- All references updated across Next.js and Express.

---

### BILL-04 — Fix billing portal cancel button UX [P1]

**Description:**
"Yes, cancel" button redirects to Stripe portal instead of cancelling in-app. Misleading.

**Acceptance Criteria:**
- Button either cancels directly via API or label changed to "Manage in Stripe" to set expectations.

---

### BILL-05 — Add payment retry UI [P2]

**Description:**
No way for user to retry a failed payment from within the app.

**Acceptance Criteria:**
- Billing page shows retry button when status is `past_due`.
- Triggers Stripe payment retry.

---

### BILL-06 — Add production mode guard for Stripe keys [P2]

**Description:**
No check that live keys are used in production. Test keys could be used accidentally.

**Acceptance Criteria:**
- On startup, if `NODE_ENV=production` and `STRIPE_SECRET_KEY` starts with `sk_test_`, emit hard warning/error.

---

## Category 4: Agent Reliability (AGENT)

### AGENT-01 — Surface daemon degraded status to dashboard [P0]

**Description:**
Platform worker thread crashes silently. Agent status shows "running" but swiping has stopped.

**Acceptance Criteria:**
- If a platform worker crashes 3+ times in 1 hour, agent status becomes "degraded".
- Dashboard shows warning with affected platform name.

---

### AGENT-02 — Add env var validation at startup [P1]

**Description:**
Agent starts fine but crashes mid-session on missing `KIMI_API_KEY` or `ANTHROPIC_API_KEY`. No early warning.

**Acceptance Criteria:**
- `validate_env()` runs before threads start.
- Logs clearly which keys are missing/present.
- Optional keys logged as warnings only.

---

### AGENT-03 — Add exponential backoff to queue retry logic [P1]

**Description:**
`flush_queue()` retries at fixed interval with no backoff. On Supabase outage, hammers endpoint. `MAX_RETRIES=10` drops metrics silently after ~5 hours.

**Acceptance Criteria:**
- Exponential backoff with jitter implemented.
- `MAX_RETRIES` extended to 50.
- Warning logged and dashboard notified when items dropped.

---

### AGENT-04 — Add log rotation for daemon.log [P2]

**Description:**
Log file grows forever. No rotation configured.

**Acceptance Criteria:**
- Rotate at 10MB.
- Keep 5 historical files.
- `clapcheeks logs` CLI command shows last 100 lines.

---

### AGENT-05 — Add runtime Full Disk Access re-check [P2]

**Description:**
FDA check happens at startup only. If user revokes permission later, agent crashes instead of gracefully degrading.

**Acceptance Criteria:**
- Reader catches permission errors at runtime.
- Disables iMessage features on permission error.
- Shows warning in dashboard.

---

## Category 5: Frontend Polish (FE)

### FE-01 — Remove hardcoded "2,400+ dates booked" from hero [P0]

**Description:**
Fake social proof metric. Legal and trust liability.

**Acceptance Criteria:**
- Either fetch real aggregate from analytics API, use a real metric, or remove entirely.

---

### FE-02 — Add auth redirect to analytics page [P1]

**Description:**
Client-side page with no server-side auth check. Page shell loads for unauthenticated users.

**Acceptance Criteria:**
- Server-side redirect to `/auth/login` if no session.

---

### FE-03 — Add SEO metadata to 20 pages [P1]

**Description:**
Pages missing metadata: activate, admin/*, complete-profile, diagnostics, events, groups, home, login, notifications, profile, safety, signup, (main) layout.

**Acceptance Criteria:**
- All listed pages have `export const metadata` with `title` and `description`.

---

### FE-04 — Remove console.error from analytics page [P2]

**Description:**
`console.error('Analytics fetch error')` left in production code.

**Acceptance Criteria:**
- Removed or gated behind dev-only check.

---

### FE-05 — Remove or complete press kit screenshot stubs [P2]

**Description:**
Press page shows "Coming soon" for 4 screenshot slots.

**Acceptance Criteria:**
- Either real screenshots added or section removed.
