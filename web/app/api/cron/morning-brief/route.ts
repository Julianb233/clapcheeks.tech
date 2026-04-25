import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// GET /api/cron/morning-brief — fires once at 8am Pacific (15:00 UTC).
// For every active user, summarize the last 24h: new matches, replies,
// flakes, dates booked, hot threads. Sends as one iMessage to Julian.

const JULIAN_PHONE = '+16195090699'

async function sendBlueBubbles(handle: string, body: string): Promise<boolean> {
  const candidates = [
    { url: process.env.BLUEBUBBLES_URL, pw: process.env.BLUEBUBBLES_PASSWORD },
    { url: process.env.BLUEBUBBLES_URL_FALLBACK, pw: process.env.BLUEBUBBLES_PASSWORD_FALLBACK },
  ]
  for (const c of candidates) {
    if (!c.url || !c.pw) continue
    try {
      const res = await fetch(`${c.url.replace(/\/$/, '')}/api/v1/message/text?password=${encodeURIComponent(c.pw)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatGuid: `iMessage;-;${handle}`, message: body, method: 'apple-script' }),
      })
      if (res.ok) return true
    } catch {}
  }
  return false
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  const vercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
  if (!vercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Single-tenant for now: just Julian. Easy to loop over profiles later.
  const userId = '9c848c51-8996-4f1f-9dbf-50128e3408ea'

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [newMatchesRes, eventsRes, hotRes, flakeRes] = await Promise.all([
    supabase
      .from('clapcheeks_matches')
      .select('id, name, platform, julian_rank, close_probability')
      .eq('user_id', userId)
      .gte('created_at', since)
      .limit(20),
    supabase
      .from('clapcheeks_date_events')
      .select('event_type')
      .eq('user_id', userId)
      .gte('created_at', since),
    supabase
      .from('clapcheeks_matches')
      .select('id, name, julian_rank, close_probability, last_her_initiated_at')
      .eq('user_id', userId)
      .gte('last_her_initiated_at', since)
      .or('julian_rank.gte.7,close_probability.gte.0.6')
      .limit(10),
    supabase
      .from('clapcheeks_matches')
      .select('id, name, flake_count')
      .eq('user_id', userId)
      .gt('flake_count', 0)
      .gte('last_flake_at', since)
      .limit(10),
  ])

  const newMatches = newMatchesRes.data ?? []
  const events = eventsRes.data ?? []
  const hot = hotRes.data ?? []
  const flakes = flakeRes.data ?? []

  const newDateEvents = events.filter(e => ['date_booked', 'date_proposed', 'date_attended'].includes(e.event_type)).length
  const reschedEvents = events.filter(e => e.event_type === 'rescheduled').length
  const flakeEvents = events.filter(e => e.event_type === 'flaked').length

  const lines: string[] = ['☀️ Clapcheeks morning brief']
  if (newMatches.length > 0) lines.push(`+${newMatches.length} new match${newMatches.length === 1 ? '' : 'es'}`)
  if (newDateEvents > 0) lines.push(`📅 ${newDateEvents} date event${newDateEvents === 1 ? '' : 's'}`)
  if (reschedEvents > 0) lines.push(`🔁 ${reschedEvents} reschedule${reschedEvents === 1 ? '' : 's'}`)
  if (flakeEvents > 0) lines.push(`🚫 ${flakeEvents} flake${flakeEvents === 1 ? '' : 's'}`)
  if (hot.length > 0) {
    lines.push('')
    lines.push(`Need attention (${hot.length}):`)
    for (const h of hot.slice(0, 5)) {
      const cp = h.close_probability != null ? Math.round(h.close_probability * 100) : null
      lines.push(`• ${h.name} — ${cp ? `${cp}% close` : `★${h.julian_rank ?? '?'}`}`)
    }
  }
  if (lines.length === 1) {
    lines.push('Quiet night. No new replies, matches, or events.')
  }
  lines.push('')
  lines.push('https://clapcheeks.tech/inbox')

  const body = lines.join('\n')
  const sent = await sendBlueBubbles(JULIAN_PHONE, body)

  return NextResponse.json({
    ok: true,
    sent,
    summary: { newMatches: newMatches.length, dateEvents: newDateEvents, reschedules: reschedEvents, flakes: flakeEvents, hot: hot.length },
  })
}
