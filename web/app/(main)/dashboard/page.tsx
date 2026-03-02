import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/auth/actions'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Dashboard — Outward',
  description: 'Your Outward AI dating co-pilot dashboard.',
}

interface DailyRow {
  platform: string
  swipes_right: number
  swipes_left: number
  matches: number
  messages_sent: number
  dates_booked: number
  date: string
}

interface AgentToken {
  last_seen_at: string | null
}

function isAgentOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false
  const diff = Date.now() - new Date(lastSeen).getTime()
  return diff < 5 * 60 * 1000 // 5 minutes
}

export default async function Dashboard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const displayName =
    user?.user_metadata?.full_name ??
    user?.email?.split('@')[0] ??
    'there'

  // Fetch last 30 days of analytics
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const [analyticsRes, tokenRes] = await Promise.all([
    supabase
      .from('outward_analytics_daily')
      .select('platform, swipes_right, swipes_left, matches, messages_sent, dates_booked, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr)
      .order('date', { ascending: false }),
    supabase
      .from('outward_agent_tokens')
      .select('last_seen_at')
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false })
      .limit(1),
  ])

  const rows: DailyRow[] = analyticsRes.data || []
  const agentToken: AgentToken | null = tokenRes.data?.[0] || null
  const agentOnline = isAgentOnline(agentToken?.last_seen_at || null)
  const hasAgent = !!agentToken

  // Aggregate totals
  const totals = rows.reduce(
    (acc, r) => ({
      swipes: acc.swipes + r.swipes_right + r.swipes_left,
      swipes_right: acc.swipes_right + r.swipes_right,
      matches: acc.matches + r.matches,
      dates: acc.dates + r.dates_booked,
      messages: acc.messages + r.messages_sent,
    }),
    { swipes: 0, swipes_right: 0, matches: 0, dates: 0, messages: 0 }
  )
  const matchRate =
    totals.swipes_right > 0
      ? ((totals.matches / totals.swipes_right) * 100).toFixed(1)
      : '0.0'

  // Today's stats
  const todayRows = rows.filter((r) => r.date === today)
  const todaySwipes = todayRows.reduce((a, r) => a + r.swipes_right + r.swipes_left, 0)

  // Per-platform breakdown
  const byPlatform: Record<string, { swipes: number; matches: number }> = {}
  for (const r of rows) {
    if (!byPlatform[r.platform]) byPlatform[r.platform] = { swipes: 0, matches: 0 }
    byPlatform[r.platform].swipes += r.swipes_right
    byPlatform[r.platform].matches += r.matches
  }

  const stats = [
    { label: 'Swipes Today', value: hasAgent ? String(todaySwipes) : '—' },
    { label: 'Total Matches', value: hasAgent ? String(totals.matches) : '—' },
    { label: 'Dates Booked', value: hasAgent ? String(totals.dates) : '—' },
    { label: 'Match Rate', value: hasAgent ? `${matchRate}%` : '—' },
  ]

  return (
    <div className="min-h-screen bg-black px-6 py-8">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="orb w-96 h-96 bg-brand-600"
          style={{ top: '10%', left: '50%', transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold gradient-text">Outward</span>
            <span className="text-xs text-white/30 font-mono bg-white/5 px-2 py-0.5 rounded">beta</span>
          </div>
          <div className="flex items-center gap-3">
            {user?.email && (
              <span className="text-white/30 text-xs hidden sm:block">{user.email}</span>
            )}
            <form action={logout}>
              <button
                type="submit"
                className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Agent status badge */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`inline-flex items-center gap-2 border rounded-full px-4 py-1.5 ${
              agentOnline
                ? 'bg-green-900/30 border-green-700/40'
                : hasAgent
                ? 'bg-yellow-900/20 border-yellow-700/30'
                : 'bg-brand-900/40 border-brand-700/40'
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                agentOnline ? 'bg-green-400 animate-pulse' : hasAgent ? 'bg-yellow-400' : 'bg-brand-400 animate-pulse'
              }`}
            />
            <span
              className={`text-xs font-medium ${
                agentOnline ? 'text-green-300' : hasAgent ? 'text-yellow-300' : 'text-brand-300'
              }`}
            >
              {agentOnline ? 'Agent connected' : hasAgent ? 'Agent offline' : 'Local agent not detected'}
            </span>
          </div>
          {hasAgent && !agentOnline && (
            <span className="text-white/30 text-xs">Last seen: {agentToken?.last_seen_at ? new Date(agentToken.last_seen_at).toLocaleString() : 'never'}</span>
          )}
        </div>

        <h1 className="text-3xl font-bold text-white mb-2">
          Hey {displayName}
        </h1>
        <p className="text-white/40 text-sm mb-8">
          {hasAgent ? 'Last 30 days of activity' : 'Install the agent to start tracking your dating activity'}
        </p>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {stats.map(({ label, value }) => (
            <div
              key={label}
              className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"
            >
              <div className="text-2xl font-bold text-white mb-1">{value}</div>
              <div className="text-white/40 text-xs">{label}</div>
            </div>
          ))}
        </div>

        {/* Platform breakdown */}
        {hasAgent && Object.keys(byPlatform).length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-8">
            <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
              By Platform — Last 30 Days
            </h2>
            <div className="space-y-3">
              {Object.entries(byPlatform)
                .sort((a, b) => b[1].matches - a[1].matches)
                .map(([platform, data]) => (
                  <div key={platform} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-brand-500" />
                      <span className="text-white capitalize text-sm">{platform}</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="text-white/40">{data.swipes} swipes</span>
                      <span className="text-brand-400 font-medium">{data.matches} matches</span>
                      <span className="text-white/30 text-xs">
                        {data.swipes > 0 ? ((data.matches / data.swipes) * 100).toFixed(1) : '0.0'}% rate
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Install CTA — only show if no agent */}
        {!hasAgent && (
          <div className="bg-white/3 border border-white/8 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-2">Install the Outward agent</h2>
            <p className="text-white/40 text-sm mb-4">
              Run this command on your Mac to connect your dating apps.
            </p>
            <div className="code-block px-5 py-4 text-left">
              <p className="text-white/30 text-xs font-mono mb-2"># Install Outward on your Mac</p>
              <pre className="text-sm font-mono text-brand-400">
                curl -fsSL https://clapcheeks.tech/install.sh | bash
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
