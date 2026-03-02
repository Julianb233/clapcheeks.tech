import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/auth/actions'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ManageBillingButton from '@/components/manage-billing-button'
import PlanBadge from '@/components/plan-badge'
import EliteOnly from '@/components/elite-only'
import CoachingSection from './components/coaching-section'
import DashboardLive from './components/dashboard-live'
import { getLatestCoaching } from '@/lib/coaching/generate'
import { TrendCard } from './components/trend-card'
import { DashboardCharts } from './components/dashboard-charts'
import { calculateRizzScore, getRizzTrend } from '@/lib/rizz'

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

interface ConvoRow {
  platform: string
  messages_sent: number
  conversations_started: number
  conversations_replied: number
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
  const supabase = await createClient()
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

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  const [analyticsRes, convoRes, spendRes, tokenRes, subRes, profileRes] = await Promise.all([
    supabase
      .from('clapcheeks_analytics_daily')
      .select('platform, swipes_right, swipes_left, matches, messages_sent, dates_booked, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr)
      .order('date', { ascending: true }),
    supabase
      .from('clapcheeks_conversation_stats')
      .select('platform, messages_sent, conversations_started, conversations_replied, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr)
      .order('date', { ascending: true }),
    supabase
      .from('clapcheeks_spending')
      .select('amount, category, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr),
    supabase
      .from('clapcheeks_agent_tokens')
      .select('last_seen_at')
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false })
      .limit(1),
    supabase
      .from('clapcheeks_subscriptions')
      .select('subscription_status')
      .eq('user_id', user.id)
      .limit(1)
      .single(),
    supabase
      .from('profiles')
      .select('plan, subscription_status')
      .eq('id', user.id)
      .single(),
  ])

  // Fetch coaching session
  const coachingSession = await getLatestCoaching(supabase, user.id)

  const isSubscribed = subRes.data?.subscription_status === 'active'
  const userPlan = (profileRes.data?.plan || 'base') as 'base' | 'elite'
  const userSubStatus = profileRes.data?.subscription_status || 'inactive'
  const userIsElite = userPlan === 'elite' && userSubStatus === 'active'

  const rows: DailyRow[] = analyticsRes.data || []
  const convos: ConvoRow[] = convoRes.data || []
  const spending = spendRes.data || []
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
  const convoTotals = convos.reduce(
    (acc, r) => ({
      conversations_started: acc.conversations_started + (r.conversations_started || 0),
      conversations_replied: acc.conversations_replied + (r.conversations_replied || 0),
    }),
    { conversations_started: 0, conversations_replied: 0 }
  )
  const matchRate = totals.swipes_right > 0 ? (totals.matches / totals.swipes_right) * 100 : 0

  // Today's stats
  const todayRows = rows.filter((r) => r.date === today)
  const todaySwipes = todayRows.reduce((a, r) => a + r.swipes_right + r.swipes_left, 0)

  // Week-over-week trends
  const fmtDate = (d: Date) => d.toISOString().split('T')[0]
  const thisWeekRows = rows.filter(r => r.date >= fmtDate(sevenDaysAgo))
  const lastWeekRows = rows.filter(r => r.date >= fmtDate(fourteenDaysAgo) && r.date < fmtDate(sevenDaysAgo))

  function weekTotal(wRows: DailyRow[]) {
    return wRows.reduce(
      (acc, r) => ({ swipes: acc.swipes + r.swipes_right, matches: acc.matches + r.matches, dates: acc.dates + r.dates_booked }),
      { swipes: 0, matches: 0, dates: 0 }
    )
  }
  const thisWeek = weekTotal(thisWeekRows)
  const lastWeek = weekTotal(lastWeekRows)

  function trend(curr: number, prev: number) {
    if (prev === 0) return { direction: curr > 0 ? 'up' as const : 'same' as const, delta: curr > 0 ? 100 : 0 }
    const pct = Math.round(((curr - prev) / prev) * 100)
    if (Math.abs(pct) < 2) return { direction: 'same' as const, delta: 0 }
    return { direction: pct > 0 ? 'up' as const : 'down' as const, delta: pct }
  }

  // Rizz Score
  const rizzRows = (thisWeekRows.length > 0 ? thisWeekRows : rows).map(r => ({
    swipes_right: r.swipes_right,
    matches: r.matches,
    messages_sent: r.messages_sent,
    conversations_replied: convos.filter(c => c.date === r.date).reduce((s, c) => s + (c.conversations_replied || 0), 0),
    dates_booked: r.dates_booked,
  }))
  const lastWeekRizzRows = lastWeekRows.map(r => ({
    swipes_right: r.swipes_right,
    matches: r.matches,
    messages_sent: r.messages_sent,
    conversations_replied: convos.filter(c => c.date === r.date).reduce((s, c) => s + (c.conversations_replied || 0), 0),
    dates_booked: r.dates_booked,
  }))
  const rizzScore = calculateRizzScore(rizzRows)
  const rizzTrend = getRizzTrend(rizzScore, calculateRizzScore(lastWeekRizzRows))

  // Time series for charts
  const dailyMap: Record<string, { date: string; swipes_right: number; matches: number }> = {}
  for (const r of rows) {
    if (!dailyMap[r.date]) dailyMap[r.date] = { date: r.date, swipes_right: 0, matches: 0 }
    dailyMap[r.date].swipes_right += r.swipes_right
    dailyMap[r.date].matches += r.matches
  }
  const timeSeries = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))

  // Spending
  const totalSpent = spending.reduce((s, r) => s + Number(r.amount), 0)
  const spendByCategory: Record<string, number> = {}
  for (const r of spending) {
    spendByCategory[r.category] = (spendByCategory[r.category] || 0) + Number(r.amount)
  }

  // Per-platform breakdown (detailed for DashboardLive)
  const byPlatform: Record<string, { swipes_right: number; matches: number; messages_sent: number; dates_booked: number }> = {}
  for (const r of rows) {
    if (!byPlatform[r.platform]) byPlatform[r.platform] = { swipes_right: 0, matches: 0, messages_sent: 0, dates_booked: 0 }
    byPlatform[r.platform].swipes_right += r.swipes_right
    byPlatform[r.platform].matches += r.matches
    byPlatform[r.platform].messages_sent += r.messages_sent
    byPlatform[r.platform].dates_booked += r.dates_booked
  }

  // Build initial data for the live client component
  const initialLiveData = {
    totals: {
      swipes_right: totals.swipes_right,
      swipes_left: totals.swipes - totals.swipes_right,
      matches: totals.matches,
      messages_sent: totals.messages,
      dates_booked: totals.dates,
      conversations: totals.messages,
    },
    todaySwipes,
    platforms: byPlatform,
    funnel: [
      { stage: 'Swipes', value: totals.swipes_right },
      { stage: 'Matches', value: totals.matches },
      { stage: 'Conversations', value: totals.messages },
      { stage: 'Date-ready', value: Math.round(totals.messages * 0.3) },
      { stage: 'Dates Booked', value: totals.dates },
    ],
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
            <PlanBadge plan={userPlan} subscriptionStatus={userSubStatus} />
          </div>
          <div className="flex items-center gap-3">
            {user?.email && (
              <span className="text-white/30 text-xs hidden sm:block">{user.email}</span>
            )}
            <Link
              href="/conversation"
              className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Conversation AI
            </Link>
            <Link
              href="/billing"
              className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Billing
            </Link>
            {isSubscribed && <ManageBillingButton />}
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

        {/* Live platform stats, funnel, and health badges */}
        <div className="mb-8">
          <DashboardLive initialData={initialLiveData} hasAgent={hasAgent} />
        </div>

        {/* Elite Features */}
        <div className="space-y-4 mb-8">
          <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">
            Elite Features
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EliteOnly isElite={userIsElite} featureName="Autopilot">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-white font-semibold text-sm">Autopilot</h3>
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                </div>
                <p className="text-white/40 text-xs">Auto-swiping is active across all platforms.</p>
              </div>
            </EliteOnly>
            <EliteOnly isElite={userIsElite} featureName="Match Intel">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <h3 className="text-white font-semibold text-sm mb-2">Match Intel</h3>
                <p className="text-white/40 text-xs">Deep profile analysis on your latest matches.</p>
              </div>
            </EliteOnly>
            <EliteOnly isElite={userIsElite} featureName="Ghost Hunter">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <h3 className="text-white font-semibold text-sm mb-2">Ghost Hunter</h3>
                <p className="text-white/40 text-xs">Detect and re-engage inactive matches.</p>
              </div>
            </EliteOnly>
            <EliteOnly isElite={userIsElite} featureName="Date Closer">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <h3 className="text-white font-semibold text-sm mb-2">Date Closer</h3>
                <p className="text-white/40 text-xs">AI-assisted date scheduling and booking.</p>
              </div>
            </EliteOnly>
          </div>
        </div>

        {/* AI Coaching Section */}
        {hasAgent && (
          <div className="mb-8">
            <CoachingSection initialSession={coachingSession} />
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
