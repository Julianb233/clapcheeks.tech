import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

/**
 * AI-8876 (Y3) — Attachment send proxy.
 *
 *   POST /api/conversation/[matchId]/attach
 *   Content-Type: multipart/form-data
 *   Fields:
 *     file       — the file to attach (required)
 *     handle     — recipient phone/email E.164 (required)
 *
 * Proxies the file to the user's BlueBubbles server via
 * POST /api/v1/message/attachment.
 *
 * Credentials are fetched from clapcheeks_user_settings:
 *   bluebubbles_url      — base URL of the BlueBubbles server
 *   bluebubbles_password — encrypted password (plaintext fallback for dev)
 *
 * Returns:
 *   200  { ok: true, guid?: string }
 *   400  { error: 'missing_fields' }
 *   401  { error: 'unauthorized' }
 *   422  { error: 'bb_not_configured' }
 *   502  { error: 'bb_error', detail?: string }
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { matchId } = await params

  // Parse multipart form
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(
      { error: 'invalid_form_data' },
      { status: 400 },
    )
  }

  const file = formData.get('file')
  const handle = (formData.get('handle') as string | null)?.trim()

  if (!file || !(file instanceof File) || !handle) {
    return NextResponse.json(
      { error: 'missing_fields', detail: 'file and handle are required' },
      { status: 400 },
    )
  }

  // Fetch BB credentials from user settings (service role to bypass RLS)
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) {
    return NextResponse.json({ error: 'server_unconfigured' }, { status: 500 })
  }

  const service = createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const { data: settings, error: settingsErr } = await service
    .from('clapcheeks_user_settings')
    .select('bluebubbles_url, bluebubbles_password')
    .eq('user_id', user.id)
    .maybeSingle()

  if (settingsErr || !settings?.bluebubbles_url) {
    return NextResponse.json(
      {
        error: 'bb_not_configured',
        detail: 'BlueBubbles server URL not set in user settings',
      },
      { status: 422 },
    )
  }

  const bbBase = (settings.bluebubbles_url as string).replace(/\/$/, '')
  // Password may be stored as plaintext (dev) or AES ciphertext (prod).
  // The daemon handles decryption; for the API proxy we need the plain password.
  // For now we check for BLUEBUBBLES_PASSWORD env override (set in Vercel env)
  // then fall back to the stored value treated as plaintext.
  const bbPassword =
    process.env.BLUEBUBBLES_PASSWORD ??
    (typeof settings.bluebubbles_password === 'string'
      ? settings.bluebubbles_password
      : '')

  // Build the BlueBubbles attachment multipart request
  const bbForm = new FormData()
  bbForm.append('attachment', file, file.name)
  bbForm.append('chatGuid', `iMessage;-;${handle}`)
  bbForm.append('method', 'private-api')

  let bbResp: Response
  try {
    bbResp = await fetch(
      `${bbBase}/api/v1/message/attachment?password=${encodeURIComponent(bbPassword)}`,
      {
        method: 'POST',
        body: bbForm,
      },
    )
  } catch (err) {
    return NextResponse.json(
      {
        error: 'bb_unreachable',
        detail: err instanceof Error ? err.message : 'fetch failed',
      },
      { status: 502 },
    )
  }

  if (!bbResp.ok) {
    let detail = `BB returned HTTP ${bbResp.status}`
    try {
      const body = await bbResp.json()
      detail = JSON.stringify(body)
    } catch {
      // ignore
    }
    return NextResponse.json({ error: 'bb_error', detail }, { status: 502 })
  }

  let bbData: Record<string, unknown> = {}
  try {
    bbData = (await bbResp.json()) as Record<string, unknown>
  } catch {
    // non-JSON BB response — still success
  }

  // AI-9535 — Record the outbound attachment in the queue for audit (Convex).
  void getConvexServerClient()
    .mutation(api.queues.enqueueReply, {
      user_id: user.id,
      match_name: matchId,
      platform: 'imessage',
      text: `[attachment: ${file.name}]`,
      status: 'sent',
    })
    .catch(() => null)

  return NextResponse.json(
    {
      ok: true,
      guid: (bbData?.data as Record<string, unknown> | undefined)?.guid ?? null,
    },
    { status: 200 },
  )
}
