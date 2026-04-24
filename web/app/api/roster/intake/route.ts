import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ingestScreenshot } from '@/lib/elite-intake'
import type { MatchSource } from '@/lib/matches/types'

/**
 * POST /api/roster/intake — screenshot → Elite roster.
 *
 * Accepts either multipart/form-data with an `image` file (web upload) OR
 * application/json with `{ image_b64, mime, source, source_message, source_handle }`
 * (iMessage + email entry points call this route server-side).
 *
 * Response: { match_id, extracted, merged, screenshot_path }
 */

export const runtime = 'nodejs'
export const maxDuration = 60
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = req.headers.get('content-type') || ''
  let imageBytes: Buffer
  let mime: string
  let source: MatchSource = 'screenshot-web'
  let sourceMessage: string | undefined
  let sourceHandle: string | undefined

  try {
    if (contentType.startsWith('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('image')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'image file required' }, { status: 400 })
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: `image too large (>${MAX_BYTES} bytes)` }, { status: 413 })
      }
      imageBytes = Buffer.from(await file.arrayBuffer())
      mime = file.type || 'image/jpeg'
      const formSource = form.get('source')
      if (typeof formSource === 'string') source = formSource as MatchSource
    } else {
      const body = await req.json()
      if (!body.image_b64 || !body.mime) {
        return NextResponse.json({ error: 'image_b64 + mime required' }, { status: 400 })
      }
      imageBytes = Buffer.from(body.image_b64, 'base64')
      if (imageBytes.length > MAX_BYTES) {
        return NextResponse.json({ error: 'image too large' }, { status: 413 })
      }
      mime = body.mime
      if (body.source) source = body.source as MatchSource
      sourceMessage = body.source_message
      sourceHandle = body.source_handle
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid request body', detail: (err as Error).message },
      { status: 400 },
    )
  }

  try {
    const result = await ingestScreenshot({
      userId: user.id,
      imageBytes,
      imageMime: mime,
      source,
      sourceMessage,
      sourceHandle,
    })
    return NextResponse.json({
      match_id: result.matchId,
      extracted: result.extracted,
      merged: result.merged,
      screenshot_path: result.storagePath,
    })
  } catch (err) {
    console.error('roster/intake failed', err)
    return NextResponse.json(
      { error: 'intake failed', detail: (err as Error).message },
      { status: 500 },
    )
  }
}
