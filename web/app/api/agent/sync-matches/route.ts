import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Phase D stub — triggers the Phase A match-intake daemon.
 *
 * Phase A (AI-8315) owns the actual daemon wiring. Until then this endpoint
 * 1. Verifies the user is authenticated
 * 2. Logs the sync request
 * 3. Returns 202 Accepted
 *
 * When Phase A lands, swap the console.log for the real trigger (e.g. post
 * to the agent's command queue or publish a Supabase realtime event).
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Gate the stub behind admin role until Phase A daemon lands (AI-8590).
  // Regular users should not see a stub endpoint advertising itself.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role ?? ''
  if (!['admin', 'super_admin'].includes(role)) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  // eslint-disable-next-line no-console
  console.log('[sync-matches] sync requested', {
    user_id: user.id,
    ts: new Date().toISOString(),
  })

  return NextResponse.json(
    {
      ok: true,
      message: 'Sync requested. Phase A daemon will process on its next tick.',
      phase: 'D-stub',
    },
    { status: 202 },
  )
}
