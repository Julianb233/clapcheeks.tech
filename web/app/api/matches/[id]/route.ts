import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/matches/[id] — update stage/status/rank and/or merge into
 *                          match_intel JSONB.
 * DELETE /api/matches/[id] — soft-archive (sets status = 'archived').
 *
 * Both require an authenticated Supabase session and enforce ownership
 * via the `user_id` column on clapcheeks_matches.
 */

type PatchBody = {
  stage?: unknown
  status?: unknown
  julian_rank?: unknown
  opener_sent_at?: unknown
  match_intel_patch?: unknown
}

const ALLOWED_STAGES = new Set([
  'new',
  'chatting',
  'date_planned',
  'dated',
  'dormant',
  'archived',
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export async function PATCH(
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

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Load the row first so we can verify ownership and read-modify-write the
  // match_intel JSONB.
  const { data: existing, error: fetchErr } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, match_intel')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json(
      { error: fetchErr.message ?? 'fetch failed' },
      { status: 500 },
    )
  }
  if (!existing) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Build the whitelisted update payload.
  const update: Record<string, unknown> = {}

  if (typeof body.stage === 'string') {
    const s = body.stage.trim().toLowerCase()
    // The column is freeform text; we only gently validate against the known
    // vocabulary. Unknown stages are rejected so the UI can't stuff garbage in.
    if (!ALLOWED_STAGES.has(s)) {
      return NextResponse.json(
        {
          error: `stage must be one of: ${Array.from(ALLOWED_STAGES).join(', ')}`,
        },
        { status: 400 },
      )
    }
    update.stage = s
  }

  if (typeof body.status === 'string') {
    update.status = body.status.trim()
  }

  if (body.julian_rank !== undefined && body.julian_rank !== null) {
    const n =
      typeof body.julian_rank === 'number'
        ? body.julian_rank
        : Number(body.julian_rank)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10) {
      return NextResponse.json(
        { error: 'julian_rank must be an integer 0-10' },
        { status: 400 },
      )
    }
    update.julian_rank = n
  }

  if (typeof body.opener_sent_at === 'string') {
    const parsed = new Date(body.opener_sent_at)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'opener_sent_at must be an ISO timestamp' },
        { status: 400 },
      )
    }
    update.opener_sent_at = parsed.toISOString()
  }

  if (body.match_intel_patch !== undefined) {
    if (!isPlainObject(body.match_intel_patch)) {
      return NextResponse.json(
        { error: 'match_intel_patch must be an object' },
        { status: 400 },
      )
    }
    const current: Record<string, unknown> = isPlainObject(existing.match_intel)
      ? (existing.match_intel as Record<string, unknown>)
      : {}
    update.match_intel = { ...current, ...body.match_intel_patch }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'no updatable fields provided' },
      { status: 400 },
    )
  }

  const { data: updated, error: updateErr } = await (supabase as any)
    .from('clapcheeks_matches')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message ?? 'update failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, match: updated })
}

export async function DELETE(
  _req: Request,
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

  // Ownership check.
  const { data: existing, error: fetchErr } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json(
      { error: fetchErr.message ?? 'fetch failed' },
      { status: 500 },
    )
  }
  if (!existing) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: updated, error: updateErr } = await (supabase as any)
    .from('clapcheeks_matches')
    .update({ status: 'archived' })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message ?? 'archive failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, match: updated })
}
