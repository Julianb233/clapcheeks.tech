import { NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'

/**
 * PATCH /api/matches/[id] — update stage/status/rank and/or merge into
 *                          match_intel JSONB.
 * DELETE /api/matches/[id] — soft-archive (sets status = 'archived').
 *
 * Both require an authenticated Convex session and enforce ownership
 * via the `user_id` column on clapcheeks_matches.
 */

type PatchBody = {
  stage?: unknown
  status?: unknown
  julian_rank?: unknown
  opener_sent_at?: unknown
  name?: unknown
  age?: unknown
  bio?: unknown
  job?: unknown
  school?: unknown
  instagram_handle?: unknown
  zodiac?: unknown
  birth_date?: unknown
  met_at?: unknown
  first_impression?: unknown
  vision_summary?: unknown
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

const STRING_FIELD_LIMITS: Record<string, number> = {
  name: 160,
  bio: 4000,
  job: 240,
  school: 240,
  instagram_handle: 120,
  zodiac: 60,
  birth_date: 20,
  vision_summary: 4000,
}

const INTEL_STRING_FIELD_LIMITS: Record<string, number> = {
  met_at: 240,
  first_impression: 2000,
}

function normalizeStringField(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): { ok: true; value?: string } | { ok: false; error: string } {
  const value = body[key]
  if (value === undefined) return { ok: true }
  if (typeof value !== 'string') {
    return { ok: false, error: `${key} must be a string` }
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      error: `${key} must be ${maxLength} characters or less`,
    }
  }
  if (key === 'birth_date' && trimmed) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return { ok: false, error: 'birth_date must be YYYY-MM-DD' }
    }
    const parsed = new Date(`${trimmed}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'birth_date must be a valid date' }
    }
  }
  return { ok: true, value: trimmed }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const convex = await createClient()
  const {
    data: { user },
  } = await convex.auth.getUser()
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
  const { data: existing, error: fetchErr } = await (convex as any)
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

  if (body.age !== undefined && body.age !== null && body.age !== '') {
    const n = typeof body.age === 'number' ? body.age : Number(body.age)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 18 || n > 100) {
      return NextResponse.json(
        { error: 'age must be an integer 18-100' },
        { status: 400 },
      )
    }
    update.age = n
  }

  for (const key of Object.keys(STRING_FIELD_LIMITS) as Array<keyof typeof STRING_FIELD_LIMITS>) {
    const normalized = normalizeStringField(body as Record<string, unknown>, key, STRING_FIELD_LIMITS[key])
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 })
    }
    if (normalized.value !== undefined) update[key] = normalized.value
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
  }

  const intelPatch: Record<string, unknown> = isPlainObject(body.match_intel_patch)
    ? { ...body.match_intel_patch }
    : {}

  for (const key of Object.keys(INTEL_STRING_FIELD_LIMITS) as Array<keyof typeof INTEL_STRING_FIELD_LIMITS>) {
    const normalized = normalizeStringField(body as Record<string, unknown>, key, INTEL_STRING_FIELD_LIMITS[key])
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 })
    }
    if (normalized.value !== undefined) intelPatch[key] = normalized.value
  }

  if (Object.keys(intelPatch).length > 0) {
    const current: Record<string, unknown> = isPlainObject(existing.match_intel)
      ? (existing.match_intel as Record<string, unknown>)
      : {}
    update.match_intel = { ...current, ...intelPatch }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'no updatable fields provided' },
      { status: 400 },
    )
  }

  const { data: updated, error: updateErr } = await (convex as any)
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
  if (isPlainObject(updated) && updated.status === 'error') {
    return NextResponse.json(
      { error: String(updated.errorMessage ?? 'update failed') },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, match: updated })
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const convex = await createClient()
  const {
    data: { user },
  } = await convex.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'match id required' }, { status: 400 })
  }

  // Ownership check.
  const { data: existing, error: fetchErr } = await (convex as any)
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

  const { data: updated, error: updateErr } = await (convex as any)
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
