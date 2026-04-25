import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Computes intelligence stats directly from Supabase. Replaces the legacy
// Express /intelligence/stats endpoint that was never deployed to prod.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().split('T')[0]

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  const [analyticsRes, convoRes, matchesRes] = await Promise.all([
    supabase
      .from('clapcheeks_analytics_daily')
      .select('platform, swipes_right, matches, messages_sent, dates_booked, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr),
    supabase
      .from('clapcheeks_conversation_stats')
      .select('platform, messages_sent, conversations_started, conversations_replied, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr),
    (supabase as never as ReturnType<typeof createClient> extends Promise<infer S> ? S : never)
      .from('clapcheeks_matches')
      .select('id, platform, status, stage, opened, opener_sent_at, last_activity_at, last_her_initiated_at, messages_total, messages_7d')
      .eq('user_id', user.id),
  ])

  const analytics = (analyticsRes.data ?? []) as Array<{
    platform: string; swipes_right: number; matches: number;
    messages_sent: number; dates_booked: number; date: string
  }>
  const convos = (convoRes.data ?? []) as Array<{
    platform: string; messages_sent: number; conversations_started: number;
    conversations_replied: number; date: string
  }>
  const matches = (matchesRes.data ?? []) as Array<{
    id: string; platform: string; status: string | null; stage: string | null;
    opened: boolean | null; opener_sent_at: string | null;
    last_activity_at: string | null; last_her_initiated_at: string | null;
    messages_total: number | null; messages_7d: number | null
  }>

  // ---- Opener reply rate ----
  // Convo started = there was at least one outbound opener; replied = match status moved past 'opened'
  const openerSent = matches.filter(m => m.opened).length
  const replied = matches.filter(m => m.opened && (m.status === 'conversing' || m.status === 'chatting' || m.status === 'chatting_phone' || m.status === 'date_proposed' || m.status === 'date_booked' || m.status === 'dated')).length
  const opener_reply_rate = openerSent > 0 ? replied / openerSent : 0

  // ---- Reply rate by platform ----
  const byPlatformOpened: Record<string, { sent: number; replied: number }> = {}
  for (const m of matches) {
    if (!m.opened) continue
    const p = m.platform || 'unknown'
    if (!byPlatformOpened[p]) byPlatformOpened[p] = { sent: 0, replied: 0 }
    byPlatformOpened[p].sent++
    if (m.status && !['new', 'opened'].includes(m.status)) byPlatformOpened[p].replied++
  }
  const by_platform: Record<string, number> = {}
  for (const [k, v] of Object.entries(byPlatformOpened)) {
    by_platform[k] = v.sent > 0 ? v.replied / v.sent : 0
  }

  // ---- Stage funnel ----
  const stage_funnel = {
    opened: matches.filter(m => m.opened).length,
    replied: matches.filter(m => m.status && !['new', 'opened'].includes(m.status)).length,
    date_ready: matches.filter(m => m.stage && ['date_proposed', 'date_booked', 'date_attended', 'hooked_up', 'recurring'].includes(m.stage)).length,
    booked: matches.filter(m => m.stage && ['date_booked', 'date_attended', 'hooked_up', 'recurring'].includes(m.stage)).length,
  }

  // ---- Top openers (placeholder until opener_log is populated) ----
  // Show top performing platforms instead, framed as openers
  const top_openers = Object.entries(by_platform)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([platform, rate]) => ({
      text: `${platform.charAt(0).toUpperCase() + platform.slice(1)} opener performance`,
      reply_rate: rate,
      platform,
    }))

  // ---- Best send time (rough — peak last_her_initiated_at hour/day) ----
  const heatmap: Array<{ day: number; hour: number; total: number; replied: number }> = []
  const heatBucket: Record<string, { total: number; replied: number }> = {}
  for (const m of matches) {
    const ref = m.last_her_initiated_at || m.last_activity_at
    if (!ref) continue
    const d = new Date(ref)
    const key = `${d.getDay()}-${d.getHours()}`
    if (!heatBucket[key]) heatBucket[key] = { total: 0, replied: 0 }
    heatBucket[key].total++
    if (m.status && !['new', 'opened', 'ghosted', 'stalled'].includes(m.status)) heatBucket[key].replied++
  }
  for (const [key, v] of Object.entries(heatBucket)) {
    const [day, hour] = key.split('-').map(Number)
    heatmap.push({ day, hour, total: v.total, replied: v.replied })
  }
  const peak = heatmap.length > 0 ? heatmap.reduce((a, b) => (b.replied / Math.max(b.total, 1)) > (a.replied / Math.max(a.total, 1)) ? b : a) : null
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const best_send_time = peak ? { hour: peak.hour, day: DAY_LABELS[peak.day] } : null

  // ---- Trend: this-week vs last-week reply rate ----
  function periodRate(start: Date, end: Date) {
    const matchesIn = matches.filter(m => {
      const ref = m.opener_sent_at ? new Date(m.opener_sent_at) : null
      return ref && ref >= start && ref < end
    })
    const sent = matchesIn.filter(m => m.opened).length
    const r = matchesIn.filter(m => m.opened && m.status && !['new', 'opened'].includes(m.status)).length
    return sent > 0 ? r / sent : 0
  }
  const this_week = periodRate(sevenDaysAgo, new Date())
  const last_week = periodRate(fourteenDaysAgo, sevenDaysAgo)

  return NextResponse.json({
    opener_reply_rate,
    by_platform,
    stage_funnel,
    top_openers,
    best_send_time,
    trend: { this_week, last_week },
    heatmap,
    // Echo back so client can show context
    matches_total: matches.length,
    analytics_days: analytics.length,
    convos_days: convos.length,
  })
}
