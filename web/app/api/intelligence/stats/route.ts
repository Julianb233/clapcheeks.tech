import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Shape consumed by web/app/(main)/intelligence/page.tsx (interface Stats).
// Keep additions backwards-compatible; do not remove fields.
type FunnelCounts = {
  opened: number
  replied: number
  date_ready: number
  booked: number
}

type StatsResponse = {
  opener_reply_rate: number
  by_platform: Record<string, number>
  stage_funnel: FunnelCounts
  top_openers: { text: string; reply_rate: number; platform: string }[]
  best_send_time: { hour: number; day: string } | null
  trend: { this_week: number; last_week: number }
  heatmap: { day: number; hour: number; total: number; replied: number }[]
  // Optional metadata so the UI can render a graceful empty state
  // when the underlying tables haven't been provisioned yet.
  not_yet_available?: boolean
  missing_tables?: string[]
}

const EMPTY_STATS: StatsResponse = {
  opener_reply_rate: 0,
  by_platform: {},
  stage_funnel: { opened: 0, replied: 0, date_ready: 0, booked: 0 },
  top_openers: [],
  best_send_time: null,
  trend: { this_week: 0, last_week: 0 },
  heatmap: [],
}

// PostgREST returns code "PGRST205" when a table is not exposed (e.g. missing
// migration). We treat that as "data collection in progress" rather than 500.
const isMissingTableError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string }
  if (e.code === 'PGRST205' || e.code === 'PGRST116' || e.code === '42P01') return true
  if (typeof e.message === 'string') {
    const m = e.message.toLowerCase()
    return m.includes('does not exist') || m.includes('not found in the schema cache')
  }
  return false
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString()

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [openerRes, eventRes] = await Promise.all([
    supabase
      .from('clapcheeks_opener_log')
      .select('platform, opener_text, opener_style, got_reply, created_at')
      .eq('user_id', user.id)
      .gte('created_at', sinceStr),
    supabase
      .from('clapcheeks_conversation_events')
      .select('to_stage, created_at')
      .eq('user_id', user.id)
      .gte('created_at', sinceStr),
  ])

  // Track tables that aren't deployed yet. If both source tables are missing
  // we return an empty payload at HTTP 200 so the UI shows the "no data yet"
  // copy instead of an error toast.
  const missingTables: string[] = []
  if (openerRes.error && isMissingTableError(openerRes.error)) {
    missingTables.push('clapcheeks_opener_log')
  } else if (openerRes.error) {
    return NextResponse.json(
      { error: openerRes.error.message ?? 'Failed to load opener log' },
      { status: 500 },
    )
  }
  if (eventRes.error && isMissingTableError(eventRes.error)) {
    missingTables.push('clapcheeks_conversation_events')
  } else if (eventRes.error) {
    return NextResponse.json(
      { error: eventRes.error.message ?? 'Failed to load conversation events' },
      { status: 500 },
    )
  }

  if (missingTables.length === 2) {
    return NextResponse.json<StatsResponse>({
      ...EMPTY_STATS,
      not_yet_available: true,
      missing_tables: missingTables,
    })
  }

  const allOpeners = openerRes.data ?? []
  const allEvents = eventRes.data ?? []

  // Overall reply rate
  const totalOpeners = allOpeners.length
  const replied = allOpeners.filter((o) => o.got_reply).length
  const openerReplyRate = totalOpeners > 0 ? replied / totalOpeners : 0

  // Reply rate by platform
  const byPlatformRaw: Record<string, { total: number; replied: number }> = {}
  for (const o of allOpeners) {
    const platform = o.platform ?? 'unknown'
    if (!byPlatformRaw[platform]) byPlatformRaw[platform] = { total: 0, replied: 0 }
    byPlatformRaw[platform].total++
    if (o.got_reply) byPlatformRaw[platform].replied++
  }
  const platformRates: Record<string, number> = {}
  for (const [p, v] of Object.entries(byPlatformRaw)) {
    platformRates[p] = v.total > 0 ? Math.round((v.replied / v.total) * 100) / 100 : 0
  }

  // Stage funnel — opened from opener log, plus events for downstream stages.
  const stageCounts: FunnelCounts = { opened: totalOpeners, replied: 0, date_ready: 0, booked: 0 }
  for (const e of allEvents) {
    const to = e.to_stage as keyof FunnelCounts | undefined
    if (to && to in stageCounts) {
      stageCounts[to]++
    }
  }
  // Replied count also comes from opener got_reply (whichever is higher).
  stageCounts.replied = Math.max(stageCounts.replied, replied)

  // Top openers grouped by opener_text (require >= 2 sends for stability)
  const openerStats: Record<
    string,
    { text: string; total: number; replied: number; platform: string }
  > = {}
  for (const o of allOpeners) {
    const text = (o.opener_text ?? '').toString()
    const key = text.substring(0, 100)
    if (!key) continue
    if (!openerStats[key]) {
      openerStats[key] = { text, total: 0, replied: 0, platform: o.platform ?? 'unknown' }
    }
    openerStats[key].total++
    if (o.got_reply) openerStats[key].replied++
  }
  const topOpeners = Object.values(openerStats)
    .filter((o) => o.total >= 2)
    .map((o) => ({
      text: o.text,
      reply_rate: Math.round((o.replied / o.total) * 100) / 100,
      platform: o.platform,
    }))
    .sort((a, b) => b.reply_rate - a.reply_rate)
    .slice(0, 5)

  // Best send time — hour/day combo with the highest reply rate (>= 2 sends)
  const hourDayMap: Record<
    string,
    { hour: number; day: string; total: number; replied: number }
  > = {}
  for (const o of allOpeners) {
    if (!o.created_at) continue
    const d = new Date(o.created_at)
    const hour = d.getUTCHours()
    const day = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    const key = `${day}-${hour}`
    if (!hourDayMap[key]) hourDayMap[key] = { hour, day, total: 0, replied: 0 }
    hourDayMap[key].total++
    if (o.got_reply) hourDayMap[key].replied++
  }
  const bestTime = Object.values(hourDayMap)
    .filter((v) => v.total >= 2)
    .sort((a, b) => b.replied / b.total - a.replied / a.total)[0]

  // Week-over-week trend
  const thisWeekOpeners = allOpeners.filter(
    (o) => o.created_at && new Date(o.created_at) >= weekAgo,
  )
  const lastWeekOpeners = allOpeners.filter(
    (o) => o.created_at && new Date(o.created_at) < weekAgo,
  )
  const thisWeekRate =
    thisWeekOpeners.length > 0
      ? thisWeekOpeners.filter((o) => o.got_reply).length / thisWeekOpeners.length
      : 0
  const lastWeekRate =
    lastWeekOpeners.length > 0
      ? lastWeekOpeners.filter((o) => o.got_reply).length / lastWeekOpeners.length
      : 0

  // Heatmap data — 7 days x 24 hours
  const heatmapMap: Record<
    string,
    { day: number; hour: number; total: number; replied: number }
  > = {}
  for (const o of allOpeners) {
    if (!o.created_at) continue
    const d = new Date(o.created_at)
    const dayOfWeek = d.getUTCDay()
    const hour = d.getUTCHours()
    const key = `${dayOfWeek}-${hour}`
    if (!heatmapMap[key]) heatmapMap[key] = { day: dayOfWeek, hour, total: 0, replied: 0 }
    heatmapMap[key].total++
    if (o.got_reply) heatmapMap[key].replied++
  }

  const payload: StatsResponse = {
    opener_reply_rate: Math.round(openerReplyRate * 100) / 100,
    by_platform: platformRates,
    stage_funnel: stageCounts,
    top_openers: topOpeners,
    best_send_time: bestTime ? { hour: bestTime.hour, day: bestTime.day } : null,
    trend: {
      this_week: Math.round(thisWeekRate * 100) / 100,
      last_week: Math.round(lastWeekRate * 100) / 100,
    },
    heatmap: Object.values(heatmapMap),
  }
  if (missingTables.length > 0) {
    payload.missing_tables = missingTables
  }

  return NextResponse.json(payload)
}
