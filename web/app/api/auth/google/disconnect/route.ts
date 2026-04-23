import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * POST /api/auth/google/disconnect
 * Revokes the stored Google Calendar connection for the current user.
 * Attempts to revoke the token upstream so Google also forgets us.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('google_calendar_tokens')
    .select('refresh_token, access_token')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing?.refresh_token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: existing.refresh_token as string }),
      })
    } catch (err) {
      console.error('Google revoke failed (continuing):', err)
    }
  }

  await supabase.from('google_calendar_tokens').delete().eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
