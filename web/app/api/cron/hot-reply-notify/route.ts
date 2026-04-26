import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// GET /api/cron/hot-reply-notify
// Vercel cron triggers this every 5 min. For every user/match where she
// replied in the last 6 minutes AND the match is high-priority
// (julian_rank >= 7 OR close_probability >= 0.6), send Julian an iMessage
// via BlueBubbles. Idempotent: writes to clapcheeks_match_notifications
// to dedupe so the same message can't ping twice.
//
// Secured by CRON_SECRET — Vercel injects ?vercel-cron=true header but
// we also require ?secret= for safety.

const JULIAN_PHONE = '+16195090699'

type HotMatch = {
  id: string
  user_id: string
  name: string | null
  match_name: string | null
  platform: string | null
  julian_rank: number | null
  close_probability: number | null
  last_her_initiated_at: string
}

async function sendBlueBubbles(handle: string, body: string): Promise<{ ok: boolean; error?: string }> {
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
      if (res.ok) return { ok: true }
    } catch {}
  }
  return { ok: false, error: 'all bluebubbles hosts failed' }
}

export async function GET(req: Request) {
  // Auth: accept Vercel cron header OR an explicit secret query param.
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

  // Window: last 6 min so consecutive 5-min crons cover every reply.
  const windowStart = new Date(Date.now() - 6 * 60 * 1000).toISOString()

  const { data: hot } = await supabase
    .from('clapcheeks_matches')
    .select('id, user_id, name, match_name, platform, julian_rank, close_probability, last_her_initiated_at')
    .gte('last_her_initiated_at', windowStart)
    .or('julian_rank.gte.7,close_probability.gte.0.6')
    .returns<HotMatch[]>()

  if (!hot || hot.length === 0) {
    return NextResponse.json({ ok: true, notified: 0, scanned: 0 })
  }

  let notified = 0
  const errors: string[] = []
  for (const m of hot) {
    // Dedupe: skip if we already pinged for this last_her_initiated_at.
    const dedupeKey = `${m.id}-${m.last_her_initiated_at}`
    const { data: existing } = await supabase
      .from('clapcheeks_match_notifications')
      .select('id')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    if (existing) continue

    const name = m.name || m.match_name || 'Match'
    const cp = m.close_probability != null ? Math.round(m.close_probability * 100) : null
    const rank = m.julian_rank ?? '?'
    const tag = cp != null && cp >= 60 ? `${cp}% close` : `rank ${rank}`
    const body = `${name} just replied on ${m.platform || 'a platform'} — ${tag}. https://clapcheeks.tech/matches/${m.id}`

    const r = await sendBlueBubbles(JULIAN_PHONE, body)
    if (r.ok) {
      await supabase
        .from('clapcheeks_match_notifications')
        .insert({ user_id: m.user_id, match_id: m.id, dedupe_key: dedupeKey, channel: 'imessage', body })
      notified++
    } else {
      errors.push(`${name}: ${r.error}`)
    }
  }

  return NextResponse.json({ ok: true, scanned: hot.length, notified, errors })
}
