import type { SupabaseClient } from '@supabase/supabase-js'

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
]

export function getRedirectUri(origin?: string): string {
  const fromEnv = process.env.GOOGLE_OAUTH_REDIRECT_URI
  if (fromEnv) return fromEnv
  const base = origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return `${base.replace(/\/+$/, '')}/api/auth/google/callback`
}

export function buildConsentUrl(params: {
  origin?: string
  state: string
  loginHint?: string
  prompt?: 'consent' | 'select_account' | 'none'
}): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID not configured')

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', getRedirectUri(params.origin))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', CALENDAR_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', params.prompt ?? 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', params.state)
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint)
  return url.toString()
}

interface TokenExchangeResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
  id_token?: string
}

export async function exchangeCodeForTokens(code: string, origin?: string): Promise<TokenExchangeResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: getRedirectUri(origin),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${detail}`)
  }
  return (await res.json()) as TokenExchangeResponse
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenExchangeResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Token refresh failed: ${res.status} ${detail}`)
  }
  return (await res.json()) as TokenExchangeResponse
}

interface UserInfo {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
}

export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`)
  return (await res.json()) as UserInfo
}

interface StoredTokens {
  user_id: string
  google_email: string
  google_sub: string | null
  access_token: string
  refresh_token: string
  expires_at: string
  scopes: string[]
  calendar_id: string
}

/**
 * Get a valid access token for the user, refreshing if necessary.
 * Returns null if the user has not connected their calendar.
 */
export async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ accessToken: string; tokens: StoredTokens } | null> {
  const { data, error } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return null

  const tokens = data as StoredTokens
  const expiresAt = new Date(tokens.expires_at).getTime()
  const bufferMs = 60_000
  if (Date.now() + bufferMs < expiresAt) {
    return { accessToken: tokens.access_token, tokens }
  }

  // Refresh
  const refreshed = await refreshAccessToken(tokens.refresh_token)
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  await supabase
    .from('google_calendar_tokens')
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  return {
    accessToken: refreshed.access_token,
    tokens: { ...tokens, access_token: refreshed.access_token, expires_at: newExpiresAt },
  }
}

export interface CalendarEventInput {
  summary: string
  description?: string
  location?: string
  start: { dateTime: string; timeZone?: string }
  end: { dateTime: string; timeZone?: string }
  attendees?: { email: string; displayName?: string }[]
  conferenceData?: { createRequest?: { requestId: string; conferenceSolutionKey?: { type: 'hangoutsMeet' } } }
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: CalendarEventInput,
  options: { sendUpdates?: 'all' | 'externalOnly' | 'none'; addMeet?: boolean } = {},
): Promise<{ id: string; htmlLink: string; hangoutLink?: string }> {
  const { sendUpdates = 'all', addMeet = true } = options
  const payload: CalendarEventInput = { ...event }
  if (addMeet && !payload.conferenceData) {
    payload.conferenceData = {
      createRequest: {
        requestId: `cc-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    }
  }

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  )
  url.searchParams.set('sendUpdates', sendUpdates)
  if (addMeet) url.searchParams.set('conferenceDataVersion', '1')

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Create event failed: ${res.status} ${detail}`)
  }

  return (await res.json()) as { id: string; htmlLink: string; hangoutLink?: string }
}
