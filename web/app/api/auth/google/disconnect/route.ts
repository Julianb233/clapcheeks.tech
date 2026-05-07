import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadDecryptedTokens } from '@/lib/google/calendar'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

export const runtime = 'nodejs'

/**
 * POST /api/auth/google/disconnect
 *
 * AI-9537: tokens now live in Convex google_calendar_tokens.
 * loadDecryptedTokens() pulls the (decrypted) refresh_token so we can
 * revoke it upstream before deleting the row.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let refreshToken: string | null = null
  try {
    const decrypted = await loadDecryptedTokens(user.id)
    refreshToken = decrypted?.refresh_token ?? null
  } catch (err) {
    console.error('Calendar disconnect: failed to decrypt token', err)
  }

  if (refreshToken) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      })
    } catch (err) {
      console.error('Google revoke failed (continuing):', err)
    }
  }

  try {
    const convex = getConvexServerClient()
    await convex.mutation(api.calendarTokens.deleteForUser, { user_id: user.id })
  } catch (err) {
    console.error('Calendar disconnect: convex delete failed', err)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
