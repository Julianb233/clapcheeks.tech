/**
 * /api/photos/library/[id]
 *
 * PATCH  — update category (and optionally caption) for a single photo.
 *          Used by the UI "apply suggestion" affordance.
 * DELETE — remove a photo (row + storage object).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PHOTO_BUCKET, isPhotoCategory } from '@/lib/photo-ai'

export const dynamic = 'force-dynamic'

interface PatchBody {
  category?: unknown
  caption?: unknown
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.category === 'string') {
    if (!isPhotoCategory(body.category)) {
      return NextResponse.json(
        { error: `Invalid category: ${body.category}` },
        { status: 400 }
      )
    }
    updates.category = body.category
  }
  if (typeof body.caption === 'string') {
    updates.caption = body.caption
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('profile_photos')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(
      'id, user_id, storage_path, category, source, source_ref, caption, width, height, bytes, mime_type, created_at, updated_at, ai_score, ai_score_reason, ai_category_suggested, ai_categorized_at'
    )
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ photo: data })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: row, error: fetchErr } = await supabase
    .from('profile_photos')
    .select('id, storage_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error: delErr } = await supabase
    .from('profile_photos')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  const admin = createAdminClient()
  await admin.storage
    .from(PHOTO_BUCKET)
    .remove([(row as { storage_path: string }).storage_path])
    .catch(() => undefined)

  return NextResponse.json({ ok: true })
}
