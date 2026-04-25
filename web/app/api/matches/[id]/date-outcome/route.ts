import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_NEXT_STEPS = new Set([
  'more_dates',
  'recurring',
  'friend_zone',
  'one_and_done',
  'undecided',
])

/**
 * POST /api/matches/[id]/date-outcome
 *   body: {
 *     date: ISO date (the date the date happened),
 *     rating: 1-5,
 *     vibe_tags?: string[],          // ["chemistry","awkward","funny",...]
 *     next_step: "more_dates" | "recurring" | "friend_zone" | "one_and_done" | "undecided",
 *     lessons?: string,
 *     hooked_up?: boolean,
 *   }
 *
 * Appends to match_intel.date_outcomes[] and updates stage based on
 * next_step (recurring -> stage='recurring', one_and_done -> 'faded', etc).
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

  const body = (await req.json().catch(() => ({}))) as {
    date?: string
    rating?: number
    vibe_tags?: unknown
    next_step?: string
    lessons?: string
    hooked_up?: boolean
  }

  const rating = Number(body.rating)
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: 'rating must be an integer 1-5' },
      { status: 400 },
    )
  }
  if (!body.next_step || !ALLOWED_NEXT_STEPS.has(body.next_step)) {
    return NextResponse.json(
      { error: `next_step must be one of: ${[...ALLOWED_NEXT_STEPS].join(', ')}` },
      { status: 400 },
    )
  }

  const tags = Array.isArray(body.vibe_tags)
    ? body.vibe_tags.filter((t) => typeof t === 'string').slice(0, 12)
    : []

  const { data: existing } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, match_intel, stage')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  const intel =
    existing.match_intel && typeof existing.match_intel === 'object'
      ? (existing.match_intel as Record<string, unknown>)
      : {}

  const prior = Array.isArray(intel.date_outcomes) ? intel.date_outcomes : []

  const outcome = {
    date: body.date ?? new Date().toISOString().slice(0, 10),
    rating,
    vibe_tags: tags,
    next_step: body.next_step,
    lessons: body.lessons ?? null,
    hooked_up: !!body.hooked_up,
    captured_at: new Date().toISOString(),
  }

  // Stage transition based on next_step.
  let nextStage = existing.stage
  switch (body.next_step) {
    case 'recurring':
      nextStage = 'recurring'
      break
    case 'more_dates':
      nextStage = 'date_attended'
      break
    case 'friend_zone':
    case 'one_and_done':
      nextStage = 'faded'
      break
  }

  const { data: updated, error } = await (supabase as any)
    .from('clapcheeks_matches')
    .update({
      stage: nextStage,
      match_intel: { ...intel, date_outcomes: [...prior, outcome] },
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name, stage, match_intel')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, match: updated })
}
