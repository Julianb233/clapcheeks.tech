import 'dotenv/config'
// Sentry must be imported before all other modules
import { Sentry } from './lib/sentry.js'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createClient } from '@supabase/supabase-js'
import { router as authRouter } from './routes/auth.js'
import { router as analyticsRouter } from './routes/analytics.js'
import { router as agentRouter } from './routes/agent.js'
import { router as stripeRouter } from './routes/stripe.js'
import { router as referralRouter } from './routes/referral.js'
import { router as intelligenceRouter } from './routes/intelligence.js'
import { router as eventsRouter } from './routes/events.js'
import { router as emailRouter } from './routes/email.js'
import { authLimiter, aiLimiter, generalLimiter } from './middleware/rateLimiter.js'
import { errorHandler } from './middleware/errorHandler.js'
import { asyncHandler } from './utils/asyncHandler.js'

// Validate required env vars before starting
if (process.env.NODE_ENV === 'production') {
  const required = ['STRIPE_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`)
    console.error('Server cannot start without these variables set.')
    process.exit(1)
  }

  // Guard against test Stripe keys in production
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  if (stripeKey.startsWith('sk_test_')) {
    console.error('[FATAL] STRIPE_SECRET_KEY is a test key but NODE_ENV=production')
    console.error('Use live Stripe keys in production. Refusing to start.')
    process.exit(1)
  }
} else {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[WARN] STRIPE_WEBHOOK_SECRET not set — webhook verification disabled')
  }
}

const app = express()
const PORT = process.env.PORT || 3001

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

// Middleware to validate agent token (Bearer token from clapcheeks_agent_tokens)
export async function validateAgentToken(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing agent token' })

  const { data, error } = await supabase
    .from('clapcheeks_agent_tokens')
    .select('user_id')
    .eq('token', token)
    .single()

  if (error || !data) return res.status(401).json({ error: 'Invalid agent token' })

  req.userId = data.user_id
  next()
}

app.use(helmet())
app.use(cors({ origin: process.env.WEB_URL || 'http://localhost:3000' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// Rate limiting
app.use(generalLimiter)
app.use('/auth', authLimiter, authRouter)
app.use('/analytics', analyticsRouter)
app.use('/agent', agentRouter)
app.use('/stripe', stripeRouter)
app.use('/referral', referralRouter)
app.use('/intelligence', aiLimiter, intelligenceRouter)
app.use('/events', eventsRouter)
// Email onboarding sequence (welcome, day3, day7, day14 via Resend)
// To trigger welcome email automatically on signup, create a Supabase Database Webhook
// on auth.users INSERT → POST to https://api.clapcheeks.tech/email/welcome
app.use('/email', emailRouter)

// Sentry test endpoint — triggers a test error
app.get('/sentry-test', (req, res) => {
  Sentry.captureException(new Error('[Sentry Test] Express API error — PERS-216 verification'))
  res.json({ ok: true, message: 'Test error sent to Sentry', timestamp: new Date().toISOString() })
})

app.get('/health', asyncHandler(async (req, res) => {
  const start = Date.now()

  try {
    const { error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') {
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
    version: process.env.npm_package_version || '0.7.0',
  })
}))

// Global error handler — must be registered last
app.use(errorHandler)

app.listen(PORT, () => console.log(`Clapcheeks API running on port ${PORT}`))
