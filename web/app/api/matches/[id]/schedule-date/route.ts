import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/matches/[id]/schedule-date
 *   body: { startsAt: ISO, endsAt: ISO, location?: string, notes?: string,
 *           addToCalendar?: boolean (default true) }
 *
 * Stages the match to date_booked and stores the date proposal in
 * match_intel.scheduled_date with status='pending_calendar' so the VPS
 * cron picks it up and creates the Google Calendar event on Julian's
 * "Dating" calendar.
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
    startsAt?: string
    endsAt?: string
    location?: string
    notes?: string
    addToCalendar?: boolean
  }

  if (!body.startsAt) {
    return NextResponse.json(
      { error: 'startsAt (ISO timestamp) required' },
      { status: 400 },
    )
  }
  const start = new Date(body.startsAt)
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json(
      { error: 'startsAt must be a valid ISO timestamp' },
      { status: 400 },
    )
  }
  const end = body.endsAt ? new Date(body.endsAt) : null
  if (end && Number.isNaN(end.getTime())) {
    return NextResponse.json(
      { error: 'endsAt must be a valid ISO timestamp' },
      { status: 400 },
    )
  }

  const { data: existing } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, name, match_intel')
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

  const scheduled = {
    starts_at: start.toISOString(),
    ends_at: (end ?? new Date(start.getTime() + 90 * 60 * 1000)).toISOString(),
    location: body.location ?? null,
    notes: body.notes ?? null,
    status: body.addToCalendar === false ? 'manual' : 'pending_calendar',
    created_at: new Date().toISOString(),
  }

  const { data: updated, error } = await (supabase as any)
    .from('clapcheeks_matches')
    .update({
      stage: 'date_booked',
      status: 'date_booked',
      match_intel: { ...intel, scheduled_date: scheduled },
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
