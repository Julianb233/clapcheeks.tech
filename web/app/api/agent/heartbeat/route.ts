import { NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'

import { api } from '@/convex/_generated/api'

/**
 * AI-8876 — Daemon heartbeat endpoint.
 * AI-9536 — Migrated from Supabase clapcheeks_device_heartbeats to Convex
 *           device_heartbeats (high-write path; index-tuned).
 *
 * The clapcheeks daemon on Julian's Mac POSTs to this endpoint every minute
 * to report liveness, version, and last sync time.
 *
 *   POST /api/agent/heartbeat
 *   Headers:
 *     Authorization: Bearer <token from agent_device_tokens (Convex)>
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

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  if (!convexUrl) {
    return cors(
      NextResponse.json(
        { error: 'server_unconfigured', detail: 'CONVEX_URL not set' },
        { status: 500 },
      ),
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

  const lastSyncMs = body.last_sync_at
    ? Date.parse(body.last_sync_at)
    : undefined

  const convex = new ConvexHttpClient(convexUrl)
  try {
    const result = await convex.mutation(api.telemetry.recordHeartbeat, {
      token,
      device_id: body.device_id,
      daemon_version: body.daemon_version,
      last_sync_at: Number.isFinite(lastSyncMs) ? lastSyncMs : undefined,
      errors_jsonb: body.errors_jsonb ?? undefined,
    })

    const serverIso = new Date(result.server_time_ms).toISOString()
    return cors(
      NextResponse.json({ ok: true, server_time: serverIso }, { status: 200 }),
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('invalid_device_token')) {
      // Mirror prior behavior: 404 when token unknown / revoked.
      return cors(
        NextResponse.json({ error: 'device_not_found' }, { status: 404 }),
      )
    }
    return cors(
      NextResponse.json(
        { error: 'server_error', detail: msg },
        { status: 500 },
      ),
    )
  }
}
