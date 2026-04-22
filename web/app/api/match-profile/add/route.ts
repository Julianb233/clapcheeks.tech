import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/match-profile/add — create a manually-added match profile.
 * GET  /api/match-profile/add — list the current user's match profiles.
 *
 * This route writes/reads the real `clapcheeks_matches` table (see
 * supabase/migrations/20260420000002_matches_intel_fields.sql). Everything
 * that doesn't have a dedicated column folds into the `match_intel` JSONB
 * blob so enrichment / UI can round-trip arbitrary fields.
 */
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

  const nowIso = new Date().toISOString()
  const insertRow: Record<string, unknown> = {
    user_id: user.id,
    platform,
    match_id,
    external_id: match_id,
    match_name: name,
    name,
    age: age ? parseInt(String(age), 10) : null,
    birth_date: birthday || null,
    bio: bio || null,
    instagram_handle: ig_handle ? String(ig_handle).replace(/^@/, '') : null,
    match_intel,
    status: 'new',
    created_at: nowIso,
    updated_at: nowIso,
  }

  const { data, error } = await (supabase as any)
    .from('clapcheeks_matches')
    .insert(insertRow)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Trigger background enrichment (non-blocking)
  if (data?.id) {
    fetch(`${request.nextUrl.origin}/api/match-profile/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') || '' },
      body: JSON.stringify({ profile_id: data.id }),
    }).catch(() => { /* fire and forget */ })
  }

  // Preserve the previous response shape — callers expect ig_handle, birthday, etc.
  const profile = data
    ? {
        ...data,
        ig_handle: data.instagram_handle,
        birthday: data.birth_date,
        enrichment_status: (data.match_intel as Record<string, unknown> | null)?.enrichment_status ?? 'pending',
        notes: (data.match_intel as Record<string, unknown> | null)?.notes ?? null,
        quick_tags: (data.match_intel as Record<string, unknown> | null)?.quick_tags ?? [],
        tag: (data.match_intel as Record<string, unknown> | null)?.tag ?? null,
      }
    : null

  return NextResponse.json({ profile })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('clapcheeks_matches')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Map DB rows back to the response shape the existing frontend expects.
  const profiles = (data ?? []).map((row: any) => {
    const mi = (row.match_intel ?? {}) as Record<string, unknown>
    const ii = (row.instagram_intel ?? {}) as Record<string, unknown>
    return {
      ...row,
      ig_handle: row.instagram_handle,
      birthday: row.birth_date,
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
