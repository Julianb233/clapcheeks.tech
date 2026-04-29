import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // AI-8926: read both legacy `devices` and modern `clapcheeks_device_heartbeats`
  // and report the fresher of the two.  Daemons running the post-AI-8876 stack
  // upsert heartbeats every minute; the older `devices` table can lag for hours.
  const [deviceRes, agentTokenRes, heartbeatRes] = await Promise.all([
    supabase
      .from('devices')
      .select('last_seen_at, is_active')
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false })
      .limit(1),
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

  const oldDevice = deviceRes.data?.[0] || null
  const heartbeatTs = (heartbeatRes.data as { last_heartbeat_at: string | null } | null)?.last_heartbeat_at ?? null

  type DeviceShape = { last_seen_at: string; is_active: boolean }
  const candidates: DeviceShape[] = []
  if (oldDevice?.last_seen_at) candidates.push({ last_seen_at: oldDevice.last_seen_at, is_active: oldDevice.is_active ?? true })
  if (heartbeatTs) candidates.push({ last_seen_at: heartbeatTs, is_active: true })
  const device: DeviceShape | null = candidates.length
    ? candidates.reduce((best, c) =>
        new Date(c.last_seen_at).getTime() > new Date(best.last_seen_at).getTime() ? c : best,
      )
    : null

  const agentToken = agentTokenRes.data?.[0] || null

  return NextResponse.json({ device, agentToken })
}
