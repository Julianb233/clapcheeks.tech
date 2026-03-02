import { supabase } from '../server.js'

export const TIER_LIMITS = {
  free:    { platforms: ['tinder'], maxSwipesPerPlatform: 50 },
  starter: { platforms: ['tinder','bumble','hinge'], maxSwipesPerPlatform: 100 },
  pro:     { platforms: ['tinder','bumble','hinge','grindr','badoo','happn','okcupid'], maxSwipesPerPlatform: 150 },
  elite:   { platforms: ['tinder','bumble','hinge','grindr','badoo','happn','okcupid','pof','feeld','cmb'], maxSwipesPerPlatform: 300 },
}

export async function getTierForToken(agentToken) {
  const { data } = await supabase
    .from('clapcheeks_agent_tokens')
    .select('user_id')
    .eq('token', agentToken)
    .single()
  if (!data) return 'free'

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', data.user_id)
    .single()

  return profile?.subscription_tier || 'free'
}

export async function requireTierAccess(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'No agent token' })

  const tier = await getTierForToken(token)
  const platform = req.body?.platform || req.query?.platform
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free

  if (platform && !limits.platforms.includes(platform)) {
    return res.status(403).json({
      error: `Platform "${platform}" requires ${_planForPlatform(platform)} plan`,
      current_tier: tier,
      upgrade_url: 'https://clapcheeks.tech/pricing',
    })
  }

  req.tier = tier
  req.tierLimits = limits
  next()
}

function _planForPlatform(platform) {
  for (const [tier, limits] of Object.entries(TIER_LIMITS)) {
    if (limits.platforms.includes(platform)) return tier
  }
  return 'elite'
}
