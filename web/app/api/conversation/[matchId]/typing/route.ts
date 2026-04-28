import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * AI-8876 (Y7) — Outbound typing indicator proxy.
 *
 *   POST /api/conversation/[matchId]/typing
 *   Body: { handle: string, stopped?: boolean }
 *
 * Proxies a "start typing" or "stop typing" signal to the user's
 * BlueBubbles server via:
 *   POST /api/v1/chat/:chatGuid/typing           (start)
 *   DELETE /api/v1/chat/:chatGuid/typing         (stop)
 *
 * The UI calls this debounced while the user types (200ms debounce),
 * and stops on send or 5s idle.
 *
 * Returns:
 *   200  { ok: true }
 *   400  { error: 'missing_handle' }
 *   401  { error: 'unauthorized' }
 *   422  { error: 'bb_not_configured' }
 *   502  { error: 'bb_error' }
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

  await params // consume params (matchId available if needed for future use)

  let body: { handle?: string; stopped?: boolean } = {}
  try {
    body = (await request.json()) as { handle?: string; stopped?: boolean }
  } catch {
    // empty body
  }

  const handle = body.handle?.trim()
  if (!handle) {
    return NextResponse.json({ error: 'missing_handle' }, { status: 400 })
  }

  // Fetch BB credentials
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) {
    return NextResponse.json({ error: 'server_unconfigured' }, { status: 500 })
  }

  const service = createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const { data: settings } = await service
    .from('clapcheeks_user_settings')
    .select('bluebubbles_url, bluebubbles_password')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings?.bluebubbles_url) {
    // BB not configured — silently succeed so the UI isn't blocked
    return NextResponse.json({ ok: true, skipped: true }, { status: 200 })
  }

  const bbBase = (settings.bluebubbles_url as string).replace(/\/$/, '')
  const bbPassword =
    process.env.BLUEBUBBLES_PASSWORD ??
    (typeof settings.bluebubbles_password === 'string'
      ? settings.bluebubbles_password
      : '')

  const chatGuid = encodeURIComponent(`iMessage;-;${handle}`)
  const method = body.stopped ? 'DELETE' : 'POST'

  try {
    await fetch(
      `${bbBase}/api/v1/chat/${chatGuid}/typing?password=${encodeURIComponent(bbPassword)}`,
      { method },
    )
  } catch {
    // Best-effort: typing indicators are not critical; never block the UI
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
