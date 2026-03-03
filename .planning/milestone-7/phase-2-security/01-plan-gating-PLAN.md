---
plan: "Plan Gating & Webhook Guard"
phase: "Phase 2: Security & API Hardening"
wave: 1
autonomous: true
requirements: [SEC-01, SEC-02]
goal: "Block free users from paid API endpoints, hard-fail server startup if webhook secret is missing"
---

# Plan 01: Plan Gating & Webhook Guard

**Phase:** Phase 2 — Security & API Hardening
**Requirements:** SEC-01, SEC-02
**Priority:** P0 (hard blockers)
**Wave:** 1

## Context

- `STRIPE_WEBHOOK_SECRET` not set → server accepts all webhooks → attacker can forge events and grant free subscriptions
- `EliteOnly` guard is UI-only → free users can POST to `/api/coaching/generate`, `/api/photos/score`, etc.

## Tasks

### Task 1: Hard-fail on missing STRIPE_WEBHOOK_SECRET (SEC-01)

File: `api/src/index.js` (or wherever Express app starts)

1. Find the server startup entry point
2. Add env validation block near the top, BEFORE `app.listen()`:
   ```javascript
   // Validate required env vars before starting
   if (process.env.NODE_ENV === 'production') {
     const required = ['STRIPE_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']
     const missing = required.filter(k => !process.env[k])
     if (missing.length > 0) {
       console.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`)
       console.error('Server cannot start without these variables set.')
       process.exit(1)
     }
   }
   ```
3. In development, emit a warning (not exit):
   ```javascript
   if (!process.env.STRIPE_WEBHOOK_SECRET) {
     console.warn('[WARN] STRIPE_WEBHOOK_SECRET not set — webhook verification disabled')
   }
   ```

### Task 2: Add server-side subscription plan gating middleware (SEC-02)

1. Create `api/src/middleware/requirePlan.js`:
   ```javascript
   const { createClient } = require('@supabase/supabase-js')

   const PLAN_HIERARCHY = { free: 0, starter: 1, pro: 2, elite: 3 }

   function requirePlan(minPlan) {
     return async (req, res, next) => {
       try {
         const userId = req.user?.id
         if (!userId) return res.status(401).json({ error: 'Unauthorized' })

         const supabase = createClient(
           process.env.SUPABASE_URL,
           process.env.SUPABASE_SERVICE_ROLE_KEY
         )

         const { data: profile } = await supabase
           .from('profiles')
           .select('subscription_tier')
           .eq('id', userId)
           .single()

         const userPlan = profile?.subscription_tier || 'free'
         if ((PLAN_HIERARCHY[userPlan] ?? 0) < (PLAN_HIERARCHY[minPlan] ?? 1)) {
           return res.status(403).json({
             error: 'Plan required',
             message: `This feature requires ${minPlan} plan or higher. Upgrade at clapcheeks.tech/billing`,
             required_plan: minPlan,
             current_plan: userPlan,
           })
         }

         next()
       } catch (err) {
         console.error('[requirePlan] Error:', err)
         return res.status(500).json({ error: 'Failed to verify subscription' })
       }
     }
   }

   module.exports = { requirePlan }
   ```

2. Apply to protected routes in `api/src/routes/`:
   - `coaching.js` → `router.post('/generate', auth, requirePlan('pro'), handler)`
   - `photos.js` → `router.post('/score', auth, requirePlan('pro'), handler)`
   - Any other AI-powered endpoints

3. Test with a free-tier user JWT — should get 403 with upgrade message

## Acceptance Criteria

- [ ] Server refuses to start in production if `STRIPE_WEBHOOK_SECRET` is undefined
- [ ] Clear error message printed with actionable instruction
- [ ] `POST /api/coaching/generate` with free user JWT returns 403
- [ ] 403 response includes `required_plan` and `current_plan` fields
- [ ] Pro/Elite users can still access the endpoints normally
- [ ] `requirePlan.js` middleware created and applied to AI routes

## Files to Modify

- `api/src/index.js` — startup env validation
- `api/src/middleware/requirePlan.js` — NEW file
- `api/src/routes/coaching.js` — add `requirePlan('pro')` middleware
- `api/src/routes/photos.js` — add `requirePlan('pro')` middleware
