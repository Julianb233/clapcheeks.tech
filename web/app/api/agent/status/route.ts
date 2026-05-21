import { NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'
import { convexQuery } from '@/lib/convex/http'

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000

function msToIso(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return null
}

export async function GET() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [deviceRes, heartbeatRes] = await Promise.all([
    convex
      .from('devices')
      .select('last_seen_at, is_active')
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false })
      .limit(1),
    convexQuery<Record<string, unknown> | null>('telemetry:getLatestHeartbeat', {
      user_id: user.id,
    }).then((data) => ({ data, error: null as null | { message: string } }))
      .catch((error) => ({
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      })),
  ])

  const device = deviceRes.data?.[0] || null
  const heartbeat = heartbeatRes.data || null
  const heartbeatLastSeen = msToIso(heartbeat?.last_heartbeat_at)
  const lastSeen = device?.last_seen_at || heartbeatLastSeen || null
  const online = Boolean(lastSeen && Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD_MS)
  const heartbeatSource = device ? 'convex.devices' : heartbeat ? 'convex.telemetry' : 'none'

  return NextResponse.json({
    device,
    heartbeat,
    agentToken: null,
    lastSeen,
    status: lastSeen ? (online ? 'online' : 'stale') : 'no_convex_heartbeat',
    userId: user.id,
    source: {
      heartbeat: heartbeatSource,
      device: device ? 'convex.devices' : 'none',
      agentToken: 'none',
    },
    message: device
      ? undefined
      : heartbeat
        ? 'Using the latest Convex telemetry heartbeat because no devices row was found.'
        : 'No live Convex device or telemetry heartbeat was found for the dashboard user. Dashboard stats can still be live Convex data, but agent-online should not be inferred.',
    errors: {
      device: deviceRes.error?.message || null,
      heartbeat: heartbeatRes.error?.message || null,
    },
  })
}
