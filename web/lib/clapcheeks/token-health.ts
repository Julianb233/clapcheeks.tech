import { convexQuery } from '@/lib/convex/http'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

type Platform = 'tinder' | 'hinge' | 'instagram' | 'bumble'
type SendBirdMode = 'api_token' | 'client_session' | 'missing'
type SendBirdCaptureState = 'configured' | 'waiting_for_hinge_chat' | 'proxy_not_running' | 'unknown'

export type SendBirdCaptureStatus = {
  status: SendBirdCaptureState
  proxy_host: string | null
  proxy_port: number | null
  proxy_listening: boolean
  snapshot_exists: boolean
  snapshot_app_id_present: boolean
  snapshot_user_id_present: boolean
  snapshot_session_key_present: boolean
  snapshot_api_token_present: boolean
  app_id_present: boolean
  user_id_present: boolean
  session_key_present: boolean
  api_token_present: boolean
  missing_fields: string[]
  captured_at_ms: number | null
  snapshot_mtime_ms: number | null
  next_step: string | null
}

export type PlatformTokenHealth = {
  platform: Platform
  required: boolean
  present: boolean
  status: 'valid' | 'missing' | 'unknown'
  source: string | null
  updated_at: string | null
  age_hours: number | null
}

export type TokenHealthSummary = {
  user_id: string
  platforms: PlatformTokenHealth[]
  sendbird: {
    required: boolean
    present: boolean
    status: 'configured' | 'missing'
    missing: string[]
    mode: SendBirdMode
    source: 'env' | 'local-session' | 'convex.telemetry' | 'missing'
    updated_at: string | null
    age_minutes: number | null
    capture_status: SendBirdCaptureStatus | null
  }
  missing_required: number
  missing_required_services: Array<{
    type: 'platform' | 'service'
    name: Platform | 'sendbird'
    reason: string
  }>
}

const REQUIRED_PLATFORMS = new Set<Platform>(['tinder', 'hinge'])
const PLATFORMS: Platform[] = ['tinder', 'hinge', 'instagram', 'bumble']
const SENDBIRD_STATUS_EVENT_TYPE = 'runtime.sendbird_status'
const SENDBIRD_REMOTE_STALE_MS = 15 * 60 * 1000

type SendBirdReadiness = {
  present: boolean
  mode: SendBirdMode
  source: TokenHealthSummary['sendbird']['source']
  updated_at: string | null
  age_minutes: number | null
  missing: string[]
  capture_status: SendBirdCaptureStatus | null
}

function localSendBirdSessionPresent() {
  const appId = process.env.SENDBIRD_APP_ID
  const userId = process.env.SENDBIRD_USER_ID
  const sessionKey = process.env.SENDBIRD_SESSION_KEY
  if (appId && userId && sessionKey) {
    return true
  }
  const snapshotPath = process.env.SENDBIRD_SESSION_PATH || join(homedir(), '.clapcheeks', 'sendbird-session.json')
  if (!existsSync(snapshotPath)) return false
  try {
    const data = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>
    return Boolean(data.app_id && data.user_id && data.session_key)
  } catch {
    return false
  }
}

function localSendBirdReadiness(): SendBirdReadiness {
  const apiTokenPresent = Boolean(process.env.SENDBIRD_APP_ID && process.env.SENDBIRD_API_TOKEN)
  if (apiTokenPresent) {
    return {
      present: true,
      mode: 'api_token',
      source: 'env',
      updated_at: null,
      age_minutes: null,
      missing: [],
      capture_status: null,
    }
  }
  if (localSendBirdSessionPresent()) {
    return {
      present: true,
      mode: 'client_session',
      source: 'local-session',
      updated_at: null,
      age_minutes: null,
      missing: [],
      capture_status: null,
    }
  }
  const sessionMissing = [
    process.env.SENDBIRD_APP_ID ? null : 'SENDBIRD_APP_ID',
    process.env.SENDBIRD_USER_ID ? null : 'SENDBIRD_USER_ID',
    process.env.SENDBIRD_SESSION_KEY ? null : 'SENDBIRD_SESSION_KEY',
  ].filter(Boolean) as string[]
  return {
    present: false,
    mode: 'missing',
    source: 'missing',
    updated_at: null,
    age_minutes: null,
    missing: sessionMissing.length < 3
      ? sessionMissing
      : ['SENDBIRD_API_TOKEN or captured SendBird client session'],
    capture_status: null,
  }
}

function readLocalEnvValue(key: string) {
  if (process.env[key]) return process.env[key]
  for (const envPath of [
    join(homedir(), '.clapcheeks-local', '.env'),
    join(homedir(), '.clapcheeks', '.env'),
  ]) {
    if (!existsSync(envPath)) continue
    try {
      const match = readFileSync(envPath, 'utf8').match(new RegExp(`^${key}=([^\\n#]+)`, 'm'))
      if (match?.[1]?.trim()) return match[1].trim().replace(/^['"]|['"]$/g, '')
    } catch {
      // Ignore unreadable local env files; Convex remains the source of truth.
    }
  }
  return ''
}

function localPlatformToken(platform: Platform) {
  if (platform === 'tinder' && readLocalEnvValue('TINDER_AUTH_TOKEN')) {
    return {
      updated_at: Date.now(),
      source: 'local-env',
    }
  }
  if (platform === 'hinge' && (readLocalEnvValue('HINGE_AUTH_TOKEN') || existsSync(join(homedir(), '.clapcheeks', 'hinge_mitm_snapshot.json')))) {
    return {
      updated_at: Date.now(),
      source: 'local-env',
    }
  }
  return null
}

function coerceUpdatedAt(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function coerceNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function coerceSendBirdCaptureStatus(value: unknown): SendBirdCaptureStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const rawStatus = typeof data.status === 'string' ? data.status : 'unknown'
  const status: SendBirdCaptureState = rawStatus === 'configured'
    || rawStatus === 'waiting_for_hinge_chat'
    || rawStatus === 'proxy_not_running'
    ? rawStatus
    : 'unknown'
  return {
    status,
    proxy_host: typeof data.proxy_host === 'string' ? data.proxy_host : null,
    proxy_port: coerceNumber(data.proxy_port),
    proxy_listening: data.proxy_listening === true,
    snapshot_exists: data.snapshot_exists === true,
    snapshot_app_id_present: data.snapshot_app_id_present === true,
    snapshot_user_id_present: data.snapshot_user_id_present === true,
    snapshot_session_key_present: data.snapshot_session_key_present === true,
    snapshot_api_token_present: data.snapshot_api_token_present === true,
    app_id_present: data.app_id_present === true,
    user_id_present: data.user_id_present === true,
    session_key_present: data.session_key_present === true,
    api_token_present: data.api_token_present === true,
    missing_fields: Array.isArray(data.missing_fields)
      ? data.missing_fields.filter((item): item is string => typeof item === 'string' && item.startsWith('SENDBIRD_'))
      : [],
    captured_at_ms: coerceNumber(data.captured_at_ms),
    snapshot_mtime_ms: coerceNumber(data.snapshot_mtime_ms),
    next_step: typeof data.next_step === 'string' ? data.next_step : null,
  }
}

function defaultTelemetryUserId() {
  return process.env.CONVEX_FLEET_USER_ID || 'fleet-julian'
}

async function remoteSendBirdReadiness(userId: string): Promise<SendBirdReadiness | null> {
  const userIds = [userId, defaultTelemetryUserId()].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  )
  let staleReadiness: SendBirdReadiness | null = null
  for (const telemetryUserId of userIds) {
    try {
      const events = await convexQuery<Array<{ data?: Record<string, unknown>; occurred_at?: number; ts?: number }>>(
        'telemetry:listEventsForUser',
        {
          user_id: telemetryUserId,
          event_type: SENDBIRD_STATUS_EVENT_TYPE,
          limit: 1,
        },
      )
      const event = Array.isArray(events) ? events[0] : null
      const data = event?.data
      if (!data || typeof data !== 'object') continue
      const updatedMs = coerceUpdatedAt(data.updated_at_ms) || coerceUpdatedAt(event?.occurred_at) || coerceUpdatedAt(event?.ts)
      const ageMs = updatedMs ? Date.now() - updatedMs : null
      if (ageMs === null || ageMs > SENDBIRD_REMOTE_STALE_MS) {
        staleReadiness = {
          present: false,
          mode: 'missing',
          source: 'convex.telemetry',
          updated_at: updatedMs ? new Date(updatedMs).toISOString() : null,
          age_minutes: ageMs === null ? null : Math.round(ageMs / 600) / 100,
          missing: ['Fresh SendBird runtime telemetry'],
          capture_status: coerceSendBirdCaptureStatus(data.capture_status),
        }
        continue
      }
      const appIdPresent = data.app_id_present === true
      const userIdPresent = data.user_id_present === true
      const sessionKeyPresent = data.session_key_present === true
      const apiTokenPresent = data.api_token_present === true
      const hasApiToken = appIdPresent && apiTokenPresent
      const hasClientSession = appIdPresent && userIdPresent && sessionKeyPresent
      const mode = hasApiToken
        ? 'api_token'
        : hasClientSession
          ? 'client_session'
          : 'missing'
      const missing = hasApiToken || hasClientSession
        ? []
        : apiTokenPresent
          ? (appIdPresent ? [] : ['SENDBIRD_APP_ID'])
          : [
              appIdPresent ? null : 'SENDBIRD_APP_ID',
              userIdPresent ? null : 'SENDBIRD_USER_ID',
              sessionKeyPresent ? null : 'SENDBIRD_SESSION_KEY',
            ].filter(Boolean) as string[]
      return {
        present: data.present === true || hasApiToken || hasClientSession,
        mode,
        source: 'convex.telemetry',
        updated_at: updatedMs ? new Date(updatedMs).toISOString() : null,
        age_minutes: ageMs === null ? null : Math.round(ageMs / 600) / 100,
        missing: missing.length > 0 ? missing : ['SENDBIRD_API_TOKEN or captured SendBird client session'],
        capture_status: coerceSendBirdCaptureStatus(data.capture_status),
      }
    } catch {
      continue
    }
  }
  return staleReadiness
}

function platformStatus(
  platform: Platform,
  token: Record<string, unknown> | null,
): PlatformTokenHealth {
  const updatedMs = coerceUpdatedAt(token?.updated_at)
  const required = REQUIRED_PLATFORMS.has(platform)
  return {
    platform,
    required,
    present: Boolean(token),
    status: token ? 'valid' : 'missing',
    source: typeof token?.source === 'string' ? token.source : null,
    updated_at: updatedMs ? new Date(updatedMs).toISOString() : null,
    age_hours: updatedMs ? Math.round((Date.now() - updatedMs) / 36_000) / 100 : null,
  }
}

export async function getTokenHealth(userId: string): Promise<TokenHealthSummary> {
  const platforms = await Promise.all(
    PLATFORMS.map(async (platform) => {
      try {
        const token = await convexQuery<Record<string, unknown> | null>(
          'platformTokens:getForUser',
          { user_id: userId, platform },
        )
        return platformStatus(platform, token || localPlatformToken(platform))
      } catch {
        const localToken = localPlatformToken(platform)
        if (localToken) return platformStatus(platform, localToken)
        return {
          platform,
          required: REQUIRED_PLATFORMS.has(platform),
          present: false,
          status: 'unknown' as const,
          source: null,
          updated_at: null,
          age_hours: null,
        }
      }
    }),
  )

  const localSendBird = localSendBirdReadiness()
  const remoteSendBird = await remoteSendBirdReadiness(userId)
  const sendBird = localSendBird.present ? localSendBird : remoteSendBird ?? localSendBird
  const sendBirdPresent = sendBird.present
  const missingSendBird = sendBirdPresent
    ? []
    : sendBird.missing
  const sendBirdMissingReason = sendBird.capture_status?.status === 'waiting_for_hinge_chat'
    ? `SendBird missing ${missingSendBird.join(', ')}; Hinge proxy is running and waiting for chat capture`
    : sendBird.capture_status?.status === 'proxy_not_running'
      ? `SendBird missing ${missingSendBird.join(', ')}; Hinge proxy is not listening`
      : `SendBird missing ${missingSendBird.join(', ')}`
  const missingRequiredServices = [
    ...platforms
      .filter((platform) => platform.required && !platform.present)
      .map((platform) => ({
        type: 'platform' as const,
        name: platform.platform,
        reason: `${platform.platform} token missing`,
      })),
    ...(missingSendBird.length > 0
      ? [{
          type: 'service' as const,
          name: 'sendbird' as const,
          reason: sendBirdMissingReason,
        }]
      : []),
  ]

  return {
    user_id: userId,
    platforms,
    sendbird: {
      required: true,
      present: sendBirdPresent,
      status: sendBirdPresent ? 'configured' : 'missing',
      missing: missingSendBird,
      mode: sendBird.mode,
      source: sendBird.source,
      updated_at: sendBird.updated_at,
      age_minutes: sendBird.age_minutes,
      capture_status: sendBird.capture_status,
    },
    missing_required:
      platforms.filter((p) => p.required && !p.present).length +
      (missingSendBird.length > 0 ? 1 : 0),
    missing_required_services: missingRequiredServices,
  }
}
