import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/cron/restage — daily auto-stage sweep.
 *
 * - last_activity_at older than  7d  → stage='faded'
 * - last_activity_at older than 14d  → stage='ghosted'
 *
 * Idempotent: never demotes back to a fresher stage.
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. Local
 * runs are also allowed if CRON_SECRET is unset (dev convenience).
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json(
      { error: 'Supabase env not configured' },
      { status: 500 },
    )
  }

  const sb = createClient(url, key, { auth: { persistSession: false } })

  const day = 24 * 3600 * 1000
  const sevenDaysAgo = new Date(Date.now() - 7 * day).toISOString()
  const fourteenDaysAgo = new Date(Date.now() - 14 * day).toISOString()

  // ghosted: cold > 14d AND not already terminal
  const { data: ghostedRows, error: gErr } = await (sb as any)
    .from('clapcheeks_matches')
    .update({ stage: 'ghosted' })
    .lt('last_activity_at', fourteenDaysAgo)
    .not(
      'stage',
      'in',
      '("ghosted","archived","archived_cluster_dupe","date_attended","hooked_up","recurring")',
    )
    .select('id, name, last_activity_at')

  // faded: cold 7-14d AND not already terminal
  const { data: fadedRows, error: fErr } = await (sb as any)
    .from('clapcheeks_matches')
    .update({ stage: 'faded' })
    .lt('last_activity_at', sevenDaysAgo)
    .gte('last_activity_at', fourteenDaysAgo)
    .not(
      'stage',
      'in',
      '("ghosted","faded","archived","archived_cluster_dupe","date_attended","hooked_up","recurring")',
    )
    .select('id, name, last_activity_at')

  return NextResponse.json({
    ok: true,
    ghosted: ghostedRows?.length ?? 0,
    faded: fadedRows?.length ?? 0,
    errors: [gErr?.message, fErr?.message].filter(Boolean),
  })
}
