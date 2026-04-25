import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomputeScore } from '@/lib/match-scoring'

// POST /api/matches/[id]/flake
// Body: { note?: string, demote_stage?: boolean }
// Used when a girl no-shows or ghosts a confirmed date. Increments
// flake_count, optionally demotes the stage to 'faded', and audits.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    note?: string
    demote_stage?: boolean
  }

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, match_id, flake_count, reschedule_count, stage, messages_total, messages_7d, his_to_her_ratio, avg_reply_hours, time_to_date_days, sentiment_trajectory, close_probability, health_score')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!match) return NextResponse.json({ error: 'match not found' }, { status: 404 })

  const { data: lead } = await (supabase as any)
    .from('clapcheeks_leads')
    .select('date_slot_iso')
    .eq('user_id', user.id)
    .eq('match_id', match.match_id)
    .maybeSingle()
  const originalSlot = lead?.date_slot_iso ?? null

  const now = new Date().toISOString()
  const newFlakeCount = (match.flake_count ?? 0) + 1
  const update: Record<string, unknown> = {
    flake_count: newFlakeCount,
    last_flake_at: now,
    updated_at: now,
  }
  // Default policy: 1st flake stays put, 2+ demotes to faded. Caller can override.
  if (body.demote_stage === true || (body.demote_stage !== false && newFlakeCount >= 2)) {
    update.stage = 'faded'
  }

  // Recompute score with the bumped flake count + (possibly) new stage.
  const score = recomputeScore({
    flake_count: newFlakeCount,
    reschedule_count: match.reschedule_count ?? 0,
    messages_total: match.messages_total ?? 0,
    messages_7d: match.messages_7d ?? 0,
    his_to_her_ratio: match.his_to_her_ratio ?? null,
    avg_reply_hours: match.avg_reply_hours ?? null,
    time_to_date_days: match.time_to_date_days ?? null,
    sentiment_trajectory: (match.sentiment_trajectory ?? null) as 'positive' | 'neutral' | 'negative' | null,
    stage: (update.stage as string | undefined) ?? match.stage,
    current_close_probability: match.close_probability ?? null,
    current_health_score: match.health_score ?? null,
  })
  update.close_probability = score.close_probability
  update.health_score = score.health_score
  update.scoring_reason = score.reason
  update.scored_at = now
  update.health_score_updated_at = now

  await (supabase as any)
    .from('clapcheeks_matches')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)

  // Clear the upcoming date slot on the lead.
  await (supabase as any)
    .from('clapcheeks_leads')
    .update({ date_slot_iso: null, updated_at: now })
    .eq('user_id', user.id)
    .eq('match_id', match.match_id)

  await (supabase as any)
    .from('clapcheeks_date_events')
    .insert({
      user_id: user.id,
      match_id: match.id,
      event_type: 'flaked',
      original_slot: originalSlot,
      new_slot: null,
      note: body.note ?? null,
    })

  return NextResponse.json({
    ok: true,
    flake_count: newFlakeCount,
    demoted: !!update.stage,
  })
}
