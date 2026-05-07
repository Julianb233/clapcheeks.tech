import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: devices on Convex.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // AI-8926: read both Convex `devices` and Supabase `clapcheeks_device_heartbeats`
  // and report the fresher of the two.  Daemons running the post-AI-8876 stack
  // upsert heartbeats every minute; the Convex `devices` rows can lag.
  const convex = getConvexServerClient()
  const [deviceListRes, agentTokenRes, heartbeatRes] = await Promise.all([
    convex.query(api.devices.listForUser, { user_id: user.id }),
    supabase
      .from('clapcheeks_agent_tokens')
      .select('status, degraded_platform, degraded_reason')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1),
    supabase
      .from('clapcheeks_device_heartbeats')
      .select('last_heartbeat_at')
      .eq('user_id', user.id)
      .order('last_heartbeat_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const deviceList = (deviceListRes ?? []) as Array<{ last_seen_at: number; is_active: boolean }>
  const oldDevice = deviceList.length
    ? deviceList.reduce((best, d) => (d.last_seen_at > best.last_seen_at ? d : best))
    : null
  const heartbeatTs = (heartbeatRes.data as { last_heartbeat_at: string | null } | null)?.last_heartbeat_at ?? null

  type DeviceShape = { last_seen_at: string; is_active: boolean }
  const candidates: DeviceShape[] = []
  if (oldDevice) candidates.push({ last_seen_at: new Date(oldDevice.last_seen_at).toISOString(), is_active: oldDevice.is_active ?? true })
  if (heartbeatTs) candidates.push({ last_seen_at: heartbeatTs, is_active: true })
  const device: DeviceShape | null = candidates.length
    ? candidates.reduce((best, c) =>
        new Date(c.last_seen_at).getTime() > new Date(best.last_seen_at).getTime() ? c : best,
      )
    : null

  const agentToken = agentTokenRes.data?.[0] || null

  return NextResponse.json({ device, agentToken })
}
