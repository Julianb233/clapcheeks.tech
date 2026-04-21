import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Phase L (AI-8340) - fire a library item as an IG story immediately.
 *
 *   POST /api/content-library/post-now
 *   body: { content_library_id: string }
 *
 * The route enqueues an `ig_post_story` agent_job for the user's
 * Chrome extension to drain. Returns { ok, job_id, reason }.
 */

const IG_STORY_UPLOAD_URL =
  'https://i.instagram.com/api/v1/media/configure_to_story/'

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { content_library_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // ignore
  }
  const libId = body.content_library_id
  if (!libId) {
    return NextResponse.json(
      { error: 'missing content_library_id' },
      { status: 400 },
    )
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: 'server_unconfigured' }, { status: 500 })
  }
  const admin = createAdminClient()

  // Load the library row.
  const { data: libRows, error: libErr } = await admin
    .from('clapcheeks_content_library')
    .select('id, media_path, caption, post_type, user_id')
    .eq('id', libId)
    .eq('user_id', user.id)
    .limit(1)

  if (libErr) {
    return NextResponse.json(
      { error: 'db_error', detail: libErr.message },
      { status: 500 },
    )
  }
  const lib = libRows?.[0]
  if (!lib) {
    return NextResponse.json(
      { ok: false, reason: 'missing_row' },
      { status: 404 },
    )
  }

  // IG session check.
  const { data: settings } = await admin
    .from('clapcheeks_user_settings')
    .select('instagram_auth_token')
    .eq('user_id', user.id)
    .limit(1)
  const session = settings?.[0]?.instagram_auth_token
  let parsedSession: any = session
  if (typeof session === 'string') {
    try {
      parsedSession = JSON.parse(session)
    } catch {
      parsedSession = null
    }
  }
  if (!parsedSession || !parsedSession.sessionid) {
    return NextResponse.json({
      ok: false,
      reason: 'no_session',
      hint: 'Open instagram.com in Chrome so the harvester can grab fresh cookies.',
    })
  }

  // Signed URL the extension will download from.
  const { data: signed } = await admin.storage
    .from('julian-content')
    .createSignedUrl(lib.media_path, 3600)
  if (!signed?.signedUrl) {
    return NextResponse.json({
      ok: false,
      reason: 'signed_url_failed',
    })
  }

  // Enqueue the agent job.
  const { data: inserted, error: insErr } = await admin
    .from('clapcheeks_agent_jobs')
    .insert({
      user_id: user.id,
      job_type: 'ig_post_story',
      platform: 'instagram',
      priority: 3,
      status: 'pending',
      job_params: {
        url: IG_STORY_UPLOAD_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          image_url: signed.signedUrl,
          caption: lib.caption || '',
          post_type: lib.post_type || 'story',
        },
      },
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    return NextResponse.json(
      { ok: false, reason: 'enqueue_failed', detail: insErr?.message },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    job_id: inserted.id,
    reason: 'enqueued',
  })
}
