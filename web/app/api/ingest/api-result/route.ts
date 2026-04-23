import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Phase M (AI-8345) job-result ingest endpoint.
 *
 * The Chrome extension (token-harvester background.js) claims rows
 * from public.clapcheeks_agent_jobs, executes the fetch inside
 * Julian's real browser session (credentials: include -> residential
 * IP + genuine cookies), then POSTs the response body here so the
 * daemon can parse it.
 *
 *   POST /api/ingest/api-result
 *   Headers:
 *     X-Device-Token: <token from clapcheeks_agent_tokens>
 *     X-Device-Name:  friendly label (optional; bumps device row)
 *   Body:
 *     {
 *       job_id: string (uuid),
 *       status_code: number,
 *       body: any (response JSON or text),
 *       headers?: Record<string,string>,
 *       error?: string
 *     }
 *
 * CORS: Chrome extension origins (chrome-extension://...) are allowed.
 */

const MAX_RESULT_BYTES = 2_000_000 // ~2MB - big profile payloads are fine, nothing near this

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

  let body: {
    job_id?: string
    status_code?: number
    body?: unknown
    headers?: Record<string, string>
    error?: string
  }
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json({ error: 'invalid_json' }, { status: 400 }))
  }

  const jobId = (body.job_id || '').trim()
  if (!jobId) {
    return cors(NextResponse.json({ error: 'missing_job_id' }, { status: 400 }))
  }

  // Rough payload-size guard. JSON.stringify is cheap vs an accidental
  // multi-MB paste that would bloat the jobs table.
  let approxSize = 0
  try {
    approxSize = JSON.stringify(body.body ?? '').length
  } catch {
    approxSize = 0
  }
  if (approxSize > MAX_RESULT_BYTES) {
    return cors(
      NextResponse.json(
        { error: 'result_too_large', approx_bytes: approxSize },
        { status: 413 },
      ),
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

  // Device-token -> user_id lookup. Same scheme as /api/ingest/platform-token.
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

  // Bump device last_seen_at so the fleet-health dashboard can tell
  // the extension is alive. Fire-and-forget.
  void supabase
    .from('clapcheeks_agent_tokens')
    .update({
      last_seen_at: new Date().toISOString(),
      ...(deviceName ? { device_name: deviceName } : {}),
    })
    .eq('token', deviceToken)
    .then(() => null)

  // Scope the write to the owning user so one user's extension can't
  // complete another user's job even if someone leaks a device token.
  const { data: jobRows, error: jobErr } = await supabase
    .from('clapcheeks_agent_jobs')
    .select('id, user_id, status')
    .eq('id', jobId)
    .eq('user_id', devRow.user_id)
    .limit(1)

  if (jobErr) {
    return cors(
      NextResponse.json(
        { error: 'job_lookup_failed', detail: jobErr.message },
        { status: 500 },
      ),
    )
  }
  if (!jobRows || jobRows.length === 0) {
    return cors(
      NextResponse.json({ error: 'job_not_found_or_not_yours' }, { status: 404 }),
    )
  }
  const jobRow = jobRows[0]
  if (jobRow.status === 'completed' || jobRow.status === 'failed') {
    return cors(
      NextResponse.json(
        { ok: true, already: jobRow.status, job_id: jobRow.id },
      ),
    )
  }

  const statusCode =
    typeof body.status_code === 'number' ? body.status_code : 0
  const httpFailed =
    body.error ||
    statusCode === 0 ||
    (statusCode >= 400 && statusCode < 600)

  const nowIso = new Date().toISOString()
  const resultEnvelope = {
    status_code: statusCode,
    body: body.body ?? null,
    headers: body.headers ?? {},
  }

  const updatePayload: Record<string, unknown> = {
    status: httpFailed ? 'failed' : 'completed',
    result_jsonb: resultEnvelope,
    error: body.error ?? (httpFailed ? `http_${statusCode}` : null),
    completed_at: nowIso,
  }

  const { error: updErr } = await supabase
    .from('clapcheeks_agent_jobs')
    .update(updatePayload)
    .eq('id', jobId)
    .eq('user_id', devRow.user_id)

  if (updErr) {
    return cors(
      NextResponse.json(
        { error: 'update_failed', detail: updErr.message },
        { status: 500 },
      ),
    )
  }

  return cors(
    NextResponse.json({
      ok: true,
      job_id: jobId,
      status: updatePayload.status,
    }),
  )
}
