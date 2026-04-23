import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildConsentUrl } from '@/lib/google/calendar'

export const runtime = 'nodejs'

/**
 * GET /api/auth/google/connect?next=/settings
 * Kicks off the Google OAuth consent flow for Calendar.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/api/auth/google/connect', req.url))
  }

  const next = req.nextUrl.searchParams.get('next') ?? '/settings'
  const loginHint = req.nextUrl.searchParams.get('login_hint') ?? undefined

  const stateValue = crypto.randomBytes(16).toString('hex')
  const statePayload = Buffer.from(JSON.stringify({ s: stateValue, u: user.id, n: next })).toString(
    'base64url',
  )

  const origin = req.nextUrl.origin
  const consentUrl = buildConsentUrl({
    origin,
    state: statePayload,
    loginHint,
  })

  const res = NextResponse.redirect(consentUrl)
  res.cookies.set('google_oauth_state', stateValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
