# Phase 2 Plan 01: Plan Gating & Webhook Guard Summary

**One-liner:** Server-side subscription plan gating via requirePlan middleware + hard-fail on missing STRIPE_WEBHOOK_SECRET in production

## What Was Done

### Task 1: Hard-fail on missing STRIPE_WEBHOOK_SECRET (SEC-01)
- Added env validation block at top of `api/server.js` before app setup
- In production: exits with `process.exit(1)` and clear error message if `STRIPE_WEBHOOK_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` missing
- In development: emits console warning when `STRIPE_WEBHOOK_SECRET` not set

### Task 2: Server-side subscription plan gating middleware (SEC-02)
- Created `api/middleware/requirePlan.js` with `PLAN_HIERARCHY` (free=0, starter=1, pro=2, elite=3)
- Supports both JWT-auth (`req.user.id`) and agent-token (`req.userId`) flows
- Returns 403 with `required_plan`, `current_plan`, and upgrade URL
- Applied `requirePlan('pro')` to all intelligence routes: opener, progression, stats, ab-test

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `api/server.js` | Modified | Added env validation block |
| `api/middleware/requirePlan.js` | Created | Plan gating middleware |
| `api/routes/intelligence.js` | Modified | Added requirePlan('pro') to all 4 endpoints |

## Deviations from Plan

- Plan referenced `api/src/index.js` but actual file is `api/server.js` (no `src/` directory)
- Plan referenced `coaching.js` and `photos.js` routes that don't exist; applied to `intelligence.js` which contains the actual AI-powered endpoints
- Plan used CommonJS `require()` syntax but project uses ES modules (`import/export`)

## Commit

- `69b62f1`: feat(phase2-plan01): plan gating & webhook guard
