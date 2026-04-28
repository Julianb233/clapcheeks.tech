import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { encryptToken } from '@/lib/crypto/token-vault'

/**
 * Token ingest endpoint used by the Chrome extension.
 *
 *   POST /api/ingest/platform-token
 *   Headers:
 *     X-Device-Token: <token from clapcheeks_agent_tokens>
 *     X-Device-Name:  friendly label (optional)
 *   Body: { platform: "tinder" | "hinge" | "instagram" | "bumble", token: string, storage_key?: string }
 *
 * Validates the device token, encrypts the platform token with the
 * per-user vault, writes ciphertext to the *_enc column on the user's
 * clapcheeks_user_settings row, and bumps last_seen_at on the device
 * token.
 *
 * AI-8766: Plaintext column is no longer written by default. Set
 * MIGRATE_KEEP_PLAINTEXT=true (env) ONLY for a backward-compat window.
 */

const ALLOWED_PLATFORMS = ['tinder', 'hinge', 'instagram', 'bumble'] as const
type Platform = (typeof ALLOWED_PLATFORMS)[number]

// Per-platform mapping from request platform name -> column basenames.
// Most platforms use `<plat>_auth_token{,_enc,_updated_at,_source}`. Bumble
// uses `bumble_session{_enc,_updated_at,_source}` since it stores cookies.
const PLATFORM_COLUMNS: Record<Platform, {
  plaintext: string
  enc: string
  ts: string
  source: string
}> = {
  tinder:    { plaintext: 'tinder_auth_token',    enc: 'tinder_auth_token_enc',    ts: 'tinder_auth_token_updated_at',    source: 'tinder_auth_source' },
  hinge:     { plaintext: 'hinge_auth_token',     enc: 'hinge_auth_token_enc',     ts: 'hinge_auth_token_updated_at',     source: 'hinge_auth_source' },
  instagram: { plaintext: 'instagram_auth_token', enc: 'instagram_auth_token_enc', ts: 'instagram_auth_token_updated_at', source: 'instagram_auth_source' },
  bumble:    { plaintext: 'bumble_session',       enc: 'bumble_session_enc',       ts: 'bumble_session_updated_at',       source: 'bumble_auth_source' },
}

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
  // Instagram and Bumble ship a JSON cookie blob; longer than 40 chars.
  const minLen = platform === 'instagram' || platform === 'bumble' ? 40 : 20
  if (!token || token.length < minLen) {
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

  // Encrypt the platform token before storing. If encryption is misconfigured
  // (missing master key) we surface a 500 rather than silently fall back to
  // plaintext — the whole point of AI-8766 is that plaintext must not exist
  // in new rows.
  const cols = PLATFORM_COLUMNS[platform as Platform]
  let ciphertext: Buffer
  try {
    ciphertext = encryptToken(token, row.user_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return cors(NextResponse.json(
      { error: 'encryption_failed', detail: msg }, { status: 500 }))
  }

  // Send bytea over the REST wire as `\x...` hex. PostgREST decodes this
  // into the bytea column as raw bytes.
  const cipherHex = '\\x' + ciphertext.toString('hex')

  const upsertRow: Record<string, unknown> = {
    user_id: row.user_id,
    [cols.enc]: cipherHex,
    [cols.ts]: new Date().toISOString(),
    [cols.source]: 'chrome-extension',
    token_enc_version: 1,
  }

  // Optional dual-write to plaintext during the migration window. Default
  // OFF — turn on per-deployment with MIGRATE_KEEP_PLAINTEXT=true if a
  // legacy reader still needs it.
  if (process.env.MIGRATE_KEEP_PLAINTEXT === 'true') {
    upsertRow[cols.plaintext] = token
  } else {
    // Belt-and-braces: actively NULL the plaintext column on every write so
    // we don't carry stale plaintext after the migration cutover.
    upsertRow[cols.plaintext] = null
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
    updated_at: upsertRow[cols.ts],
    encrypted: true,
  }))
}
