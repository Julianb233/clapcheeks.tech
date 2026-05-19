import { NextRequest, NextResponse } from 'next/server'
import { convexMutation } from '@/lib/convex/http'

function cors(resp: NextResponse) {
  resp.headers.set('Access-Control-Allow-Origin', '*')
  resp.headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Device-Token, X-Device-Name',
  )
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  return resp
}

function bearerToken(header: string | null) {
  if (!header) return ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return (match?.[1] || '').trim()
}

function toMs(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

export async function POST(req: NextRequest) {
  const token =
    bearerToken(req.headers.get('authorization')) ||
    (req.headers.get('x-device-token') || '').trim()
  if (!token) {
    return cors(NextResponse.json({ error: 'missing_agent_token' }, { status: 401 }))
  }

  let body: {
    device_id?: string
    daemon_version?: string
    last_sync_at?: number | string
    errors_jsonb?: unknown
  } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  try {
    const result = await convexMutation<{
      ok?: boolean
      action?: string
      server_time_ms?: number
      user_id?: string
    }>('telemetry:recordHeartbeat', {
      token,
      device_id:
        body.device_id ||
        req.headers.get('x-device-name') ||
        req.headers.get('user-agent') ||
        'clapcheeks-local',
      daemon_version: body.daemon_version || 'clapcheeks-local',
      last_sync_at: toMs(body.last_sync_at),
      errors_jsonb: body.errors_jsonb ?? null,
    })

    return cors(NextResponse.json({
      ok: result?.ok !== false,
      action: result?.action ?? 'recorded',
      server_time_ms: result?.server_time_ms ?? Date.now(),
      user_id: result?.user_id ?? null,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /invalid|token/i.test(message) ? 401 : 500
    return cors(NextResponse.json({ error: 'heartbeat_failed', detail: message }, { status }))
  }
}
