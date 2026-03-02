import { Router } from 'express'
import { supabase, validateAgentToken } from '../server.js'
import { requireTierAccess, TIER_LIMITS } from '../middleware/tier-check.js'

export const router = Router()

// POST /analytics/sync — agent reports session results
router.post('/sync', validateAgentToken, requireTierAccess, async (req, res) => {
  const { platform, date, swipes_right, swipes_left, matches, messages_sent, dates_booked, conversations_started, money_spent } = req.body
  if (!platform) return res.status(400).json({ error: 'platform required' })

  const today = date || new Date().toISOString().split('T')[0]

  const { error } = await supabase
    .from('outward_analytics_daily')
    .upsert({
      user_id: req.userId,
      date: today,
      platform,
      swipes_right: swipes_right || 0,
      swipes_left: swipes_left || 0,
      matches: matches || 0,
      messages_sent: messages_sent || 0,
      dates_booked: dates_booked || 0,
      conversations_started: conversations_started || 0,
      money_spent: money_spent || 0,
    }, { onConflict: 'user_id,date,platform', ignoreDuplicates: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ synced: true })
})

// GET /analytics/tier — return current tier + limits for this agent token
router.get('/tier', validateAgentToken, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', req.userId)
    .single()

  const tier = profile?.subscription_tier || 'free'
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free

  res.json({
    tier,
    allowed_platforms: limits.platforms,
    max_swipes_per_platform: limits.maxSwipesPerPlatform,
  })
})

// GET /analytics/summary — return 30-day aggregated stats
router.get('/summary', validateAgentToken, async (req, res) => {
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('outward_analytics_daily')
    .select('platform, swipes_right, swipes_left, matches, messages_sent, dates_booked')
    .eq('user_id', req.userId)
    .gte('date', sinceStr)

  if (error) return res.status(500).json({ error: error.message })

  const totals = data.reduce((acc, row) => ({
    swipes: acc.swipes + row.swipes_right + row.swipes_left,
    swipes_right: acc.swipes_right + row.swipes_right,
    matches: acc.matches + row.matches,
    messages: acc.messages + row.messages_sent,
    dates: acc.dates + row.dates_booked,
  }), { swipes: 0, swipes_right: 0, matches: 0, messages: 0, dates: 0 })

  const by_platform = {}
  for (const row of data) {
    if (!by_platform[row.platform]) by_platform[row.platform] = { swipes: 0, matches: 0 }
    by_platform[row.platform].swipes += row.swipes_right
    by_platform[row.platform].matches += row.matches
  }

  res.json({
    ...totals,
    match_rate: totals.swipes_right > 0 ? (totals.matches / totals.swipes_right * 100).toFixed(1) : 0,
    top_platform: Object.entries(by_platform).sort((a, b) => b[1].matches - a[1].matches)[0]?.[0] || null,
    by_platform,
  })
})
