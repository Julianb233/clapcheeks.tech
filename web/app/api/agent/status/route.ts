import { NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'

import { createClient } from '@/lib/supabase/server'
import { api } from '@/convex/_generated/api'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // AI-8926: read both legacy `devices` and modern device_heartbeats
  // and report the fresher of the two. Daemons running the post-AI-8876 stack
  // upsert heartbeats every minute; the older `devices` table can lag for hours.
  // AI-9536: device_heartbeats now lives on Convex.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null

  const [deviceRes, agentTokenRes, heartbeatRow] = await Promise.all([
    // AI-9537: devices migrated to Convex.
    convex
      ? convex
          .query(api.devices.listForUser, { user_id: user.id })
          .catch(() => [] as Array<{ last_seen_at: number; is_active: boolean }>)
      : Promise.resolve([] as Array<{ last_seen_at: number; is_active: boolean }>),
    supabase
      .from('clapcheeks_agent_tokens')
      .select('status, degraded_platform, degraded_reason')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1),
    convex
      ? convex
          .query(api.telemetry.getLatestHeartbeat, { user_id: user.id })
          .catch(() => null)
      : Promise.resolve(null),
  ])

  const deviceRows = (deviceRes as Array<{ last_seen_at: number; is_active: boolean }>) ?? []
  const oldDevice = deviceRows.length
    ? deviceRows.reduce((best, d) => (d.last_seen_at > best.last_seen_at ? d : best))
    : null
  const heartbeatTsMs = heartbeatRow?.last_heartbeat_at ?? null

  type DeviceShape = { last_seen_at: string; is_active: boolean }
  const candidates: DeviceShape[] = []
  if (oldDevice?.last_seen_at) {
    candidates.push({
      last_seen_at: new Date(oldDevice.last_seen_at).toISOString(),
      is_active: oldDevice.is_active ?? true,
    })
  }
  if (heartbeatTsMs) {
    candidates.push({
      last_seen_at: new Date(heartbeatTsMs).toISOString(),
      is_active: true,
    })
  }
  const device: DeviceShape | null = candidates.length
    ? candidates.reduce((best, c) =>
        new Date(c.last_seen_at).getTime() > new Date(best.last_seen_at).getTime() ? c : best,
      )
    : null

  const agentToken = agentTokenRes.data?.[0] || null

  return NextResponse.json({ device, agentToken })
}
