# Milestone 7: Production Hardening (v0.7)

**Status:** ACTIVE
**Started:** 2026-03-03
**Goal:** Close all production-blocking gaps identified in the 5-layer audit before accepting real users and real payments.

## Why This Milestone Exists

Milestones 1-6 built the product. Milestone 7 makes it safe to run. The audit identified:
- 2 database table name mismatches that completely break agent auth and dashboard data
- Zero server-side plan gating (free users access paid features)
- No payment failure handling (lapsed subscribers keep access indefinitely)
- Agent daemon fails silently with no user visibility
- 28 total gaps across DB, security, billing, agent, and frontend layers

## Success Criteria

- [ ] Agent registration and heartbeat work end-to-end
- [ ] Analytics dashboard shows real data
- [ ] Free users cannot access Pro/Elite API endpoints
- [ ] Failed payments trigger notification + 7-day grace period
- [ ] Trial periods tracked and enforced correctly
- [ ] Daemon degraded state visible in dashboard
- [ ] Hero section shows real or removed metric (no fake "2,400+")
- [ ] All 28 audit gaps resolved

## Phases

| Phase | Name | Requirements | Priority |
|-------|------|-------------|----------|
| 1 | DB Schema Fixes | DB-01 through DB-08 | P0 first |
| 2 | Security & API Hardening | SEC-01 through SEC-07 | P0 first |
| 3 | Billing Completion | BILL-01 through BILL-06 | P0 first |
| 4 | Agent Reliability | AGENT-01 through AGENT-05 | P0 first |
| 5 | Frontend Polish | FE-01 through FE-05 | P0 first |

## Phase Details

### Phase 1: DB Schema Fixes
**Goal:** Fix all database table name mismatches, add missing indexes, strengthen RLS policies, and add missing constraints. These are hard blockers — the agent cannot authenticate and the dashboard shows no data until DB-01 and DB-02 are resolved.

**Requirements:** DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08

**Must-have success criteria:**
- Agent can register a device (DB-01)
- Dashboard analytics chart shows real data (DB-02)
- Profile reads restricted to own user (DB-05)

**Estimated effort:** 1-2 hours

---

### Phase 2: Security & API Hardening
**Goal:** Add server-side plan enforcement, rate limiting, error handling, and input validation. Closes the free-user access exploit and prevents server crashes from unhandled errors.

**Requirements:** SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07

**Must-have success criteria:**
- Free user calling /api/coaching/generate gets 403 (SEC-02)
- Server survives a DB timeout without crashing (SEC-04)
- Missing STRIPE_WEBHOOK_SECRET prevents server start (SEC-01)

**Estimated effort:** 3-4 hours

---

### Phase 3: Billing Completion
**Goal:** Implement payment failure handling, trial periods, and consolidate the plan/tier field inconsistency. Ensures revenue is protected and subscription lifecycle is complete.

**Requirements:** BILL-01, BILL-02, BILL-03, BILL-04, BILL-05, BILL-06

**Must-have success criteria:**
- User with failed payment gets email notification and access revoked after 7 days (BILL-01)
- Trial users have correct status in DB (BILL-02)
- Single field used for plan everywhere in codebase (BILL-03)

**Estimated effort:** 3-4 hours

---

### Phase 4: Agent Reliability
**Goal:** Prevent silent daemon failures, add env validation, improve queue resilience, and add log rotation. Makes the agent observable and self-reporting when things go wrong.

**Requirements:** AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05

**Must-have success criteria:**
- Dashboard shows "degraded" warning when platform worker crashes (AGENT-01)
- Agent startup logs which optional keys are missing (AGENT-02)
- Queue uses exponential backoff instead of hammering failed endpoint (AGENT-03)

**Estimated effort:** 2-3 hours

---

### Phase 5: Frontend Polish
**Goal:** Remove fake metrics, add auth protection to missing pages, add SEO metadata, and clean up press kit.

**Requirements:** FE-01, FE-02, FE-03, FE-04, FE-05

**Must-have success criteria:**
- Hero shows real metric or no number (FE-01)
- Analytics page redirects unauthenticated users (FE-02)
- All 20 missing pages have metadata exports (FE-03)

**Estimated effort:** 2-3 hours
