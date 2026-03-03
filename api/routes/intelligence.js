import { Router } from 'express'
import { supabase, validateAgentToken } from '../server.js'
import { requirePlan } from '../middleware/requirePlan.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { validatePlatform, validateTextLength } from '../middleware/validate.js'

export const router = Router()

// POST /intelligence/opener — log an opener send
router.post('/opener', validateAgentToken, requirePlan('pro'), validatePlatform, validateTextLength(['opener_text']), asyncHandler(async (req, res) => {
  const { platform, opener_text, opener_style, match_name } = req.body
  if (!platform || !opener_text) {
    return res.status(400).json({ error: 'platform and opener_text required' })
  }

  const { error } = await supabase
    .from('clapcheeks_opener_log')
    .insert({
      user_id: req.userId,
      platform,
      opener_text,
      opener_style: opener_style || null,
      match_name: match_name || null,
    })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ logged: true })
}))

// POST /intelligence/progression — log stage progression
router.post('/progression', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const { platform, match_id, from_stage, to_stage, messages_sent, days_to_progress } = req.body
  if (!platform || !from_stage || !to_stage) {
    return res.status(400).json({ error: 'platform, from_stage, to_stage required' })
  }

  const { error } = await supabase
    .from('clapcheeks_conversation_events')
    .insert({
      user_id: req.userId,
      platform,
      match_id: match_id || null,
      from_stage,
      to_stage,
      messages_sent: messages_sent || 0,
      days_to_progress: days_to_progress || null,
    })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ logged: true })
}))

// GET /intelligence/stats — opener reply rates, stage funnel, best performing styles
router.get('/stats', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString()

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const weekAgoStr = weekAgo.toISOString()

  // Fetch opener logs
  const { data: openers, error: opErr } = await supabase
    .from('clapcheeks_opener_log')
    .select('*')
    .eq('user_id', req.userId)
    .gte('created_at', sinceStr)

  if (opErr) return res.status(500).json({ error: opErr.message })

  // Fetch conversation events
  const { data: events, error: evErr } = await supabase
    .from('clapcheeks_conversation_events')
    .select('*')
    .eq('user_id', req.userId)
    .gte('created_at', sinceStr)

  if (evErr) return res.status(500).json({ error: evErr.message })

  const allOpeners = openers || []
  const allEvents = events || []

  // Overall reply rate
  const totalOpeners = allOpeners.length
  const replied = allOpeners.filter(o => o.got_reply).length
  const openerReplyRate = totalOpeners > 0 ? replied / totalOpeners : 0

  // Reply rate by platform
  const byPlatform = {}
  for (const o of allOpeners) {
    if (!byPlatform[o.platform]) byPlatform[o.platform] = { total: 0, replied: 0 }
    byPlatform[o.platform].total++
    if (o.got_reply) byPlatform[o.platform].replied++
  }
  const platformRates = {}
  for (const [p, v] of Object.entries(byPlatform)) {
    platformRates[p] = v.total > 0 ? Math.round((v.replied / v.total) * 100) / 100 : 0
  }

  // Stage funnel from events
  const stageCounts = { opened: totalOpeners, replied: 0, date_ready: 0, booked: 0 }
  for (const e of allEvents) {
    if (e.to_stage && stageCounts[e.to_stage] !== undefined) {
      stageCounts[e.to_stage]++
    }
  }
  // replied count also comes from opener got_reply
  stageCounts.replied = Math.max(stageCounts.replied, replied)

  // Top openers by reply rate (group by opener_text)
  const openerStats = {}
  for (const o of allOpeners) {
    const key = o.opener_text.substring(0, 100)
    if (!openerStats[key]) openerStats[key] = { text: o.opener_text, total: 0, replied: 0, platform: o.platform }
    openerStats[key].total++
    if (o.got_reply) openerStats[key].replied++
  }
  const topOpeners = Object.values(openerStats)
    .filter(o => o.total >= 2)
    .map(o => ({ text: o.text, reply_rate: Math.round((o.replied / o.total) * 100) / 100, platform: o.platform }))
    .sort((a, b) => b.reply_rate - a.reply_rate)
    .slice(0, 5)

  // Best send time — hour/day with highest reply rate
  const hourDayMap = {}
  for (const o of allOpeners) {
    const d = new Date(o.created_at)
    const hour = d.getUTCHours()
    const day = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    const key = `${day}-${hour}`
    if (!hourDayMap[key]) hourDayMap[key] = { hour, day, total: 0, replied: 0 }
    hourDayMap[key].total++
    if (o.got_reply) hourDayMap[key].replied++
  }
  const bestTime = Object.values(hourDayMap)
    .filter(v => v.total >= 2)
    .sort((a, b) => (b.replied / b.total) - (a.replied / a.total))[0]

  // Week-over-week trend
  const thisWeekOpeners = allOpeners.filter(o => new Date(o.created_at) >= weekAgo)
  const lastWeekOpeners = allOpeners.filter(o => new Date(o.created_at) < weekAgo)
  const thisWeekRate = thisWeekOpeners.length > 0
    ? thisWeekOpeners.filter(o => o.got_reply).length / thisWeekOpeners.length
    : 0
  const lastWeekRate = lastWeekOpeners.length > 0
    ? lastWeekOpeners.filter(o => o.got_reply).length / lastWeekOpeners.length
    : 0

  // Heatmap data — 7 days x 24 hours
  const heatmap = {}
  for (const o of allOpeners) {
    const d = new Date(o.created_at)
    const dayOfWeek = d.getUTCDay()
    const hour = d.getUTCHours()
    const key = `${dayOfWeek}-${hour}`
    if (!heatmap[key]) heatmap[key] = { day: dayOfWeek, hour, total: 0, replied: 0 }
    heatmap[key].total++
    if (o.got_reply) heatmap[key].replied++
  }

  res.json({
    opener_reply_rate: Math.round(openerReplyRate * 100) / 100,
    by_platform: platformRates,
    stage_funnel: stageCounts,
    top_openers: topOpeners,
    best_send_time: bestTime ? { hour: bestTime.hour, day: bestTime.day } : null,
    trend: {
      this_week: Math.round(thisWeekRate * 100) / 100,
      last_week: Math.round(lastWeekRate * 100) / 100,
    },
    heatmap: Object.values(heatmap),
  })
}))

// GET /intelligence/ab-test — A/B comparison of opener styles
router.get('/ab-test', validateAgentToken, requirePlan('pro'), asyncHandler(async (req, res) => {
  const since = new Date()
  since.setDate(since.getDate() - 30)

  const { data: openers, error } = await supabase
    .from('clapcheeks_opener_log')
    .select('opener_style, got_reply')
    .eq('user_id', req.userId)
    .gte('created_at', since.toISOString())
    .not('opener_style', 'is', null)

  if (error) return res.status(500).json({ error: error.message })

  const styles = {}
  for (const o of (openers || [])) {
    const style = o.opener_style || 'default'
    if (!styles[style]) styles[style] = { style, total: 0, replied: 0 }
    styles[style].total++
    if (o.got_reply) styles[style].replied++
  }

  const results = Object.values(styles)
    .map(s => ({
      style: s.style,
      sent: s.total,
      reply_rate: s.total > 0 ? Math.round((s.replied / s.total) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.reply_rate - a.reply_rate)

  const winner = results.length > 0 ? results[0].style : null

  res.json({ styles: results, winner })
}))
