/**
 * POST /api/photos/categorize
 *
 * Body: { photoId: string } | { photoIds: string[] }
 *
 * Calls Claude Vision on each photo, writes ai_score / ai_score_reason /
 * ai_category_suggested / ai_categorized_at. Does NOT overwrite `category`
 * (that stays user-controlled; the UI offers a one-click apply).
 *
 * Caller must be authenticated. Only photos the caller owns get analyzed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { categorizePhotos } from '@/lib/photo-ai'

export const dynamic = 'force-dynamic'
// Vision calls can be slow; give them room on Vercel.
export const maxDuration = 300

interface RequestBody {
  photoId?: unknown
  photoIds?: unknown
}

function normalizeIds(body: RequestBody): string[] | null {
  const ids: string[] = []
  if (Array.isArray(body.photoIds)) {
    for (const id of body.photoIds) {
      if (typeof id === 'string' && id.length > 0) ids.push(id)
    }
  }
  if (typeof body.photoId === 'string' && body.photoId.length > 0) {
    ids.push(body.photoId)
  }
  const deduped = Array.from(new Set(ids))
  if (!deduped.length) return null
  // Safety cap so we don't melt on a "rescore all" click against 500 photos.
  return deduped.slice(0, 100)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const ids = normalizeIds(body)
  if (!ids) {
    return NextResponse.json(
      { error: 'photoId or photoIds required' },
      { status: 400 }
    )
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 503 }
    )
  }

  // Ownership gate. Any id not owned by this user is silently dropped so
  // we don't leak existence of other users' rows.
  const { data: ownedRows, error: ownErr } = await supabase
    .from('profile_photos')
    .select('id')
    .eq('user_id', user.id)
    .in('id', ids)

  if (ownErr) {
    return NextResponse.json(
      { error: `Failed to verify photos: ${ownErr.message}` },
      { status: 500 }
    )
  }

  const ownedIds = (ownedRows || []).map((r) => r.id as string)
  if (!ownedIds.length) {
    return NextResponse.json({ results: [] })
  }

  try {
    const results = await categorizePhotos(user.id, ownedIds)
    return NextResponse.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'categorization_failed'
    console.error('[api/photos/categorize] error', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
