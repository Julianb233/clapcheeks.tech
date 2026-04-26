import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/matches/[id] — update stage/status/rank and/or merge into
 *                          match_intel JSONB.
 * DELETE /api/matches/[id] — soft-archive by default (stage='archived',
 *                          status='ghosted') so the user gets an undo
 *                          window. Pass `?hard=1` to hard-delete the row
 *                          (and the linked conversation by match_id).
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

// Must match the DB CHECK constraint on clapcheeks_matches.stage.
// Origin: migration 20260420300000_match_profiles.sql + 20260421...phase_j_roster.sql.
const ALLOWED_STAGES = new Set([
  'new_match',
  'chatting',
  'chatting_phone',
  'date_proposed',
  'date_booked',
  'date_attended',
  'hooked_up',
  'recurring',
  'faded',
  'ghosted',
  'archived',
  'archived_cluster_dupe',
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
    const s = body.stage.trim()
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

  const hard = new URL(req.url).searchParams.get('hard') === '1'

  const { data: existing, error: fetchErr } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, name, match_id, platform, stage, status')
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

  if (!hard) {
    // Soft-delete: archive in place so /api/matches/[id]/restore can undo.
    const { data: updated, error: updateErr } = await (supabase as any)
      .from('clapcheeks_matches')
      .update({
        stage: 'archived',
        status: 'ghosted',
      })
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
    return NextResponse.json({
      ok: true,
      mode: 'soft',
      removed: existing.name,
      previousStage: existing.stage,
      previousStatus: existing.status,
      match: updated,
    })
  }

  // Hard delete: also clean up the related conversation row(s) keyed by
  // match_id (platform-native key), since clapcheeks_conversations does not
  // FK-cascade on the matches uuid.
  await (supabase as any)
    .from('clapcheeks_conversations')
    .delete()
    .eq('user_id', user.id)
    .eq('match_id', existing.match_id)

  const { error: deleteErr } = await (supabase as any)
    .from('clapcheeks_matches')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (deleteErr) {
    return NextResponse.json(
      { error: deleteErr.message ?? 'delete failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, mode: 'hard', removed: existing.name })
}
