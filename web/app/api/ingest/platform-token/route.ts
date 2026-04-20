import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Token ingest endpoint used by the Chrome extension.
 *
 *   POST /api/ingest/platform-token
 *   Headers:
 *     X-Device-Token: <token from clapcheeks_agent_tokens>
 *     X-Device-Name:  friendly label (optional)
 *   Body: { platform: "tinder" | "hinge", token: string, storage_key?: string }
 *
 * Validates the device token, writes the platform token to the owning
 * user's clapcheeks_user_settings row, and bumps last_seen_at on the
 * device token.
 */

const ALLOWED_PLATFORMS = ['tinder', 'hinge'] as const
type Platform = (typeof ALLOWED_PLATFORMS)[number]

function cors(resp: NextResponse) {
  resp.headers.set('Access-Control-Allow-Origin', '*')
  resp.headers.set('Access-Control-Allow-Headers',
    'Content-Type, X-Device-Token, X-Device-Name')
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  return resp
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

export async function POST(req: Request) {
  const deviceToken = req.headers.get('x-device-token') || ''
  const deviceName = req.headers.get('x-device-name') || ''
  if (!deviceToken) {
    return cors(NextResponse.json(
      { error: 'missing X-Device-Token' }, { status: 401 }))
  }

  let body: { platform?: string; token?: string; storage_key?: string; at?: number }
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json({ error: 'invalid_json' }, { status: 400 }))
  }

  const platform = (body.platform || '').toLowerCase()
  const token = (body.token || '').trim()
  if (!ALLOWED_PLATFORMS.includes(platform as Platform)) {
    return cors(NextResponse.json({ error: 'bad_platform' }, { status: 400 }))
  }
  if (!token || token.length < 20) {
    return cors(NextResponse.json({ error: 'token_too_short' }, { status: 400 }))
  }

  // Service-role client — we look up the device token and scope the write
  // to its owning user_id. The extension itself holds only the opaque
  // device token, never a Supabase key.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return cors(NextResponse.json(
      { error: 'server_unconfigured' }, { status: 500 }))
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: rows, error: lookupErr } = await supabase
    .from('clapcheeks_agent_tokens')
    .select('user_id, device_name')
    .eq('token', deviceToken)
    .limit(1)

  if (lookupErr) {
    return cors(NextResponse.json(
      { error: 'lookup_failed', detail: lookupErr.message }, { status: 500 }))
  }
  const row = rows?.[0]
  if (!row) {
    return cors(NextResponse.json(
      { error: 'invalid_device_token' }, { status: 401 }))
  }

  // Bump last_seen_at + optionally update device_name if caller set one
  void supabase
    .from('clapcheeks_agent_tokens')
    .update({
      last_seen_at: new Date().toISOString(),
      ...(deviceName ? { device_name: deviceName } : {}),
    })
    .eq('token', deviceToken)
    .then(() => null)

  // Upsert the platform token onto the user's settings row
  const tokenField = `${platform}_auth_token`
  const tsField = `${platform}_auth_token_updated_at`
  const sourceField = `${platform}_auth_source`

  const upsertRow: Record<string, unknown> = {
    user_id: row.user_id,
    [tokenField]: token,
    [tsField]: new Date().toISOString(),
    [sourceField]: 'chrome-extension',
  }

  const { error: upsertErr } = await supabase
    .from('clapcheeks_user_settings')
    .upsert(upsertRow, { onConflict: 'user_id' })

  if (upsertErr) {
    return cors(NextResponse.json(
      { error: 'write_failed', detail: upsertErr.message }, { status: 500 }))
  }

  return cors(NextResponse.json({
    ok: true,
    platform,
    device_name: deviceName || row.device_name,
    updated_at: upsertRow[tsField],
  }))
}
