// AI-9537 — Google Calendar OAuth + helpers.
//
// Token storage migrated from Supabase google_calendar_tokens to Convex
// google_calendar_tokens. Both refresh_token and access_token are
// AES-256-GCM encrypted at rest using the per-user vault from
// web/lib/crypto/token-vault.ts. Plaintext only exists in-memory inside
// this Node runtime, never in transit to/from Convex.
import { encryptToken, decryptToken } from '@/lib/crypto/token-vault'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

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

interface DecryptedTokens {
  user_id: string
  google_email: string
  google_sub: string | null
  access_token: string
  refresh_token: string
  expires_at_ms: number
  scopes: string[]
  calendar_id: string
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function bytesToBuffer(b: ArrayBuffer | Uint8Array | Buffer | null | undefined): Buffer | null {
  if (!b) return null
  if (Buffer.isBuffer(b)) return b
  if (b instanceof Uint8Array) return Buffer.from(b)
  return Buffer.from(new Uint8Array(b as ArrayBuffer))
}

/**
 * AI-9537 — write encrypted Google Calendar tokens to Convex. Used by the
 * OAuth callback. Both access_token and refresh_token are encrypted with
 * the per-user AES-256-GCM vault key before crossing the wire.
 */
export async function persistCalendarTokensEncrypted(params: {
  userId: string
  googleEmail: string
  googleSub: string | null
  accessToken: string
  refreshToken: string
  expiresAtMs: number
  scopes: string[]
  calendarId?: string
}): Promise<void> {
  const accessCt = encryptToken(params.accessToken, params.userId)
  const refreshCt = encryptToken(params.refreshToken, params.userId)
  const convex = getConvexServerClient()
  await convex.mutation(api.calendarTokens.upsertEncrypted, {
    user_id: params.userId,
    google_email: params.googleEmail,
    google_sub: params.googleSub ?? undefined,
    access_token_encrypted: bufferToArrayBuffer(accessCt),
    refresh_token_encrypted: bufferToArrayBuffer(refreshCt),
    enc_version: 1,
    expires_at: params.expiresAtMs,
    scopes: params.scopes,
    calendar_id: params.calendarId ?? 'primary',
  })
}

/**
 * AI-9537 — load + decrypt the user's stored tokens. Returns null if the
 * user has not connected Calendar.
 */
export async function loadDecryptedTokens(userId: string): Promise<DecryptedTokens | null> {
  const convex = getConvexServerClient()
  const row = await convex.query(api.calendarTokens.getEncryptedForUser, { user_id: userId })
  if (!row) return null
  const accessCt = bytesToBuffer(row.access_token_encrypted as ArrayBuffer | Uint8Array)
  const refreshCt = bytesToBuffer(row.refresh_token_encrypted as ArrayBuffer | Uint8Array)
  if (!accessCt || !refreshCt) return null
  const accessToken = decryptToken(accessCt, userId)
  const refreshToken = decryptToken(refreshCt, userId)
  return {
    user_id: row.user_id,
    google_email: row.google_email,
    google_sub: row.google_sub ?? null,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at_ms: row.expires_at,
    scopes: row.scopes,
    calendar_id: row.calendar_id,
  }
}

/**
 * AI-9537 — get a valid access token (refreshing if expired). Replaces the
 * old getValidAccessToken(supabase, userId) signature; callers no longer
 * need to pass a Supabase client.
 */
export async function getValidAccessToken(
  userId: string,
): Promise<{ accessToken: string; tokens: DecryptedTokens } | null> {
  const tokens = await loadDecryptedTokens(userId)
  if (!tokens) return null
  const bufferMs = 60_000
  if (Date.now() + bufferMs < tokens.expires_at_ms) {
    return { accessToken: tokens.access_token, tokens }
  }

  // Refresh upstream and persist new (encrypted) access token.
  const refreshed = await refreshAccessToken(tokens.refresh_token)
  const newExpiresAtMs = Date.now() + refreshed.expires_in * 1000
  const newAccessCt = encryptToken(refreshed.access_token, userId)
  const convex = getConvexServerClient()
  await convex.mutation(api.calendarTokens.updateAccessTokenEncrypted, {
    user_id: userId,
    access_token_encrypted: bufferToArrayBuffer(newAccessCt),
    expires_at: newExpiresAtMs,
  })

  return {
    accessToken: refreshed.access_token,
    tokens: {
      ...tokens,
      access_token: refreshed.access_token,
      expires_at_ms: newExpiresAtMs,
    },
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
