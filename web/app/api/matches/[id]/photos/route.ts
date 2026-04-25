import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/matches/[id]/photos  (multipart/form-data with 1+ "file" parts)
 *   Uploads images to the `profile-photos` bucket under
 *   `<user_id>/<match_id>/<timestamp>-<n>.<ext>` and appends to
 *   clapcheeks_matches.photos_jsonb.
 *
 * DELETE /api/matches/[id]/photos?url=<encoded>
 *   Removes the photo by URL from photos_jsonb (and the storage object if
 *   it was uploaded by us).
 */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
const MAX_BYTES = 10 * 1024 * 1024 // 10MB

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

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, photos_jsonb')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!match) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  const form = await req.formData()
  const files = form.getAll('file').filter((v): v is File => v instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'no files supplied' }, { status: 400 })
  }

  const existing = Array.isArray(match.photos_jsonb)
    ? (match.photos_jsonb as Array<{ url: string; supabase_path?: string }>)
    : []
  const uploaded: Array<{ url: string; supabase_path: string }> = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `unsupported type: ${file.type}` },
        { status: 400 },
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `file too large: ${file.name} (${file.size} bytes)` },
        { status: 400 },
      )
    }
    const ext =
      file.type === 'image/jpeg'
        ? 'jpg'
        : file.type === 'image/png'
          ? 'png'
          : file.type === 'image/webp'
            ? 'webp'
            : 'heic'
    const ts = Date.now()
    const path = `${user.id}/${id}/${ts}-${i}.${ext}`
    const buf = await file.arrayBuffer()
    const { error: uErr } = await supabase.storage
      .from('profile-photos')
      .upload(path, buf, { contentType: file.type, upsert: false })
    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 })
    }
    const { data: pub } = supabase.storage.from('profile-photos').getPublicUrl(path)
    uploaded.push({ url: pub.publicUrl, supabase_path: path })
  }

  const newPhotos = [...existing, ...uploaded]
  const { error: pErr } = await (supabase as any)
    .from('clapcheeks_matches')
    .update({ photos_jsonb: newPhotos })
    .eq('id', id)
    .eq('user_id', user.id)

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, photos: newPhotos, added: uploaded.length })
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
  const url = new URL(req.url).searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'url query param required' }, { status: 400 })
  }

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('photos_jsonb')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!match) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  const photos = Array.isArray(match.photos_jsonb)
    ? (match.photos_jsonb as Array<{ url: string; supabase_path?: string }>)
    : []
  const target = photos.find((p) => p.url === url)
  const remaining = photos.filter((p) => p.url !== url)

  if (target?.supabase_path) {
    await supabase.storage.from('profile-photos').remove([target.supabase_path])
  }

  await (supabase as any)
    .from('clapcheeks_matches')
    .update({ photos_jsonb: remaining })
    .eq('id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true, photos: remaining })
}
