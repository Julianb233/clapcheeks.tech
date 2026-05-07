import { NextResponse } from 'next/server'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { getConvexServerClient } from '@/lib/convex/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Phase G (AI-8321): Capture post-date outcome.
 *
 * The drip daemon iMessages Julian at +4h after the scheduled end of a
 * booked date asking "how'd [name] go?". Julian's reply (closed / 2nd /
 * nope) is routed to this endpoint from the Mac Mini iMessage bridge, OR
 * Julian taps one of the outcome buttons on /matches/[id] in the dashboard.
 *
 * Either path hits this endpoint — it updates `outcome` + `status` in a
 * single write so the downstream state machine stops prompting.
 *
 * Decision (see PHASE-G report): going dashboard-first because parsing free
 * text in iMessage is brittle; an iMessage "closed" could be Julian
 * referencing something else. The Mac Mini bridge can call this endpoint
 * with a parsed outcome when confidence is high.
 */

type OutcomeBody = {
  outcome?: 'closed' | 'second_date' | 'nope'
}

const VALID_OUTCOMES = new Set(['closed', 'second_date', 'nope'])

const OUTCOME_TO_STATUS: Record<string, string> = {
  closed: 'dated',        // consummated -> dated (terminal success)
  second_date: 'dated',   // keep going -> dated with a future date
  nope: 'ghosted',        // didn't land -> ghosted
}

const OUTCOME_TO_STAGE: Record<string, string> = {
  closed: 'hooked_up',
  second_date: 'second_date',
  nope: 'faded',
}

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
  if (!id) {
    return NextResponse.json({ error: 'match id required' }, { status: 400 })
  }

  let body: OutcomeBody
  try {
    body = (await req.json()) as OutcomeBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const outcome = (body.outcome ?? '').toString().trim().toLowerCase()
  if (!VALID_OUTCOMES.has(outcome)) {
    return NextResponse.json(
      {
        error: `outcome must be one of ${Array.from(VALID_OUTCOMES).join(', ')}`,
      },
      { status: 400 },
    )
  }

  // AI-9534 — match data lives on Convex; auth still on Supabase.
  const convex = getConvexServerClient()
  const matchRow = (await convex.query(api.matches.resolveByAnyId, {
    id,
  })) as
    | (Record<string, unknown> & { _id?: Id<'matches'>; user_id?: string })
    | null

  if (!matchRow || !matchRow._id) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }
  if (matchRow.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await convex.mutation(api.matches.patchByUser, {
      id: matchRow._id,
      user_id: user.id,
      outcome,
      status: OUTCOME_TO_STATUS[outcome],
      stage: OUTCOME_TO_STAGE[outcome],
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'update failed'
    const status = msg === 'forbidden' ? 403 : msg === 'not_found' ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }

  return NextResponse.json({
    ok: true,
    match_id: id,
    outcome,
    status: OUTCOME_TO_STATUS[outcome],
    stage: OUTCOME_TO_STAGE[outcome],
  })
}
