import { NextRequest, NextResponse } from 'next/server'
import { api } from '@/convex/_generated/api'
import { getConvexServerClient } from '@/lib/convex/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/match-profile/add — create a manually-added match profile.
 * GET  /api/match-profile/add — list the current user's match profiles.
 *
 * AI-9534 — match data on Convex; auth on Supabase. Manually-added matches
 * use Convex insertManual (no Supabase counterpart). Everything that doesn't
 * have a dedicated column folds into the `match_intel` JSONB blob so the
 * enrichment route can round-trip arbitrary fields.
 */
type ManualPlatform = 'hinge' | 'tinder' | 'bumble' | 'imessage' | 'offline'
const VALID_PLATFORMS: ReadonlySet<ManualPlatform> = new Set([
  'hinge',
  'tinder',
  'bumble',
  'imessage',
  'offline',
])

function normalizePlatform(p: unknown): ManualPlatform {
  if (typeof p === 'string') {
    const s = p.toLowerCase().trim() as ManualPlatform
    if (VALID_PLATFORMS.has(s)) return s
  }
  return 'offline'
}
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    name,
    platform,
    age,
    birthday,
    ig_handle,
    bio,
    notes,
    quick_tags,
    tag,
  } = body

  if (!name || !platform) {
    return NextResponse.json({ error: 'Name and platform are required' }, { status: 400 })
  }

  // Generate a match_id if not provided
  const match_id: string = body.match_id || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // match_intel JSONB carries everything that doesn't have a column.
  const match_intel: Record<string, unknown> = {
    enrichment_status: 'pending',
    source: 'manual-add',
  }
  if (notes) match_intel.notes = notes
  if (tag) match_intel.tag = tag
  if (Array.isArray(quick_tags) && quick_tags.length > 0) match_intel.quick_tags = quick_tags

  const convex = getConvexServerClient()
  const normalizedPlatform = normalizePlatform(platform)
  const ageNum = age ? parseInt(String(age), 10) : undefined
  const igHandle = ig_handle ? String(ig_handle).replace(/^@/, '') : undefined

  let inserted: { _id: string } | null = null
  try {
    const result = await convex.mutation(api.matches.insertManual, {
      user_id: user.id,
      platform: normalizedPlatform,
      external_match_id: match_id,
      match_id,
      external_id: match_id,
      name,
      match_name: name,
      age: ageNum,
      birth_date: birthday || undefined,
      bio: bio || undefined,
      instagram_handle: igHandle,
      match_intel,
      status: 'new',
    })
    inserted = { _id: result._id as unknown as string }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'insert failed' },
      { status: 500 },
    )
  }

  // Trigger background enrichment (non-blocking)
  if (inserted?._id) {
    fetch(`${request.nextUrl.origin}/api/match-profile/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') || '' },
      body: JSON.stringify({ profile_id: inserted._id }),
    }).catch(() => { /* fire and forget */ })
  }

  // Preserve the previous response shape — callers expect ig_handle, birthday, etc.
  const profile = inserted
    ? {
        id: inserted._id,
        _id: inserted._id,
        user_id: user.id,
        platform: normalizedPlatform,
        match_id,
        external_id: match_id,
        match_name: name,
        name,
        age: ageNum ?? null,
        birth_date: birthday || null,
        birthday: birthday || null,
        bio: bio || null,
        instagram_handle: igHandle ?? null,
        ig_handle: igHandle ?? null,
        match_intel,
        status: 'new',
        enrichment_status:
          (match_intel.enrichment_status as string | undefined) ?? 'pending',
        notes: (match_intel.notes as string | undefined) ?? null,
        quick_tags: (match_intel.quick_tags as string[] | undefined) ?? [],
        tag: (match_intel.tag as string | undefined) ?? null,
      }
    : null

  return NextResponse.json({ profile })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const convex = getConvexServerClient()
  let data: Array<Record<string, unknown> & { _id?: unknown }> = []
  try {
    const rows = (await convex.query(api.matches.listManualByUser, {
      user_id: user.id,
      limit: 200,
    })) as Array<Record<string, unknown>>
    data = (rows ?? []) as Array<Record<string, unknown> & { _id?: unknown }>
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'list failed' },
      { status: 500 },
    )
  }

  const profiles = data.map((row) => {
    const mi = ((row.match_intel as Record<string, unknown> | null) ?? {}) as Record<string, unknown>
    const ii = ((row.instagram_intel as Record<string, unknown> | null) ?? {}) as Record<string, unknown>
    return {
      ...row,
      // mirror the legacy `id` field so consumers expecting `row.id` still work
      id:
        (row.supabase_match_id as string | undefined) ??
        (row._id as string | undefined) ??
        null,
      ig_handle: row.instagram_handle ?? null,
      birthday: row.birth_date ?? null,
      ig_bio: (ii.bio as string | undefined) ?? null,
      ig_follower_count: (ii.follower_count as number | undefined) ?? null,
      ig_following_count: (ii.following_count as number | undefined) ?? null,
      ig_post_count: (ii.post_count as number | undefined) ?? null,
      ig_recent_captions: (ii.recent_captions as string[] | undefined) ?? null,
      ig_scraped_at: row.instagram_fetched_at ?? null,
      interests: (mi.interests as string[] | undefined) ?? [],
      interest_tags: (mi.interest_tags as string[] | undefined) ?? [],
      notes: (mi.notes as string | undefined) ?? null,
      tag: (mi.tag as string | undefined) ?? null,
      quick_tags: (mi.quick_tags as string[] | undefined) ?? [],
      enrichment_status: (mi.enrichment_status as string | undefined) ?? null,
      enrichment_error: (mi.enrichment_error as string | undefined) ?? null,
      enriched_at: (mi.enriched_at as string | undefined) ?? null,
    }
  })

  return NextResponse.json({ profiles })
}
