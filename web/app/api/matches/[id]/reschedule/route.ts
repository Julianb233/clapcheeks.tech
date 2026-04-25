import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomputeScore } from '@/lib/match-scoring'

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
    .select('id, user_id, match_id, reschedule_count, flake_count, stage, messages_total, messages_7d, his_to_her_ratio, avg_reply_hours, time_to_date_days, sentiment_trajectory, close_probability, health_score')
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

  const newReschCount = (match.reschedule_count ?? 0) + 1
  const score = recomputeScore({
    flake_count: match.flake_count ?? 0,
    reschedule_count: newReschCount,
    messages_total: match.messages_total ?? 0,
    messages_7d: match.messages_7d ?? 0,
    his_to_her_ratio: match.his_to_her_ratio ?? null,
    avg_reply_hours: match.avg_reply_hours ?? null,
    time_to_date_days: match.time_to_date_days ?? null,
    sentiment_trajectory: (match.sentiment_trajectory ?? null) as 'positive' | 'neutral' | 'negative' | null,
    stage: match.stage,
    current_close_probability: match.close_probability ?? null,
    current_health_score: match.health_score ?? null,
  })

  // Increment counter + stamp last_reschedule_at + recompute score.
  await (supabase as any)
    .from('clapcheeks_matches')
    .update({
      reschedule_count: newReschCount,
      last_reschedule_at: now,
      updated_at: now,
      close_probability: score.close_probability,
      health_score: score.health_score,
      scoring_reason: score.reason,
      scored_at: now,
      health_score_updated_at: now,
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
