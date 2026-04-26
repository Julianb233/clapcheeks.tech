import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/scheduled-messages/send
 *
 * Approve a scheduled message for sending. The VPS drainer
 * (scripts/outbound_sender.py) picks up rows where status IN
 * ('pending','approved') AND scheduled_at <= NOW() and shells out to
 * `god mac send` with the comms-gate bypass.
 *
 * This route used to execFile('god', ...) directly from Vercel — that
 * path never worked because god doesn't exist in the Vercel runtime.
 * The drainer is the single source of truth for actual delivery.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { id, send_now } = body as { id?: string; send_now?: boolean }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: msg, error: fetchErr } = await supabase
    .from('clapcheeks_scheduled_messages')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (fetchErr || !msg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (msg.status === 'sent' || msg.status === 'rejected') {
    return NextResponse.json(
      { error: `Cannot send: status is ${msg.status}` },
      { status: 400 },
    )
  }

  const update: Record<string, unknown> = { status: 'approved' }
  if (send_now) {
    // Bring the scheduled_at forward so the next drainer tick picks it up.
    update.scheduled_at = new Date().toISOString()
  }

  const { data: updated, error: updateErr } = await supabase
    .from('clapcheeks_scheduled_messages')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({
    message: updated,
    info: send_now
      ? 'Marked as approved with scheduled_at=now; drainer will pick up within 60s.'
      : 'Marked as approved; drainer will send at scheduled_at.',
  })
}
