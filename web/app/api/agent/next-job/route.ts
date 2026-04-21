import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Phase M (AI-8345) - claim the oldest pending agent job for this
 * extension's user.
 *
 *   POST /api/agent/next-job
 *   Headers:
 *     X-Device-Token: <token from clapcheeks_agent_tokens>
 *     X-Device-Name:  friendly label (optional)
 *   Body: { claimed_by?: string }
 *
 * Returns 204 when no work; 200 with the job row when one is claimed.
 *
 * Atomic claim strategy: SELECT one pending row for the owning user,
 * then UPDATE ... WHERE id = $1 AND status = 'pending' so only one
 * caller wins even if two Chromes race.
 */

function cors(resp: NextResponse) {
  resp.headers.set('Access-Control-Allow-Origin', '*')
  resp.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Device-Token, X-Device-Name',
  )
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
    return cors(
      NextResponse.json({ error: 'missing X-Device-Token' }, { status: 401 }),
    )
  }

  let body: { claimed_by?: string } = {}
  try {
    body = (await req.json()) || {}
  } catch {
    // empty body is fine
  }
  const claimedBy = (body.claimed_by || deviceName || 'chrome-ext').slice(0, 120)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return cors(
      NextResponse.json({ error: 'server_unconfigured' }, { status: 500 }),
    )
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // Device-token -> user_id
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

  // Bump last_seen_at so fleet-health can tell the extension is alive.
  void supabase
    .from('clapcheeks_agent_tokens')
    .update({
      last_seen_at: new Date().toISOString(),
      ...(deviceName ? { device_name: deviceName } : {}),
    })
    .eq('token', deviceToken)
    .then(() => null)

  // Find the oldest pending job for this user.
  const { data: candidates, error: selErr } = await supabase
    .from('clapcheeks_agent_jobs')
    .select('id, user_id, job_type, platform, job_params, created_at')
    .eq('user_id', devRow.user_id)
    .eq('status', 'pending')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)

  if (selErr) {
    return cors(
      NextResponse.json(
        { error: 'select_failed', detail: selErr.message },
        { status: 500 },
      ),
    )
  }
  if (!candidates || candidates.length === 0) {
    return cors(new NextResponse(null, { status: 204 }))
  }

  const row = candidates[0]

  // Atomic-ish claim: only transitions pending -> claimed; if another
  // extension beat us, 0 rows come back and we return 204.
  const { data: claimed, error: updErr } = await supabase
    .from('clapcheeks_agent_jobs')
    .update({
      status: 'claimed',
      claimed_by: claimedBy,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id, user_id, job_type, platform, job_params')

  if (updErr) {
    return cors(
      NextResponse.json(
        { error: 'claim_failed', detail: updErr.message },
        { status: 500 },
      ),
    )
  }
  if (!claimed || claimed.length === 0) {
    // Someone else claimed it - tell the extension "no work right now"
    // and it'll retry on the next alarm tick.
    return cors(new NextResponse(null, { status: 204 }))
  }

  return cors(NextResponse.json(claimed[0]))
}
