import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens, fetchUserInfo } from '@/lib/google/calendar'

export const runtime = 'nodejs'

/**
 * GET /api/auth/google/callback — OAuth return path.
 * Exchanges the code for tokens, fetches userinfo, persists to
 * google_calendar_tokens, then redirects back to `next`.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const code = req.nextUrl.searchParams.get('code')
  const stateParam = req.nextUrl.searchParams.get('state')
  const errorParam = req.nextUrl.searchParams.get('error')

  if (errorParam) {
    const url = new URL('/settings', req.url)
    url.searchParams.set('calendar_error', errorParam)
    return NextResponse.redirect(url)
  }

  if (!code || !stateParam) {
    const url = new URL('/settings', req.url)
    url.searchParams.set('calendar_error', 'missing_code')
    return NextResponse.redirect(url)
  }

  // Validate state
  let parsedState: { s: string; u: string; n: string }
  try {
    parsedState = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8')) as {
      s: string
      u: string
      n: string
    }
  } catch {
    const url = new URL('/settings', req.url)
    url.searchParams.set('calendar_error', 'bad_state')
    return NextResponse.redirect(url)
  }

  const cookieState = req.cookies.get('google_oauth_state')?.value
  if (!cookieState || cookieState !== parsedState.s || parsedState.u !== user.id) {
    const url = new URL('/settings', req.url)
    url.searchParams.set('calendar_error', 'state_mismatch')
    return NextResponse.redirect(url)
  }

  try {
    const tokens = await exchangeCodeForTokens(code, req.nextUrl.origin)
    const userInfo = await fetchUserInfo(tokens.access_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    if (!tokens.refresh_token) {
      const url = new URL('/settings', req.url)
      url.searchParams.set('calendar_error', 'no_refresh_token')
      return NextResponse.redirect(url)
    }

    await supabase.from('google_calendar_tokens').upsert(
      {
        user_id: user.id,
        google_email: userInfo.email,
        google_sub: userInfo.sub,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes: tokens.scope.split(' '),
        calendar_id: 'primary',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

    const next = parsedState.n.startsWith('/') ? parsedState.n : '/settings'
    const url = new URL(next, req.url)
    url.searchParams.set('calendar_connected', userInfo.email)
    const res = NextResponse.redirect(url)
    res.cookies.delete('google_oauth_state')
    return res
  } catch (err) {
    console.error('Calendar OAuth callback error:', err)
    const url = new URL('/settings', req.url)
    url.searchParams.set('calendar_error', 'exchange_failed')
    return NextResponse.redirect(url)
  }
}
