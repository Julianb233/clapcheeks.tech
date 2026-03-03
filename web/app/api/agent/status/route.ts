import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [deviceRes, agentTokenRes] = await Promise.all([
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
  ])

  const device = deviceRes.data?.[0] || null
  const agentToken = agentTokenRes.data?.[0] || null

  return NextResponse.json({ device, agentToken })
}
