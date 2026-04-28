import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * AI-8876 — Daemon heartbeat endpoint.
 *
 * The clapcheeks daemon on Julian's Mac POSTs to this endpoint every minute
 * to report liveness, version, and last sync time.
 *
 *   POST /api/agent/heartbeat
 *   Headers:
 *     Authorization: Bearer <token from clapcheeks_agent_tokens>
 *   Body: {
 *     device_id?:     string   // device_name alias
 *     daemon_version?: string
 *     last_sync_at?:  string   // ISO timestamp
 *     errors_jsonb?:  object   // recent error log
 *   }
 *
 * Returns:
 *   200  { ok: true, server_time: string }
 *   401  { error: 'invalid_token' }
 *   404  { error: 'device_not_found' }
 *   500  { error: 'server_error' }
 *
 * Auth: Bearer token from clapcheeks_agent_tokens.token
 *   Tokens are resolved by device_name. On success, last_seen_at is bumped.
 *   Heartbeat metadata is stored in clapcheeks_device_heartbeats (upserted by
 *   token.id so historical heartbeats can be queried).
 */

function cors(resp: NextResponse) {
  resp.headers.set('Access-Control-Allow-Origin', '*')
  resp.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization',
  )
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  return resp
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : ''

  if (!token) {
    return cors(
      NextResponse.json({ error: 'missing_authorization' }, { status: 401 }),
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return cors(
      NextResponse.json({ error: 'server_unconfigured' }, { status: 500 }),
    )
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // Resolve token → device row
  const { data: tokenRows, error: lookupErr } = await supabase
    .from('clapcheeks_agent_tokens')
    .select('id, user_id, device_name')
    .eq('token', token)
    .limit(1)

  if (lookupErr) {
    return cors(
      NextResponse.json(
        { error: 'server_error', detail: lookupErr.message },
        { status: 500 },
      ),
    )
  }

  const tokenRow = tokenRows?.[0]
  if (!tokenRow) {
    // 404 when no matching token row (as per spec for no-device-found)
    return cors(
      NextResponse.json({ error: 'device_not_found' }, { status: 404 }),
    )
  }

  // Parse body (best-effort; all fields optional)
  let body: {
    device_id?: string
    daemon_version?: string
    last_sync_at?: string
    errors_jsonb?: unknown
  } = {}
  try {
    body = (await req.json()) || {}
  } catch {
    // empty / non-JSON body is fine
  }

  const serverTime = new Date().toISOString()

  // Bump last_seen_at on the token row
  void supabase
    .from('clapcheeks_agent_tokens')
    .update({ last_seen_at: serverTime })
    .eq('id', tokenRow.id)
    .then(() => null)

  // Upsert heartbeat record in clapcheeks_device_heartbeats
  void supabase
    .from('clapcheeks_device_heartbeats')
    .upsert(
      {
        token_id: tokenRow.id,
        user_id: tokenRow.user_id,
        device_name: body.device_id ?? tokenRow.device_name,
        daemon_version: body.daemon_version ?? null,
        last_sync_at: body.last_sync_at ?? null,
        errors_jsonb: body.errors_jsonb ?? null,
        last_heartbeat_at: serverTime,
      },
      { onConflict: 'token_id' },
    )
    .then(() => null)

  return cors(
    NextResponse.json({ ok: true, server_time: serverTime }, { status: 200 }),
  )
}
