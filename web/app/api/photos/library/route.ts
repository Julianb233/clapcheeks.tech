import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { nanoid } from 'nanoid'

const MAX_BYTES = 15 * 1024 * 1024 // 15MB per image
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
])

async function signPhoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string
) {
  const { data } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(storagePath, 60 * 60)
  return data?.signedUrl ?? null
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('profile_photos')
    .select('id, storage_path, category, source, source_ref, caption, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const photos = await Promise.all(
    (rows ?? []).map(async (r) => ({
      id: r.id,
      category: r.category,
      source: r.source,
      sourceRef: r.source_ref,
      caption: r.caption,
      createdAt: r.created_at,
      url: await signPhoto(supabase, r.storage_path),
    }))
  )

  return NextResponse.json({ photos })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const category = (form.get('category') as string | null)?.trim() || 'uncategorized'
  const files = form.getAll('files').filter((f): f is File => f instanceof File)

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })
  }

  const uploaded: Array<{ id: string; url: string | null }> = []
  const rejected: Array<{ name: string; reason: string }> = []

  for (const file of files) {
    if (!ALLOWED_MIME.has(file.type)) {
      rejected.push({ name: file.name, reason: `Unsupported type: ${file.type}` })
      continue
    }
    if (file.size > MAX_BYTES) {
      rejected.push({ name: file.name, reason: 'Too large (>15MB)' })
      continue
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const key = `${user.id}/${nanoid(12)}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('profile-photos')
      .upload(key, file, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadErr) {
      rejected.push({ name: file.name, reason: uploadErr.message })
      continue
    }

    const { data: row, error: insertErr } = await supabase
      .from('profile_photos')
      .insert({
        user_id: user.id,
        storage_path: key,
        category,
        source: 'upload',
        bytes: file.size,
        mime_type: file.type,
      })
      .select('id, storage_path, category, source, caption, created_at')
      .single()

    if (insertErr || !row) {
      await supabase.storage.from('profile-photos').remove([key])
      rejected.push({ name: file.name, reason: insertErr?.message || 'DB insert failed' })
      continue
    }

    uploaded.push({
      id: row.id,
      url: await signPhoto(supabase, row.storage_path),
    })
  }

  return NextResponse.json({ uploaded, rejected })
}
