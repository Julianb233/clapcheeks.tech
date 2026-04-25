import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/matches/[id]/reschedule
// Body: { new_slot_iso: string, note?: string }
// Used when a girl asks to push the date. Increments reschedule_count,
// updates the lead's date_slot_iso, and writes an audit row.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    new_slot_iso?: string | null
    note?: string
  }

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, match_id, reschedule_count')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!match) return NextResponse.json({ error: 'match not found' }, { status: 404 })

  // Look up current date_slot_iso from leads to record the original slot.
  const { data: lead } = await (supabase as any)
    .from('clapcheeks_leads')
    .select('date_slot_iso')
    .eq('user_id', user.id)
    .eq('match_id', match.match_id)
    .maybeSingle()
  const originalSlot = lead?.date_slot_iso ?? null

  const newSlot = body.new_slot_iso ? new Date(body.new_slot_iso).toISOString() : null

  const now = new Date().toISOString()

  // Increment counter + stamp last_reschedule_at on the match row.
  await (supabase as any)
    .from('clapcheeks_matches')
    .update({
      reschedule_count: (match.reschedule_count ?? 0) + 1,
      last_reschedule_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  // Push new slot to the lead (if provided).
  if (newSlot) {
    await (supabase as any)
      .from('clapcheeks_leads')
      .update({ date_slot_iso: newSlot, updated_at: now })
      .eq('user_id', user.id)
      .eq('match_id', match.match_id)
  }

  // Audit log.
  await (supabase as any)
    .from('clapcheeks_date_events')
    .insert({
      user_id: user.id,
      match_id: match.id,
      event_type: 'rescheduled',
      original_slot: originalSlot,
      new_slot: newSlot,
      note: body.note ?? null,
    })

  return NextResponse.json({
    ok: true,
    reschedule_count: (match.reschedule_count ?? 0) + 1,
    original_slot: originalSlot,
    new_slot: newSlot,
  })
}
