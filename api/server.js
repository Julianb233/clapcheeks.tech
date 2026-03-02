import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createClient } from '@supabase/supabase-js'
import { router as authRouter } from './routes/auth.js'
import { router as analyticsRouter } from './routes/analytics.js'
import { router as agentRouter } from './routes/agent.js'
import { router as stripeRouter } from './routes/stripe.js'
import { router as referralRouter } from './routes/referral.js'

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
app.use(express.json())

app.use('/auth', authRouter)
app.use('/analytics', analyticsRouter)
app.use('/agent', agentRouter)
app.use('/stripe', stripeRouter)
app.use('/referral', referralRouter)

app.get('/health', (req, res) => res.json({ status: 'ok', version: '0.1.0' }))

app.listen(PORT, () => console.log(`Clapcheeks API running on port ${PORT}`))
