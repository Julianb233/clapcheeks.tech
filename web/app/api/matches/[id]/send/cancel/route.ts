import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/matches/[id]/send/cancel?queueId=<id>
 *
 * Removes a pending item from match_intel.outbound_queue (or marks it
 * cancelled if it's already mid-flight). The VPS sender cron skips
 * status='cancelled' so this safely aborts before god mac send fires.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const queueId = new URL(req.url).searchParams.get('queueId')
  if (!queueId) {
    return NextResponse.json({ error: 'queueId required' }, { status: 400 })
  }

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, match_intel')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!match) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }
  const intel =
    (match.match_intel && typeof match.match_intel === 'object'
      ? (match.match_intel as Record<string, unknown>)
      : {}) || {}
  const queue = Array.isArray(intel.outbound_queue)
    ? (intel.outbound_queue as Array<Record<string, unknown>>)
    : []
  let cancelled = false
  for (const item of queue) {
    if (item.id === queueId && item.status === 'pending') {
      item.status = 'cancelled'
      item.cancelled_at = new Date().toISOString()
      cancelled = true
    }
  }
  if (!cancelled) {
    return NextResponse.json(
      { error: 'queued item not found or already sent' },
      { status: 404 },
    )
  }
  intel.outbound_queue = queue
  await (supabase as any)
    .from('clapcheeks_matches')
    .update({ match_intel: intel })
    .eq('id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
