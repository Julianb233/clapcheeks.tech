/**
 * /api/photos/library
 *
 * POST  — upload a photo (multipart/form-data) into Supabase Storage, insert
 *         a profile_photos row, fire-and-forget Claude Vision categorization.
 *
 * GET   — list the caller's photos including AI score / suggestion fields.
 *
 * Companion route for a single photo lives at ./[id]/route.ts (PATCH for
 * category changes / accept-suggestion, DELETE for removal).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PHOTO_BUCKET,
  PHOTO_CATEGORIES,
  isPhotoCategory,
  scheduleCategorization,
} from '@/lib/photo-ai'

export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024 // 12MB
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

interface PhotoRow {
  id: string
  user_id: string
  storage_path: string
  category: string
  source: string | null
  source_ref: string | null
  caption: string | null
  width: number | null
  height: number | null
  bytes: number | null
  mime_type: string | null
  created_at: string
  updated_at: string
  ai_score: number | null
  ai_score_reason: string | null
  ai_category_suggested: string | null
  ai_categorized_at: string | null
}

interface PhotoResponseShape {
  id: string
  userId: string
  storagePath: string
  category: string
  source: string | null
  sourceRef: string | null
  caption: string | null
  width: number | null
  height: number | null
  bytes: number | null
  mimeType: string | null
  createdAt: string
  updatedAt: string
  aiScore: number | null
  aiScoreReason: string | null
  aiCategorySuggested: string | null
  aiCategorizedAt: string | null
  signedUrl: string | null
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'jpg'
  }
}

async function buildPhotoResponse(
  admin: ReturnType<typeof createAdminClient>,
  row: PhotoRow
): Promise<PhotoResponseShape> {
  let signedUrl: string | null = null
  try {
    const { data } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(row.storage_path, 60 * 60)
    signedUrl = data?.signedUrl ?? null
  } catch {
    signedUrl = null
  }

  return {
    id: row.id,
    userId: row.user_id,
    storagePath: row.storage_path,
    category: row.category,
    source: row.source,
    sourceRef: row.source_ref,
    caption: row.caption,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    aiScore: row.ai_score,
    aiScoreReason: row.ai_score_reason,
    aiCategorySuggested: row.ai_category_suggested,
    aiCategorizedAt: row.ai_categorized_at,
    signedUrl,
  }
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('profile_photos')
    .select(
      'id, user_id, storage_path, category, source, source_ref, caption, width, height, bytes, mime_type, created_at, updated_at, ai_score, ai_score_reason, ai_category_suggested, ai_categorized_at'
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const admin = createAdminClient()
  const photos = await Promise.all(
    (data as PhotoRow[]).map((row) => buildPhotoResponse(admin, row))
  )

  return NextResponse.json({ photos })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data' },
      { status: 400 }
    )
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 })
  }

  const mime = (file.type || '').toLowerCase()
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: `Unsupported mime type: ${file.type}` },
      { status: 415 }
    )
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large: ${file.size} bytes (max ${MAX_UPLOAD_BYTES})` },
      { status: 413 }
    )
  }

  const rawCategory = form.get('category')
  const categoryStr =
    typeof rawCategory === 'string' && isPhotoCategory(rawCategory)
      ? rawCategory
      : 'uncategorized'

  const rawSource = form.get('source')
  const source = typeof rawSource === 'string' ? rawSource : null

  const rawSourceRef = form.get('source_ref')
  const sourceRef = typeof rawSourceRef === 'string' ? rawSourceRef : null

  const rawCaption = form.get('caption')
  const caption = typeof rawCaption === 'string' ? rawCaption : null

  const rawWidth = form.get('width')
  const width = typeof rawWidth === 'string' && rawWidth.length ? Number(rawWidth) : null
  const rawHeight = form.get('height')
  const height = typeof rawHeight === 'string' && rawHeight.length ? Number(rawHeight) : null

  const admin = createAdminClient()
  const ext = extForMime(mime)
  const storagePath = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`

  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: uploadErr } = await admin.storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mime,
      upsert: false,
    })

  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 }
    )
  }

  const { data: inserted, error: insertErr } = await admin
    .from('profile_photos')
    .insert({
      user_id: user.id,
      storage_path: storagePath,
      category: categoryStr,
      source,
      source_ref: sourceRef,
      caption,
      width: Number.isFinite(width as number) ? width : null,
      height: Number.isFinite(height as number) ? height : null,
      bytes: file.size,
      mime_type: mime,
    })
    .select(
      'id, user_id, storage_path, category, source, source_ref, caption, width, height, bytes, mime_type, created_at, updated_at, ai_score, ai_score_reason, ai_category_suggested, ai_categorized_at'
    )
    .single()

  if (insertErr || !inserted) {
    // Clean up the orphaned object so we don't leak storage on insert failures.
    await admin.storage.from(PHOTO_BUCKET).remove([storagePath]).catch(() => undefined)
    return NextResponse.json(
      { error: `DB insert failed: ${insertErr?.message || 'unknown'}` },
      { status: 500 }
    )
  }

  // Fire-and-forget AI scoring. Never blocks the upload response; errors
  // are logged inside the helper so Claude outages can't break uploads.
  if (process.env.ANTHROPIC_API_KEY) {
    scheduleCategorization(user.id, inserted.id as string)
  }

  const photo = await buildPhotoResponse(admin, inserted as PhotoRow)
  return NextResponse.json({ photo, categories: PHOTO_CATEGORIES }, { status: 201 })
}
