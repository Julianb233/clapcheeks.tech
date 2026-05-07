/**
 * Sticky Connection Health Bar (AI-8764)
 *
 * Server component rendered above every authenticated page (in
 * `app/(main)/layout.tsx`). Pulls token expiry + recent ban events from
 * Supabase and renders one pill per platform plus an agent + presence pill.
 *
 * Pill colors:
 *   - green:  token live, no recent critical ban events
 *   - amber:  token expires <7d OR a `warn`-severity event in last 24h
 *   - red:    token expired/missing OR a `critical` event in last 24h
 *             OR (for agent) device offline >5 minutes
 *
 * Each platform pill links to /device so the user can re-auth.
 */
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

type PillColor = 'green' | 'amber' | 'red' | 'gray'

interface Pill {
  label: string
  detail?: string
  color: PillColor
  href: string
  icon: '✓' | '⚠' | '✗' | '•'
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const AGENT_ONLINE_THRESHOLD_MS = 5 * 60 * 1000

interface UserSettingsRow {
  tinder_auth_token: string | null
  tinder_auth_token_updated_at: string | null
  tinder_auth_token_expires_at: string | null
  hinge_auth_token: string | null
  hinge_auth_token_updated_at: string | null
  hinge_auth_token_expires_at: string | null
  bumble_session_expires_at: string | null
}

interface BanEventRow {
  platform: string
  signal_type: string
  severity: 'info' | 'warn' | 'critical'
  detected_at: string
}

interface DeviceRow {
  last_seen_at: string | null
  is_active: boolean | null
}

function pillForPlatform(
  platform: 'tinder' | 'hinge' | 'bumble',
  settings: UserSettingsRow | null,
  recentEvents: BanEventRow[],
): Pill {
  const labelMap = { tinder: 'Tinder', hinge: 'Hinge', bumble: 'Bumble' }
  const label = labelMap[platform]
  const href = '/device'

  // Token presence + expiry
  const hasToken = (() => {
    if (platform === 'tinder') return Boolean(settings?.tinder_auth_token)
    if (platform === 'hinge') return Boolean(settings?.hinge_auth_token)
    // Bumble doesn't store a token; presence comes from session_expires_at
    return Boolean(settings?.bumble_session_expires_at)
  })()

  const expiresAtRaw =
    platform === 'tinder'
      ? settings?.tinder_auth_token_expires_at
      : platform === 'hinge'
        ? settings?.hinge_auth_token_expires_at
        : settings?.bumble_session_expires_at

  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null
  const now = Date.now()
  const expired = expiresAt ? expiresAt.getTime() <= now : false
  const expiresWithin7d = expiresAt
    ? !expired && expiresAt.getTime() - now < SEVEN_DAYS_MS
    : false

  // Recent ban events for this platform within last 24h
  const platformEvents = recentEvents.filter((e) => e.platform === platform)
  const hasCritical24h = platformEvents.some(
    (e) =>
      e.severity === 'critical' &&
      Date.now() - new Date(e.detected_at).getTime() < ONE_DAY_MS,
  )
  const hasWarn24h = platformEvents.some(
    (e) =>
      e.severity === 'warn' &&
      Date.now() - new Date(e.detected_at).getTime() < ONE_DAY_MS,
  )

  // Routing
  if (!hasToken) {
    return { label, detail: 'not connected', color: 'gray', href, icon: '•' }
  }

  if (expired || hasCritical24h) {
    const detail = expired
      ? 'expired'
      : platformEvents.find((e) => e.severity === 'critical')?.signal_type ===
          'http_403'
        ? 'banned'
        : 'recapture'
    return { label, detail, color: 'red', href, icon: '✗' }
  }

  if (expiresWithin7d) {
    const days = Math.max(
      1,
      Math.ceil((expiresAt!.getTime() - now) / (24 * 60 * 60 * 1000)),
    )
    return {
      label,
      detail: `expires ${days}d`,
      color: 'amber',
      href,
      icon: '⚠',
    }
  }

  if (hasWarn24h) {
    return { label, detail: 'rate-limited', color: 'amber', href, icon: '⚠' }
  }

  return { label, color: 'green', href, icon: '✓' }
}

function pillForAgent(device: DeviceRow | null): Pill {
  if (!device || !device.last_seen_at) {
    return {
      label: 'Mac agent',
      detail: 'never seen',
      color: 'gray',
      href: '/device',
      icon: '•',
    }
  }
  const lastSeenMs = new Date(device.last_seen_at).getTime()
  const isOnline = Date.now() - lastSeenMs < AGENT_ONLINE_THRESHOLD_MS
  if (isOnline && device.is_active) {
    return { label: 'Mac agent', color: 'green', href: '/device', icon: '✓' }
  }
  return {
    label: 'Mac agent',
    detail: 'offline',
    color: 'red',
    href: '/device',
    icon: '✗',
  }
}

function pillForPresence(presenceLabel: string | null): Pill {
  // Presence is read-only signal — link to /device for the toggles.
  if (!presenceLabel) {
    return {
      label: 'Presence',
      detail: 'unknown',
      color: 'gray',
      href: '/device',
      icon: '•',
    }
  }
  return {
    label: 'Presence',
    detail: presenceLabel,
    color: 'green',
    href: '/device',
    icon: '✓',
  }
}

function colorClasses(color: PillColor): string {
  switch (color) {
    case 'green':
      return 'border-green-700/40 bg-green-900/30 text-green-300'
    case 'amber':
      return 'border-amber-500/40 bg-amber-900/20 text-amber-300'
    case 'red':
      return 'border-red-700/40 bg-red-900/30 text-red-300'
    case 'gray':
    default:
      return 'border-white/10 bg-white/5 text-white/40'
  }
}

export default async function ConnectionBar() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const since = new Date(Date.now() - ONE_DAY_MS).toISOString()

  // 4 reads in parallel — keep the bar render cheap.
  // AI-8926/AI-9536: device_heartbeats lives on Convex. Older `devices`
  // rows can be stale; pick the freshest of the two.
  const fetchHeartbeat = async (): Promise<{
    last_heartbeat_at: string | null
  } | null> => {
    const url =
      process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
    if (!url) return null
    try {
      const { ConvexHttpClient } = await import('convex/browser')
      const { api } = await import('@/convex/_generated/api')
      const convex = new ConvexHttpClient(url)
      const row = (await convex.query(api.telemetry.getLatestHeartbeat, {
        user_id: user.id,
      })) as { last_heartbeat_at?: number } | null
      if (!row?.last_heartbeat_at) return { last_heartbeat_at: null }
      return {
        last_heartbeat_at: new Date(row.last_heartbeat_at).toISOString(),
      }
    } catch {
      return null
    }
  }

  const [settingsRes, eventsRes, deviceRes, heartbeatPayload] = await Promise.all([
    (supabase as any)
      .from('clapcheeks_user_settings')
      .select(
        'tinder_auth_token,tinder_auth_token_updated_at,tinder_auth_token_expires_at,' +
          'hinge_auth_token,hinge_auth_token_updated_at,hinge_auth_token_expires_at,' +
          'bumble_session_expires_at',
      )
      .eq('user_id', user.id)
      .maybeSingle(),
    (supabase as any)
      .from('clapcheeks_ban_events')
      .select('platform,signal_type,severity,detected_at')
      .eq('user_id', user.id)
      .gte('detected_at', since)
      .order('detected_at', { ascending: false })
      .limit(50),
    (supabase as any)
      .from('devices')
      .select('last_seen_at,is_active')
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchHeartbeat(),
  ])

  const settings = (settingsRes.data as UserSettingsRow | null) ?? null
  const events = ((eventsRes.data as BanEventRow[] | null) ?? []) as BanEventRow[]
  const deviceRow = (deviceRes.data as DeviceRow | null) ?? null
  const heartbeatRow = heartbeatPayload

  // Compose a unified device view: take the freshest last_seen across both
  // sources.  Treat a fresh heartbeat as is_active=true (the daemon only
  // emits heartbeats while running).
  const candidates: { last_seen_at: string | null; is_active: boolean }[] = []
  if (deviceRow?.last_seen_at) candidates.push({ last_seen_at: deviceRow.last_seen_at, is_active: deviceRow.is_active ?? true })
  if (heartbeatRow?.last_heartbeat_at) candidates.push({ last_seen_at: heartbeatRow.last_heartbeat_at, is_active: true })
  const device: DeviceRow | null = candidates.length
    ? candidates.reduce((best, c) =>
        new Date(c.last_seen_at!).getTime() > new Date(best.last_seen_at!).getTime() ? c : best,
      ) as DeviceRow
    : null

  const pills: Pill[] = [
    pillForPlatform('tinder', settings, events),
    pillForPlatform('hinge', settings, events),
    pillForPlatform('bumble', settings, events),
    pillForAgent(device),
    // Presence isn't yet stored in Supabase — read-only "AT HOME" placeholder
    // so the bar layout matches the spec. Wire to a future presence table
    // once `agent/clapcheeks/safety/presence.py` posts heartbeats.
    pillForPresence('AT HOME'),
  ]

  // Don't render the bar at all if nothing is connected and no signals — keeps
  // brand-new users from seeing a wall of gray pills before setup.
  const hasAnyConnection = pills
    .slice(0, 3)
    .some((p) => p.color !== 'gray')
  if (!hasAnyConnection && !device) {
    return null
  }

  return (
    <div
      className="sticky top-0 z-30 border-b border-white/10 bg-black/60 backdrop-blur"
      data-testid="connection-bar"
    >
      <div className="px-4 py-2 flex items-center gap-2 overflow-x-auto">
        {pills.map((pill) => (
          <Link
            key={pill.label}
            href={pill.href}
            className={
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ' +
              'whitespace-nowrap transition hover:opacity-80 ' +
              colorClasses(pill.color)
            }
          >
            <span aria-hidden className="text-[10px]">
              {pill.icon}
            </span>
            <span>{pill.label}</span>
            {pill.detail && (
              <span className="opacity-70 font-normal">{pill.detail}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
