---
plan: "Rate Limiting & Body Size Limits"
phase: "Phase 2: Security & API Hardening"
wave: 2
autonomous: true
requirements: [SEC-03, SEC-06]
goal: "Add rate limiting to auth and AI endpoints, set explicit body size limits"
---

# Plan 02: Rate Limiting & Body Size Limits

**Phase:** Phase 2 — Security & API Hardening
**Requirements:** SEC-03, SEC-06
**Priority:** P1/P2
**Wave:** 2

## Context

- Zero rate limiting → unlimited requests to auth device codes, AI endpoints, analytics sync
- `express.json()` body limit not explicit → photo scoring accepts arbitrary-size base64 payloads

## Tasks

### Task 1: Install and configure express-rate-limit (SEC-03)

1. Install dependency:
   ```bash
   cd api && npm install express-rate-limit
   ```

2. Create rate limiter configs in `api/src/middleware/rateLimiter.js`:
   ```javascript
   const rateLimit = require('express-rate-limit')

   // Auth endpoints: strict (5 req/min per IP)
   const authLimiter = rateLimit({
     windowMs: 60 * 1000,
     max: 5,
     message: { error: 'Too many requests. Please wait a minute.' },
     standardHeaders: true,
     legacyHeaders: false,
   })

   // AI/generation endpoints: per-user (20 req/min)
   const aiLimiter = rateLimit({
     windowMs: 60 * 1000,
     max: 20,
     keyGenerator: (req) => req.user?.id || req.ip,
     message: { error: 'Rate limit exceeded for AI features. Please wait.' },
     standardHeaders: true,
     legacyHeaders: false,
   })

   // General API: moderate (100 req/min per IP)
   const generalLimiter = rateLimit({
     windowMs: 60 * 1000,
     max: 100,
     message: { error: 'Too many requests.' },
     standardHeaders: true,
     legacyHeaders: false,
   })

   module.exports = { authLimiter, aiLimiter, generalLimiter }
   ```

3. Apply limiters to routes in `api/src/index.js`:
   ```javascript
   const { authLimiter, aiLimiter, generalLimiter } = require('./middleware/rateLimiter')

   // Apply general limiter to all routes
   app.use(generalLimiter)

   // Auth routes: strict
   app.use('/auth', authLimiter)

   // AI routes: per-user
   app.use('/coaching', aiLimiter)
   app.use('/photos', aiLimiter)
   ```

### Task 2: Set explicit body size limits (SEC-06)

1. Find `express.json()` configuration in `api/src/index.js`
2. Replace with explicit limits:
   ```javascript
   // General JSON limit: 1MB
   app.use(express.json({ limit: '1mb' }))
   app.use(express.urlencoded({ extended: true, limit: '1mb' }))
   ```

3. For photo scoring route specifically, add per-route limit:
   ```javascript
   // photos route can accept larger body for base64 images
   router.post('/score',
     express.json({ limit: '5mb' }),
     auth,
     requirePlan('pro'),
     async (req, res) => {
       // Validate image size explicitly
       const { image } = req.body
       if (image && Buffer.from(image, 'base64').length > 5 * 1024 * 1024) {
         return res.status(413).json({ error: 'Image too large. Max 5MB.' })
       }
       // ... handler
     }
   )
   ```

## Acceptance Criteria

- [ ] `express-rate-limit` installed in `api/package.json`
- [ ] Auth endpoints return 429 after 5 rapid requests from same IP
- [ ] AI endpoints return 429 after 20 rapid requests from same user
- [ ] `express.json({ limit: '1mb' })` set globally
- [ ] Photo scoring route rejects images > 5MB with 413 status
- [ ] Rate limit headers present in responses (`RateLimit-*`)

## Files to Modify

- `api/package.json` — add `express-rate-limit` dependency
- `api/src/index.js` — apply limiters globally
- `api/src/middleware/rateLimiter.js` — NEW file
- `api/src/routes/photos.js` — per-route body limit
