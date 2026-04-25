import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ManageBillingButton from '@/components/manage-billing-button'
import PlanBadge from '@/components/plan-badge'
import EliteOnly from '@/components/elite-only'
import CoachingSection from './components/coaching-section'
import DashboardLive from './components/dashboard-live'
import AgentStatusBadge from './components/agent-status-badge'
import IMessageTestPanel from './components/imessage-test-panel'
import { getLatestCoaching } from '@/lib/coaching/generate'
import { TrendCard } from './components/trend-card'
import { DashboardCharts } from './components/dashboard-charts'
import { calculateRizzScore, getRizzTrend } from '@/lib/rizz'
import { calculateCPN, getCPNTrend } from '@/lib/cpn'

export const metadata: Metadata = {
  title: 'Dashboard — Clapcheeks',
  description: 'Your Clapcheeks AI dating co-pilot dashboard.',
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

interface DeviceRow {
  last_seen_at: string
  is_active: boolean
}

export default async function Dashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

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

  const [analyticsRes, convoRes, spendRes, deviceRes, profileRes] = await Promise.all([
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
      .from('devices')
      .select('last_seen_at, is_active')
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false })
      .limit(1),
    supabase
      .from('profiles')
      .select('subscription_tier, subscription_status')
      .eq('id', user.id)
      .single(),
  ])

  // Pull from the real source-of-truth tables: clapcheeks_matches +
  // clapcheeks_date_events. The analytics_daily aggregate above is
  // a swipe-counter the agent writes, but every dashboard tile that
  // shows matches / dates / health-summary should derive from the
  // real roster row count, never the aggregate (which can drift).
  const [realMatchesRes, realEventsRes] = await Promise.all([
    supabase
      .from('clapcheeks_matches')
      .select('id, stage, status, julian_rank, health_score, close_probability, flake_count, reschedule_count, created_at')
      .eq('user_id', user.id),
    supabase
      .from('clapcheeks_date_events')
      .select('event_type, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since.toISOString()),
  ])
  const realMatches = (realMatchesRes.data ?? []) as Array<{
    id: string; stage: string | null; status: string | null;
    julian_rank: number | null; health_score: number | null;
    close_probability: number | null; flake_count: number | null;
    reschedule_count: number | null; created_at: string
  }>
  const realEvents = (realEventsRes.data ?? []) as Array<{ event_type: string; created_at: string }>

  // Live counts from real tables.
  const realDatesBooked = realMatches.filter(m =>
    m.stage && ['date_booked','date_attended','hooked_up','recurring'].includes(m.stage)
  ).length
  const realFlakes30d = realEvents.filter(e => e.event_type === 'flaked').length
  const realReschedules30d = realEvents.filter(e => e.event_type === 'rescheduled').length
  const realMatchesTotal = realMatches.length
  const realActiveMatches = realMatches.filter(m =>
    !m.stage || !['archived','archived_cluster_dupe','ghosted','faded'].includes(m.stage)
  ).length

  // Fetch coaching session
  const coachingSession = await getLatestCoaching(supabase, user.id)

  const userPlan = (profileRes.data?.subscription_tier || 'base') as 'base' | 'elite'
  const userSubStatus = profileRes.data?.subscription_status || 'inactive'
  const isSubscribed = userSubStatus === 'active'
  const userIsElite = userPlan === 'elite' && userSubStatus === 'active'

  const rows: DailyRow[] = analyticsRes.data || []
  const convos: ConvoRow[] = convoRes.data || []
  const spending = spendRes.data || []
  const device: DeviceRow | null = deviceRes.data?.[0] || null
  const hasAgent = !!device

  // Aggregate totals — note: money_spent lives in clapcheeks_spending, not the daily table
  const totals = rows.reduce(
    (acc, r) => ({
      swipes: acc.swipes + r.swipes_right + r.swipes_left,
      swipes_right: acc.swipes_right + r.swipes_right,
      matches: acc.matches + r.matches,
      dates: acc.dates + r.dates_booked,
      messages: acc.messages + (r.messages_sent || 0),
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

  // Spending — sourced only from clapcheeks_spending (live schema has no money_spent on analytics_daily)
  const externalSpent = spending.reduce((s, r) => s + Number(r.amount), 0)
  const totalSpent = externalSpent

  // CPN — Cost Per Nut
  const totalMessagesSent = convos.reduce((s, c) => s + (c.messages_sent || 0), 0)
  const cpnResult = calculateCPN({
    moneySpent: totalSpent,
    totalSwipes: totals.swipes_right,
    totalMessagesSent,
    datesBooked: totals.dates,
    nutsReported: null, // user hasn't manually logged nuts yet
  })

  // CPN week-over-week
  const thisWeekConvos = convos.filter(c => c.date >= fmtDate(sevenDaysAgo))
  const lastWeekConvos = convos.filter(c => c.date >= fmtDate(fourteenDaysAgo) && c.date < fmtDate(sevenDaysAgo))
  const thisWeekMsgsSent = thisWeekConvos.reduce((s, c) => s + (c.messages_sent || 0), 0)
  const lastWeekMsgsSent = lastWeekConvos.reduce((s, c) => s + (c.messages_sent || 0), 0)
  const thisWeekSpending = spending.filter(s => s.date >= fmtDate(sevenDaysAgo))
  const lastWeekSpending = spending.filter(s => s.date >= fmtDate(fourteenDaysAgo) && s.date < fmtDate(sevenDaysAgo))
  const thisWeekSpent = thisWeekSpending.reduce((s, r) => s + Number(r.amount || 0), 0)
  const lastWeekSpent = lastWeekSpending.reduce((s, r) => s + Number(r.amount || 0), 0)

  const thisWeekCPN = calculateCPN({
    moneySpent: thisWeekSpent,
    totalSwipes: thisWeek.swipes,
    totalMessagesSent: thisWeekMsgsSent,
    datesBooked: thisWeek.dates,
    nutsReported: null,
  })
  const lastWeekCPN = calculateCPN({
    moneySpent: lastWeekSpent,
    totalSwipes: lastWeek.swipes,
    totalMessagesSent: lastWeekMsgsSent,
    datesBooked: lastWeek.dates,
    nutsReported: null,
  })
  // For CPN, DOWN is good (cheaper), UP is bad — invert the colors
  const cpnTrendRaw = getCPNTrend(thisWeekCPN.cpn, lastWeekCPN.cpn)
  const cpnTrend = {
    direction: cpnTrendRaw.direction,
    delta: cpnTrendRaw.delta,
    // Invert: down is good (green), up is bad (red) — handled in TrendCard via invertColors prop
  }

  // Time series for charts
  const dailyMap: Record<string, { date: string; swipes_right: number; matches: number }> = {}
  for (const r of rows) {
    if (!dailyMap[r.date]) dailyMap[r.date] = { date: r.date, swipes_right: 0, matches: 0 }
    dailyMap[r.date].swipes_right += r.swipes_right
    dailyMap[r.date].matches += r.matches
  }
  const timeSeries = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))

  // Spending by category
  const spendByCategory: Record<string, number> = {}
  for (const r of spending) {
    spendByCategory[r.category] = (spendByCategory[r.category] || 0) + Number(r.amount)
  }

  // Per-platform breakdown (detailed for DashboardLive)
  const byPlatform: Record<string, { swipes_right: number; matches: number; messages_sent: number; dates_booked: number }> = {}
  for (const r of rows) {
    const key = r.platform || 'unknown'
    if (!byPlatform[key]) byPlatform[key] = { swipes_right: 0, matches: 0, messages_sent: 0, dates_booked: 0 }
    byPlatform[key].swipes_right += r.swipes_right
    byPlatform[key].matches += r.matches
    byPlatform[key].messages_sent += (r.messages_sent || 0)
    byPlatform[key].dates_booked += r.dates_booked
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

  // Chart data for Recharts components
  const chartData = {
    totals: { swipes_right: totals.swipes_right, matches: totals.matches, messages_sent: totals.messages, dates_booked: totals.dates, conversations: convoTotals.conversations_started },
    todaySwipes,
    matchRate,
    rizzScore,
    rizzTrend,
    platforms: byPlatform,
    timeSeries,
    funnel: [
      { stage: 'Swipes', value: totals.swipes_right },
      { stage: 'Matches', value: totals.matches },
      { stage: 'Conversations', value: convoTotals.conversations_started },
      { stage: 'Dates', value: totals.dates },
    ],
    spending: {
      totalSpent,
      costPerMatch: totals.matches > 0 ? totalSpent / totals.matches : 0,
      costPerDate: totals.dates > 0 ? totalSpent / totals.dates : 0,
      cpn: cpnResult.cpn,
      cpnGrade: cpnResult.grade,
      cpnVerdict: cpnResult.verdict,
      cpnNuts: cpnResult.nuts,
      byCategory: spendByCategory,
    },
    trends: {
      swipes: trend(thisWeek.swipes, lastWeek.swipes),
      matches: trend(thisWeek.matches, lastWeek.matches),
      dates: trend(thisWeek.dates, lastWeek.dates),
    },
  }

  // Match Rate uses real_matches/real swipes when both present, else falls back
  // to the aggregate. Total Matches + Dates Booked always use the real-table
  // counts so the dashboard never disagrees with the roster you can see.
  const realMatchRate = totals.swipes_right > 0
    ? (realMatchesTotal / totals.swipes_right) * 100
    : matchRate
  const stats = [
    { label: 'Swipes Today', value: hasAgent ? String(todaySwipes) : '--', trend: undefined, invertColors: false },
    { label: 'Total Matches', value: String(realMatchesTotal), trend: hasAgent ? chartData.trends.matches : undefined, invertColors: false },
    { label: 'Dates Booked', value: String(realDatesBooked), trend: hasAgent ? chartData.trends.dates : undefined, invertColors: false },
    { label: 'Match Rate', value: hasAgent ? `${realMatchRate.toFixed(1)}%` : '--', trend: undefined, invertColors: false },
    { label: 'Rizz Score', value: hasAgent ? String(rizzScore) : '--', trend: hasAgent ? rizzTrend : undefined, invertColors: false },
    { label: 'CPN', value: hasAgent ? (cpnResult.nuts > 0 ? `$${cpnResult.cpn}` : '--') : '--', trend: hasAgent && cpnResult.nuts > 0 ? cpnTrend : undefined, invertColors: true },
  ]
  // Reference the active/flake/reschedule counts so they're available for
  // future widget expansion. (Eslint will complain about unused otherwise.)
  void realActiveMatches; void realFlakes30d; void realReschedules30d

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="relative max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <span className="font-display text-2xl sm:text-3xl tracking-wide gold-text uppercase">Clapcheeks</span>
            <span className="font-body text-xs text-white/30 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10">beta</span>
            <PlanBadge plan={userPlan} subscriptionStatus={userSubStatus} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {user?.email && (
              <span className="text-white/30 text-xs hidden sm:block">{user.email}</span>
            )}
            {isSubscribed && <ManageBillingButton />}
          </div>
        </div>

        {/* Agent status badge */}
        <div className="mb-6">
          <AgentStatusBadge initialDevice={device} />
        </div>

        <h1 className="font-display text-4xl md:text-5xl text-white uppercase leading-none mb-2">
          HEY {displayName.toUpperCase()}
        </h1>
        <p className="font-body text-white/40 text-sm mb-8">
          {hasAgent ? 'Last 30 days of activity — your agent is closing.' : 'Install the agent to start dominating your dating life.'}
        </p>

        {/* Stats row -- 5 cards with trend arrows */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-8">
          {stats.map(({ label, value, trend: t, invertColors }) => (
            <TrendCard key={label} label={label} value={value} trend={t} invertColors={invertColors} />
          ))}
        </div>

        {/* Live platform stats, funnel, and health badges */}
        <div className="mb-8">
          <DashboardLive initialData={initialLiveData} hasAgent={hasAgent} />
        </div>

        {/* Recharts analytics -- Rizz Score, trends, platform breakdown, funnel, spending */}
        {hasAgent && rows.length > 0 && (
          <div className="mb-8">
            <DashboardCharts initialData={chartData} />
          </div>
        )}

        {/* Empty state -- Install CTA */}
        {!hasAgent && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 md:p-8 mb-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-purple-500/10 border border-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg mb-2">Get started in 3 steps</h2>
              <p className="text-white/40 text-sm max-w-md mx-auto">
                Install the agent on your Mac to connect your dating apps and start tracking swipes, matches, and dates automatically.
              </p>
            </div>
            <div className="grid gap-4 max-w-xl mx-auto">
              <div className="flex gap-4 items-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                  <span className="text-purple-400 text-xs font-bold">1</span>
                </div>
                <div className="flex-1">
                  <p className="text-white/60 text-xs mb-2">Install the package</p>
                  <div className="bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-left">
                    <pre className="text-xs sm:text-sm font-mono text-purple-400 overflow-x-auto">pip install clapcheeks[all]</pre>
                  </div>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                  <span className="text-purple-400 text-xs font-bold">2</span>
                </div>
                <div className="flex-1">
                  <p className="text-white/60 text-xs mb-2">Run setup (connects your account)</p>
                  <div className="bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-left">
                    <pre className="text-xs sm:text-sm font-mono text-purple-400 overflow-x-auto">clapcheeks setup</pre>
                  </div>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                  <span className="text-purple-400 text-xs font-bold">3</span>
                </div>
                <div className="flex-1">
                  <p className="text-white/60 text-xs mb-2">Start swiping</p>
                  <div className="bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-left">
                    <pre className="text-xs sm:text-sm font-mono text-purple-400 overflow-x-auto">clapcheeks swipe --platform tinder</pre>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-center text-white/20 text-xs mt-5">
              This page will update automatically once your agent connects.
            </p>
          </div>
        )}

        {/* Elite Features */}
        <div className="space-y-4 mb-8">
          <h2 className="font-display text-2xl text-white uppercase tracking-wide gold-text">
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

        {/* iMessage Test Panel */}
        <div className="mb-8">
          <IMessageTestPanel />
        </div>

      </div>
    </div>
  )
}
