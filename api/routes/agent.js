import { Router } from 'express'
import { randomUUID } from 'crypto'
import { supabase, validateAgentToken } from '../server.js'
import { TIER_LIMITS } from '../middleware/tier-check.js'

export const router = Router()

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!jwt) return res.status(401).json({ error: 'Missing auth token' })
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })
  req.user = user
  next()
}

// POST /agent/register — issue a new agent token for this device
router.post('/register', requireAuth, async (req, res) => {
  const { device_name } = req.body
  const token = randomUUID()
  const { data, error } = await supabase
    .from('clapcheeks_agent_tokens')
    .insert({ user_id: req.user.id, token, device_name: device_name || 'My Mac' })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ agent_token: token, message: 'Device registered' })
})

// GET /agent/config — return agent configuration based on user's tier
router.get('/config', validateAgentToken, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', req.userId)
    .single()

  const tier = profile?.subscription_tier || 'free'
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free

  const featuresByTier = {
    free:    { conversation_ai: false, calendar_booking: false, nlp_personalization: false },
    starter: { conversation_ai: true,  calendar_booking: false, nlp_personalization: false },
    pro:     { conversation_ai: true,  calendar_booking: true,  nlp_personalization: true },
    elite:   { conversation_ai: true,  calendar_booking: true,  nlp_personalization: true },
  }

  res.json({
    tier,
    allowed_platforms: limits.platforms,
    max_swipes_per_platform: limits.maxSwipesPerPlatform,
    features: featuresByTier[tier] || featuresByTier.free,
  })
})

// POST /agent/heartbeat — update last_seen_at
router.post('/heartbeat', validateAgentToken, async (req, res) => {
  await supabase
    .from('clapcheeks_agent_tokens')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_id', req.userId)
  res.json({ ok: true })
})
