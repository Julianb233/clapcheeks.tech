/**
 * /intel/health — Account Health Intelligence (AI-8764)
 *
 * Per-platform health cards + 30d ban_events timeline + recent error rate +
 * swipe ratio + warm-up day + remediation action items.
 *
 * Reads from:
 *   - clapcheeks_user_settings (token presence + expiry)
 *   - clapcheeks_ban_events    (30d timeline, severity counts)
 *   - clapcheeks_swipe_decisions (swipe ratio)
 *   - clapcheeks_usage_daily   (recent error rate proxy)
 *   - profiles.created_at       (account age → warm-up day)
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Account Health — Clapcheeks',
  description:
    'Token expiry, ban risk, and remediation guidance for every connected dating platform.',
}

const PLATFORMS: Array<{
  key: 'tinder' | 'hinge' | 'bumble'
  label: string
  tokenColumn: string | null
  expiresColumn: string
}> = [
  {
    key: 'tinder',
    label: 'Tinder',
    tokenColumn: 'tinder_auth_token',
    expiresColumn: 'tinder_auth_token_expires_at',
  },
  {
    key: 'hinge',
    label: 'Hinge',
    tokenColumn: 'hinge_auth_token',
    expiresColumn: 'hinge_auth_token_expires_at',
  },
  {
    key: 'bumble',
    label: 'Bumble',
    // Bumble session is opaque — we only track expiry, not the cookie itself
    tokenColumn: null,
    expiresColumn: 'bumble_session_expires_at',
  },
]

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const WARMUP_DAYS = 14

interface BanEvent {
  id?: string
  platform: string
  signal_type: string
  severity: 'info' | 'warn' | 'critical'
  payload: Record<string, unknown>
  detected_at: string
}

interface SwipeRow {
  decision: string | null  // 'right' | 'left' | 'super' etc.
  platform?: string
  created_at: string
}

function classifyHealth(args: {
  hasToken: boolean
  expiresAt: Date | null
  events30d: BanEvent[]
}): {
  status: 'healthy' | 'warning' | 'critical' | 'not-connected'
  label: string
  detail: string
  actionItems: string[]
} {
  const { hasToken, expiresAt, events30d } = args
  const now = Date.now()
  const actionItems: string[] = []

  if (!hasToken) {
    return {
      status: 'not-connected',
      label: 'Not connected',
      detail: 'No token on file. Connect this platform to enable automation.',
      actionItems: [
        'Open the Chrome extension while logged into the platform to push your token.',
        'Or run `clapcheeks login <platform>` from the terminal.',
      ],
    }
  }

  const expired = expiresAt ? expiresAt.getTime() <= now : false
  const expiresWithin7d = expiresAt
    ? !expired && expiresAt.getTime() - now < SEVEN_DAYS_MS
    : false

  const critical24h = events30d.filter(
    (e) => e.severity === 'critical' && now - new Date(e.detected_at).getTime() < ONE_DAY_MS,
  )
  const warn24h = events30d.filter(
    (e) => e.severity === 'warn' && now - new Date(e.detected_at).getTime() < ONE_DAY_MS,
  )

  if (expired) {
    actionItems.push(
      'Re-capture your token via the Chrome extension or `clapcheeks login`.',
    )
  }
  if (critical24h.length > 0) {
    actionItems.push(
      'Pause this platform for at least 24 hours and review recent activity.',
    )
    actionItems.push(
      'Check `agent/clapcheeks/safety/ban_monitor.py` logs for the originating signal.',
    )
  }
  if (expiresWithin7d) {
    actionItems.push(
      'Refresh the token before it expires to avoid an automation gap.',
    )
  }
  if (warn24h.length >= 3) {
    actionItems.push(
      'Reduce daily swipe volume by 50% for 48 hours — soft-ban risk is elevated.',
    )
  }

  if (expired || critical24h.length > 0) {
    return {
      status: 'critical',
      label: expired ? 'Token expired' : 'Critical signals (last 24h)',
      detail: expired
        ? 'Re-authentication required.'
        : `${critical24h.length} critical signal${critical24h.length === 1 ? '' : 's'} captured in the last day.`,
      actionItems,
    }
  }
  if (expiresWithin7d || warn24h.length >= 3) {
    return {
      status: 'warning',
      label: expiresWithin7d ? 'Token expiring soon' : 'Elevated risk',
      detail: expiresWithin7d
        ? `Expires ${expiresAt!.toLocaleDateString()}`
        : `${warn24h.length} warning signals in the last 24h.`,
      actionItems,
    }
  }

  return {
    status: 'healthy',
    label: 'Healthy',
    detail: 'No risk signals in the last 24 hours.',
    actionItems: [],
  }
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-900/30 text-green-300 border-green-700/40'
    case 'warning':
      return 'bg-amber-900/20 text-amber-300 border-amber-500/40'
    case 'critical':
      return 'bg-red-900/30 text-red-300 border-red-700/40'
    case 'not-connected':
    default:
      return 'bg-white/5 text-white/40 border-white/10'
  }
}

function severityBadgeClasses(sev: string): string {
  switch (sev) {
    case 'critical':
      return 'bg-red-900/30 text-red-300 border-red-700/40'
    case 'warn':
      return 'bg-amber-900/20 text-amber-300 border-amber-500/40'
    case 'info':
    default:
      return 'bg-white/5 text-white/40 border-white/10'
  }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function humanSignal(signal: string): string {
  const map: Record<string, string> = {
    http_403: 'HTTP 403 (banned/forbidden)',
    http_451: 'HTTP 451 (legal hold)',
    http_429: 'HTTP 429 (rate limited)',
    http_401: 'HTTP 401 (token rejected)',
    token_expired: 'Token expired',
    json_pattern_hard: 'Hard-ban code in response body',
    json_pattern_soft: 'Soft-ban code in response body',
    persistent_rate_limit: 'Persistent rate limiting',
    match_rate_drop: 'Match rate dropped sharply',
    likes_you_freeze: 'Likes-You queue frozen',
    send_failure: 'Send failure',
    recaptcha: 'reCAPTCHA challenge shown',
    shadowban_suspected: 'Shadowban suspected',
    error_keyword: 'Error message mentions ban',
  }
  return map[signal] ?? signal
}

export default async function IntelHealthPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const since30d = new Date(Date.now() - THIRTY_DAYS_MS).toISOString()

  const [settingsRes, eventsRes, swipesRes, usageRes, profileRes] =
    await Promise.all([
      (supabase as any)
        .from('clapcheeks_user_settings')
        .select(
          'tinder_auth_token,tinder_auth_token_expires_at,' +
            'hinge_auth_token,hinge_auth_token_expires_at,' +
            'bumble_session_expires_at',
        )
        .eq('user_id', user.id)
        .maybeSingle(),
      (supabase as any)
        .from('clapcheeks_ban_events')
        .select('id,platform,signal_type,severity,payload,detected_at')
        .eq('user_id', user.id)
        .gte('detected_at', since30d)
        .order('detected_at', { ascending: false })
        .limit(200),
      (supabase as any)
        .from('clapcheeks_swipe_decisions')
        .select('decision,platform,created_at')
        .eq('user_id', user.id)
        .gte('created_at', new Date(Date.now() - SEVEN_DAYS_MS).toISOString())
        .limit(2000),
      (supabase as any)
        .from('clapcheeks_usage_daily')
        .select('date,swipes_used,ai_replies_used')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .limit(7),
      supabase
        .from('profiles')
        .select('created_at')
        .eq('id', user.id)
        .maybeSingle(),
    ])

  const settings = (settingsRes.data as Record<string, string | null> | null) ?? {}
  const events: BanEvent[] = (eventsRes.data as BanEvent[] | null) ?? []
  const swipes: SwipeRow[] = (swipesRes.data as SwipeRow[] | null) ?? []
  const usage = ((usageRes.data as Array<{ date: string; swipes_used: number; ai_replies_used: number }> | null) ??
    []) as Array<{ date: string; swipes_used: number; ai_replies_used: number }>
  const profileCreatedAt =
    (profileRes.data as { created_at?: string } | null)?.created_at ??
    user.created_at ??
    null

  // ── Account age + warm-up day ─────────────────────────────────────────────
  const accountAgeDays = profileCreatedAt
    ? Math.floor((Date.now() - new Date(profileCreatedAt).getTime()) / ONE_DAY_MS)
    : null
  const inWarmup = accountAgeDays !== null && accountAgeDays < WARMUP_DAYS
  const warmupDay = accountAgeDays !== null ? Math.max(1, accountAgeDays + 1) : null

  // ── Per-platform health classification ────────────────────────────────────
  const platformHealth = PLATFORMS.map((p) => {
    const tokenColumn = p.tokenColumn
    const hasToken = tokenColumn ? Boolean(settings[tokenColumn]) : Boolean(settings[p.expiresColumn])
    const expiresRaw = settings[p.expiresColumn]
    const expiresAt = expiresRaw ? new Date(expiresRaw) : null
    const events30d = events.filter((e) => e.platform === p.key)
    const health = classifyHealth({ hasToken, expiresAt, events30d })
    return {
      ...p,
      hasToken,
      expiresAt,
      events30d,
      health,
    }
  })

  // ── Recent error rate (proxy: warn+critical events vs total automation) ─
  const events24h = events.filter(
    (e) => Date.now() - new Date(e.detected_at).getTime() < ONE_DAY_MS,
  )
  const swipesLast24h = swipes.filter(
    (s) => Date.now() - new Date(s.created_at).getTime() < ONE_DAY_MS,
  ).length
  // Use max(swipes, 1) so rate is bounded; 0 swipes + N events = treat as N events / 0
  const errorRate24h =
    swipesLast24h > 0 ? events24h.filter((e) => e.severity !== 'info').length / swipesLast24h : null

  // ── Swipe ratio (right vs total) ────────────────────────────────────────
  const totalSwipes = swipes.length
  const rightSwipes = swipes.filter((s) => (s.decision || '').toLowerCase() === 'right').length
  const swipeRatio = totalSwipes > 0 ? rightSwipes / totalSwipes : null

  // ── Aggregate action items across platforms ──────────────────────────────
  const aggregatedActions = platformHealth
    .filter((p) => p.health.status === 'critical' || p.health.status === 'warning')
    .flatMap((p) => p.health.actionItems.map((a) => ({ platform: p.label, action: a })))

  return (
    <div className="px-4 py-8 sm:px-8 lg:px-12 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Account Health</h1>
        <p className="text-white/60 text-sm">
          Token expiry, ban risk signals, and remediation guidance for every connected
          platform. Data updates as your local agent reports signals.
        </p>
      </div>

      {/* Action items banner */}
      {aggregatedActions.length > 0 && (
        <section className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-900/10 p-5">
          <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wider mb-3">
            Action items
          </h2>
          <ul className="space-y-2">
            {aggregatedActions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                <span className="text-amber-400 shrink-0">•</span>
                <span>
                  <span className="text-amber-300 font-medium">{a.platform}:</span>{' '}
                  {a.action}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Per-platform health cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {platformHealth.map((p) => (
          <div
            key={p.key}
            className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{p.label}</h3>
                <span
                  className={
                    'inline-flex items-center mt-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ' +
                    statusBadgeClasses(p.health.status)
                  }
                >
                  {p.health.label}
                </span>
              </div>
              <Link
                href="/device"
                className="text-xs text-purple-400 hover:text-purple-300 underline underline-offset-2"
              >
                Re-auth
              </Link>
            </div>
            <p className="text-xs text-white/50 mb-3">{p.health.detail}</p>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-white/40">Token</dt>
                <dd className="text-white/70">
                  {p.hasToken ? 'On file' : 'Not connected'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Expires</dt>
                <dd className="text-white/70">
                  {p.expiresAt
                    ? p.expiresAt.toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'unknown'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Events (30d)</dt>
                <dd className="text-white/70">{p.events30d.length}</dd>
              </div>
            </dl>
          </div>
        ))}
      </section>

      {/* Stats row: error rate + swipe ratio + warm-up */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-5">
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-2">
            Error rate (24h)
          </h3>
          <p className="text-3xl font-bold text-white">
            {errorRate24h === null
              ? '—'
              : `${(errorRate24h * 100).toFixed(1)}%`}
          </p>
          <p className="text-xs text-white/40 mt-2">
            warn + critical events ÷ swipes in last 24h
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-5">
          <h3 className="text-xs uppercase tracking-wider text-white/40 mb-2">
            Swipe ratio (7d)
          </h3>
          <p className="text-3xl font-bold text-white">
            {swipeRatio === null ? '—' : `${(swipeRatio * 100).toFixed(0)}%`}
          </p>
          <p className="text-xs text-white/40 mt-2">
            right swipes ÷ total ({totalSwipes} swipes)
          </p>
        </div>
        {inWarmup ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-900/10 p-5">
            <h3 className="text-xs uppercase tracking-wider text-amber-300 mb-2">
              Warm-up period
            </h3>
            <p className="text-3xl font-bold text-white">
              Day {warmupDay} / {WARMUP_DAYS}
            </p>
            <p className="text-xs text-white/60 mt-2">
              Account is &lt; {WARMUP_DAYS} days old. Keep automation gentle to avoid
              early shadowbans.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-5">
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-2">
              Account age
            </h3>
            <p className="text-3xl font-bold text-white">
              {accountAgeDays !== null ? `${accountAgeDays}d` : '—'}
            </p>
            <p className="text-xs text-white/40 mt-2">
              Past warm-up window — full automation safe.
            </p>
          </div>
        )}
      </section>

      {/* 30-day timeline */}
      <section className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-5">
        <h2 className="text-lg font-semibold text-white mb-4">
          Ban-risk timeline (last 30 days)
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-white/40">
            No ban-risk signals captured in the last 30 days. Nice work — keep an eye on
            the daily error rate above.
          </p>
        ) : (
          <ul className="space-y-2">
            {events.map((e, idx) => (
              <li
                key={e.id ?? `${e.platform}-${e.detected_at}-${idx}`}
                className="flex items-start gap-3 py-2 border-b border-white/5 last:border-b-0"
              >
                <span
                  className={
                    'shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ' +
                    severityBadgeClasses(e.severity)
                  }
                >
                  {e.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/80">
                    <span className="font-medium capitalize">{e.platform}</span>
                    {' — '}
                    {humanSignal(e.signal_type)}
                  </p>
                  {e.payload && typeof e.payload === 'object' &&
                    'details' in e.payload &&
                    typeof (e.payload as { details: unknown }).details === 'string' && (
                      <p className="text-xs text-white/40 mt-0.5 truncate">
                        {(e.payload as { details: string }).details}
                      </p>
                    )}
                </div>
                <span className="shrink-0 text-xs text-white/40">
                  {formatRelative(e.detected_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer pointer to docs */}
      <p className="mt-8 text-xs text-white/30">
        Signals are captured by{' '}
        <code className="font-mono bg-white/5 px-1 rounded">
          agent/clapcheeks/safety/ban_monitor.py
        </code>{' '}
        on your local machine and persisted to{' '}
        <code className="font-mono bg-white/5 px-1 rounded">clapcheeks_ban_events</code>.
        Recent error counts in the last 7 days of usage:{' '}
        {usage.map((u, i) => (
          <span key={u.date}>
            {i > 0 ? ', ' : ''}
            {u.date} ({u.swipes_used} swipes)
          </span>
        ))}
        .
      </p>
    </div>
  )
}
