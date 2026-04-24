import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Agent heartbeat — local daemon calls every ~60s so the dashboard
 * knows an agent is alive.
 *
 *   POST /api/agent/heartbeat
 *   Headers:
 *     Authorization: Bearer <agent_token>   (primary — what daemon sends)
 *     X-Device-Token: <agent_token>         (alternate — what chrome extension sends)
 *   Body (optional): { device_name, platform, agent_version }
 *
 * Looks up token in clapcheeks_agent_tokens → user_id, then upserts
 * a row in `devices` with last_seen_at = now(). Also bumps
 * clapcheeks_agent_tokens.last_seen_at for fleet-health.
 */

function cors(resp: NextResponse) {
  resp.headers.set('Access-Control-Allow-Origin', '*')
  resp.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Device-Token, X-Device-Name',
  )
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  return resp
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || ''
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''
  const deviceToken = req.headers.get('x-device-token') || bearerToken
  if (!deviceToken) {
    return cors(
      NextResponse.json(
        { error: 'missing token (Authorization: Bearer or X-Device-Token)' },
        { status: 401 },
      ),
    )
  }

  let body: { device_name?: string; platform?: string; agent_version?: string } = {}
  try {
    body = (await req.json()) || {}
  } catch {
    // empty body is fine
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return cors(
      NextResponse.json({ error: 'server_unconfigured' }, { status: 500 }),
    )
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: tokRows, error: lookupErr } = await supabase
    .from('clapcheeks_agent_tokens')
    .select('user_id, device_name')
    .eq('token', deviceToken)
    .limit(1)

  if (lookupErr) {
    return cors(
      NextResponse.json(
        { error: 'lookup_failed', detail: lookupErr.message },
        { status: 500 },
      ),
    )
  }
  const devRow = tokRows?.[0]
  if (!devRow) {
    return cors(
      NextResponse.json({ error: 'invalid_device_token' }, { status: 401 }),
    )
  }

  const now = new Date().toISOString()
  const deviceName =
    body.device_name?.slice(0, 120) ||
    devRow.device_name ||
    req.headers.get('x-device-name')?.slice(0, 120) ||
    'local-agent'
  const platform = body.platform?.slice(0, 40) || 'macos'
  const agentVersion = body.agent_version?.slice(0, 40) || null

  const { data: existing, error: selErr } = await supabase
    .from('devices')
    .select('id')
    .eq('user_id', devRow.user_id)
    .eq('device_name', deviceName)
    .limit(1)

  if (selErr) {
    return cors(
      NextResponse.json(
        { error: 'select_failed', detail: selErr.message },
        { status: 500 },
      ),
    )
  }

  if (existing && existing.length > 0) {
    const { error: updErr } = await supabase
      .from('devices')
      .update({
        last_seen_at: now,
        is_active: true,
        ...(agentVersion ? { agent_version: agentVersion } : {}),
        platform,
      })
      .eq('id', existing[0].id)
    if (updErr) {
      return cors(
        NextResponse.json(
          { error: 'update_failed', detail: updErr.message },
          { status: 500 },
        ),
      )
    }
  } else {
    const { error: insErr } = await supabase.from('devices').insert({
      user_id: devRow.user_id,
      device_name: deviceName,
      platform,
      agent_version: agentVersion,
      last_seen_at: now,
      is_active: true,
    })
    if (insErr) {
      return cors(
        NextResponse.json(
          { error: 'insert_failed', detail: insErr.message },
          { status: 500 },
        ),
      )
    }
  }

  void supabase
    .from('clapcheeks_agent_tokens')
    .update({ last_seen_at: now })
    .eq('token', deviceToken)
    .then(() => null)

  return cors(
    NextResponse.json({ ok: true, device_name: deviceName, last_seen_at: now }),
  )
}
