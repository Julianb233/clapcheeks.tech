---
plan: "Error Handling, Validation & Health Check"
phase: "Phase 2: Security & API Hardening"
wave: 3
autonomous: true
requirements: [SEC-04, SEC-05, SEC-07]
goal: "Wrap all async routes in try-catch, validate platform/text inputs, add DB probe to health endpoint"
---

# Plan 03: Error Handling, Validation & Health Check

**Phase:** Phase 2 — Security & API Hardening
**Requirements:** SEC-04, SEC-05, SEC-07
**Priority:** P1/P2
**Wave:** 3

## Context

- Multiple routes in `auth.js`, `agent.js`, `analytics.js`, `events.js` crash the server on DB timeout
- `platform` param not validated against enum; `opener_text` has no length limit
- `/health` returns 200 even when Supabase is completely down

## Tasks

### Task 1: Add try-catch to all async Express routes (SEC-04)

1. Create async error handler wrapper utility in `api/src/utils/asyncHandler.js`:
   ```javascript
   // Wraps async route handlers to catch errors automatically
   function asyncHandler(fn) {
     return (req, res, next) => {
       Promise.resolve(fn(req, res, next)).catch(next)
     }
   }

   module.exports = { asyncHandler }
   ```

2. Create global error handler middleware in `api/src/middleware/errorHandler.js`:
   ```javascript
   function errorHandler(err, req, res, next) {
     console.error(`[ERROR] ${req.method} ${req.path}:`, err.message)

     // Don't expose internal errors in production
     const message = process.env.NODE_ENV === 'production'
       ? 'An internal error occurred'
       : err.message

     res.status(err.status || 500).json({ error: message })
   }

   module.exports = { errorHandler }
   ```

3. Register error handler LAST in `api/src/index.js`:
   ```javascript
   const { errorHandler } = require('./middleware/errorHandler')
   // ... all routes above ...
   app.use(errorHandler)
   ```

4. Wrap existing route handlers in `auth.js`, `agent.js`, `analytics.js`, `events.js`:
   ```javascript
   const { asyncHandler } = require('../utils/asyncHandler')

   router.post('/register', asyncHandler(async (req, res) => {
     // ... existing handler code ...
   }))
   ```
   Do this for every `async (req, res) =>` handler that doesn't have try-catch.

### Task 2: Validate and sanitize platform and text inputs (SEC-05)

1. Create validation middleware in `api/src/middleware/validate.js`:
   ```javascript
   const VALID_PLATFORMS = ['tinder', 'hinge', 'bumble', 'match', 'okcupid', 'coffee_meets_bagel', 'plenty_of_fish', 'happn', 'thursday', 'imessage']
   const MAX_TEXT_LENGTH = 2000

   function validatePlatform(req, res, next) {
     const platform = req.body.platform || req.query.platform
     if (platform && !VALID_PLATFORMS.includes(platform.toLowerCase())) {
       return res.status(400).json({
         error: 'Invalid platform',
         valid_platforms: VALID_PLATFORMS,
       })
     }
     next()
   }

   function validateTextLength(fields) {
     return (req, res, next) => {
       for (const field of fields) {
         const val = req.body[field]
         if (val && typeof val === 'string' && val.length > MAX_TEXT_LENGTH) {
           return res.status(400).json({
             error: `${field} exceeds maximum length of ${MAX_TEXT_LENGTH} characters`,
           })
         }
       }
       next()
     }
   }

   module.exports = { validatePlatform, validateTextLength, VALID_PLATFORMS }
   ```

2. Apply to relevant routes:
   - Events sync routes: `validatePlatform`
   - Opener/coaching text routes: `validateTextLength(['opener_text', 'message', 'body'])`

### Task 3: Add DB connectivity probe to /health endpoint (SEC-07)

1. Find `/health` route in `api/src/index.js` or `api/src/routes/health.js`
2. Replace simple 200 OK with DB probe:
   ```javascript
   router.get('/health', asyncHandler(async (req, res) => {
     const start = Date.now()

     // Probe Supabase with a lightweight query
     try {
       const { error } = await supabase
         .from('profiles')
         .select('id')
         .limit(1)
         .single()

       if (error && error.code !== 'PGRST116') { // PGRST116 = no rows, that's fine
         throw error
       }
     } catch (err) {
       return res.status(503).json({
         status: 'degraded',
         db: 'unreachable',
         error: err.message,
         uptime: process.uptime(),
       })
     }

     res.json({
       status: 'ok',
       db: 'connected',
       latency_ms: Date.now() - start,
       uptime: process.uptime(),
       version: process.env.npm_package_version || '7.0.0',
     })
   }))
   ```

## Acceptance Criteria

- [ ] All async route handlers in `auth.js`, `agent.js`, `analytics.js`, `events.js` wrapped in asyncHandler or try-catch
- [ ] Server survives a simulated DB timeout without crashing (unhandled rejection)
- [ ] `/health` returns 503 when Supabase is unreachable
- [ ] `/health` returns 200 with `db: 'connected'` when healthy
- [ ] Invalid platform value returns 400 with `valid_platforms` list
- [ ] Text field > 2000 chars returns 400
- [ ] Global error handler logs all errors with method + path

## Files to Modify

- `api/src/utils/asyncHandler.js` — NEW file
- `api/src/middleware/errorHandler.js` — NEW file
- `api/src/middleware/validate.js` — NEW file
- `api/src/index.js` — register error handler, health endpoint update
- `api/src/routes/auth.js` — wrap handlers
- `api/src/routes/agent.js` — wrap handlers
- `api/src/routes/analytics.js` — wrap handlers
- `api/src/routes/events.js` — wrap handlers, add platform validation
