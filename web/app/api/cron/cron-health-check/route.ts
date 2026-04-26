import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// GET /api/cron/cron-health-check?secret=...
// Single-call health probe used by the schedule routine.
// Fans out 7 checks in parallel, then iMessages Julian a green/red summary.

const JULIAN_PHONE = '+16195090699'
// Names I seeded in earlier sessions and then wiped — if any reappear,
// something inserted them again.
const SEED_NAMES = new Set([
  'Sienna', 'Reese', 'Mia', 'Camila', 'Ava', 'Layla', 'Zoe', 'Harper',
  'Olivia', 'Aria', 'Nora', 'Iris', 'Eden', 'Leah', 'Sage', 'Quinn',
  'Stella', 'Brooklyn',
])

async function sendBB(handle: string, body: string): Promise<boolean> {
  for (const c of [
    { url: process.env.BLUEBUBBLES_URL, pw: process.env.BLUEBUBBLES_PASSWORD },
    { url: process.env.BLUEBUBBLES_URL_FALLBACK, pw: process.env.BLUEBUBBLES_PASSWORD_FALLBACK },
  ]) {
    if (!c.url || !c.pw) continue
    try {
      const r = await fetch(`${c.url.replace(/\/$/, '')}/api/v1/message/text?password=${encodeURIComponent(c.pw)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatGuid: `iMessage;-;${handle}`, message: body, method: 'apple-script' }),
        signal: AbortSignal.timeout(8_000),
      })
      if (r.ok) return true
    } catch {}
  }
  return false
}

async function probe(url: string, expected: number, label: string) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    return { label, ok: r.status === expected, status: r.status as number | string, expected }
  } catch (e) {
    return { label, ok: false, status: e instanceof Error ? e.message.slice(0, 60) : 'fetch err', expected }
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  const vercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
  if (!vercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const silent = url.searchParams.get('silent') === '1'

  const base = 'https://clapcheeks.tech'

  // Fire all HTTP probes in parallel.
  const httpProbes = await Promise.all([
    probe(`${base}/`, 200, 'public /'),
    probe(`${base}/login`, 200, 'public /login'),
    probe(`${base}/dashboard/roster`, 307, 'authed /dashboard/roster'),
    probe(`${base}/inbox`, 307, 'authed /inbox'),
    probe(`${base}/api/intelligence/stats`, 401, 'api /api/intelligence/stats'),
    // BlueBubbles requires ?password= on every endpoint, so include it for a real liveness check.
    probe(`https://bubbles-macbook.aiacrobatics.com/api/v1/server/info?password=${encodeURIComponent(process.env.BLUEBUBBLES_PASSWORD || '')}`, 200, 'bluebubbles macbook'),
    probe('https://ollama-macbook.aiacrobatics.com/api/tags', 200, 'ollama tunnel'),
  ])

  // DB sanity in parallel with HTTP probes (separate await chain).
  let dbInfo = { matches: -1, fakes: 0, notifications24h: 0, seedNames: [] as string[] }
  let dbError: string | null = null
  try {
    const supabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const julian = '9c848c51-8996-4f1f-9dbf-50128e3408ea'
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [matches, notifs] = await Promise.all([
      supabase.from('clapcheeks_matches').select('name').eq('user_id', julian),
      supabase.from('clapcheeks_match_notifications').select('id', { count: 'exact', head: true }).gte('sent_at', since),
    ])
    const names = (matches.data ?? []).map((m: { name: string | null }) => m.name).filter((n): n is string => !!n)
    const seeds = names.filter(n => SEED_NAMES.has(n))
    dbInfo.matches = names.length
    dbInfo.fakes = seeds.length
    dbInfo.seedNames = seeds
    dbInfo.notifications24h = notifs.count ?? 0
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  const failed = httpProbes.filter(p => !p.ok)
  const allGreen = failed.length === 0 && !dbError && dbInfo.fakes === 0

  let smsBody: string
  if (allGreen) {
    smsBody = `[clapcheeks] all green - ${dbInfo.matches} matches, ${dbInfo.notifications24h} notifs/24h`
  } else {
    const lines: string[] = ['[clapcheeks] HEALTH ISSUES:']
    for (const f of failed) {
      lines.push(`X ${f.label}: got ${f.status} (expected ${f.expected})`)
    }
    if (dbError) lines.push(`X db: ${dbError.slice(0, 100)}`)
    if (dbInfo.fakes > 0) {
      lines.push(`X seeded fakes detected: ${dbInfo.seedNames.join(', ')}`)
    }
    lines.push(`(${dbInfo.matches} matches, ${dbInfo.notifications24h} notifs/24h)`)
    smsBody = lines.join('\n')
  }

  let smsSent = false
  if (!silent) smsSent = await sendBB(JULIAN_PHONE, smsBody)

  return NextResponse.json({
    ok: allGreen,
    timestamp: new Date().toISOString(),
    sms_sent: smsSent,
    summary: smsBody,
    checks: httpProbes,
    db: { ...dbInfo, error: dbError },
  }, { status: allGreen ? 200 : 503 })
}
