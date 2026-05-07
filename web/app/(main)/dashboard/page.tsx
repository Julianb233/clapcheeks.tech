import type { Metadata } from 'next'
import { ConvexHttpClient } from 'convex/browser'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_analytics_daily + clapcheeks_device_heartbeats
// migrated to Convex.
import ManageBillingButton from '@/components/manage-billing-button'
import PlanBadge from '@/components/plan-badge'
import EliteOnly from '@/components/elite-only'
import DashboardLive from './components/dashboard-live'
import AgentStatusBadge from './components/agent-status-badge'
import BriefingCard from './components/briefing-card'
import { getLatestCoaching } from '@/lib/coaching/generate'
import { TrendCard } from './components/trend-card'
import { calculateRizzScore, getRizzTrend } from '@/lib/rizz'
import { calculateCPN, getCPNTrend } from '@/lib/cpn'
// AI-9500: route heavy below-the-fold components through client wrappers that
// use `next/dynamic` with `ssr:false` so Recharts (~250KB) and the iMessage
// test panel never enter the initial JS bundle. This RSC parent can't call
// `dynamic({ ssr: false })` directly in Next 15 — wrappers live as client
// components in `./components/lazy.tsx`.
import {
  DashboardChartsLazy,
  CoachingSectionLazy,
  IMessageTestPanelLazy,
} from './components/lazy'

export const metadata: Metadata = {
  title: 'Dashboard — Clapcheeks',
  description: 'Your Clapcheeks AI dating co-pilot dashboard.',
}

interface DailyRow {
  app: string
  swipes_right: number
  swipes_left: number
  matches: number
  conversations_started: number
  dates_booked: number
  money_spent: number
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

  // AI-9536/AI-9537: analytics_daily + device_heartbeats + devices are on
  // Convex. AI-9534: matches.countForUser too.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null

  const [analyticsRows, convoRes, spendRes, deviceRes, subRes, profileRes, heartbeatRow, matchCountRes] = await Promise.all([
    convex
      ? convex
          .query(api.telemetry.getDailyForUser, {
            user_id: user.id,
            since_day_iso: sinceStr,
          })
          .catch(() => [])
      : Promise.resolve([]),
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
      .from('clapcheeks_subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .limit(1)
      .single(),
    supabase
      .from('profiles')
      .select('subscription_tier, subscription_status')
      .eq('id', user.id)
      .single(),
    // AI-8926/AI-9536: modern device-presence source on Convex.
    convex
      ? convex
          .query(api.telemetry.getLatestHeartbeat, { user_id: user.id })
          .catch(() => null)
      : Promise.resolve(null),
    // AI-8926/AI-9534: actual matches count (analytics_daily can be empty
    // for users whose agent does not aggregate per-day yet). Reads from
    // Convex via api.matches.countForUser.
    convex
      ? convex.query(api.matches.countForUser, { user_id: user.id }).catch(() => 0)
      : Promise.resolve(0),
  ])

  // Map Convex rows (day_iso) into the legacy {date} shape that downstream
  // dashboard code expects.
  const analyticsRes = {
    data: ((analyticsRows as Array<{
      app: string
      day_iso: string
      swipes_right: number
      swipes_left: number
      matches: number
      conversations_started: number
      dates_booked: number
      money_spent: number
    }>) ?? [])
      .map((r) => ({
        app: r.app,
        swipes_right: r.swipes_right,
        swipes_left: r.swipes_left,
        matches: r.matches,
        conversations_started: r.conversations_started,
        dates_booked: r.dates_booked,
        money_spent: r.money_spent,
        date: r.day_iso,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }

  // Fetch coaching session
  const coachingSession = await getLatestCoaching(supabase, user.id)

  const isSubscribed = subRes.data?.status === 'active'
  const userPlan = (profileRes.data?.subscription_tier || 'base') as 'base' | 'elite'
  const userSubStatus = profileRes.data?.subscription_status || 'inactive'
  const userIsElite = userPlan === 'elite' && userSubStatus === 'active'

  const rows: DailyRow[] = analyticsRes.data || []
  const convos: ConvoRow[] = convoRes.data || []
  type SpendingRow = { amount: number | string; category: string; date: string }
  const spending: SpendingRow[] = (spendRes.data as SpendingRow[] | null) ?? []

  // AI-8926/AI-9536: pick the freshest of (devices.last_seen_at, Convex device_heartbeats.last_heartbeat_at).
  const oldDevice = deviceRes.data?.[0] || null
  const heartbeatTsMs =
    (heartbeatRow as { last_heartbeat_at?: number } | null)?.last_heartbeat_at ?? null
  const heartbeatTs = heartbeatTsMs ? new Date(heartbeatTsMs).toISOString() : null
  const candidates: { last_seen_at: string; is_active: boolean }[] = []
  if (oldDevice?.last_seen_at) candidates.push({ last_seen_at: oldDevice.last_seen_at, is_active: oldDevice.is_active })
  if (heartbeatTs) candidates.push({ last_seen_at: heartbeatTs, is_active: true })
  const device: DeviceRow | null = candidates.length
    ? candidates.reduce((best, c) =>
        new Date(c.last_seen_at).getTime() > new Date(best.last_seen_at).getTime() ? c : best,
      ) as DeviceRow
    : null
  const hasAgent = !!device

  // AI-8926 / AI-9534: real-match-count fallback when analytics_daily is
  // empty. matchCountRes is a plain number from api.matches.countForUser.
  const realMatchCount = typeof matchCountRes === 'number' ? matchCountRes : 0

  // Aggregate totals
  const totals = rows.reduce(
    (acc, r) => ({
      swipes: acc.swipes + r.swipes_right + r.swipes_left,
      swipes_right: acc.swipes_right + r.swipes_right,
      matches: acc.matches + r.matches,
      dates: acc.dates + r.dates_booked,
      messages: acc.messages + r.conversations_started,
      money_spent: acc.money_spent + (r.money_spent || 0),
    }),
    { swipes: 0, swipes_right: 0, matches: 0, dates: 0, messages: 0, money_spent: 0 }
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
    messages_sent: r.conversations_started,
    conversations_replied: convos.filter(c => c.date === r.date).reduce((s, c) => s + (c.conversations_replied || 0), 0),
    dates_booked: r.dates_booked,
  }))
  const lastWeekRizzRows = lastWeekRows.map(r => ({
    swipes_right: r.swipes_right,
    matches: r.matches,
    messages_sent: r.conversations_started,
    conversations_replied: convos.filter(c => c.date === r.date).reduce((s, c) => s + (c.conversations_replied || 0), 0),
    dates_booked: r.dates_booked,
  }))
  const rizzScore = calculateRizzScore(rizzRows)
  const rizzTrend = getRizzTrend(rizzScore, calculateRizzScore(lastWeekRizzRows))

  // Spending — compute early so CPN can use it
  const externalSpent = spending.reduce((s, r) => s + Number(r.amount), 0)
  const totalSpent = totals.money_spent + externalSpent

  // CPN — Cost Per Nut
  const totalMessagesSent = convos.reduce((s, c) => s + (c.messages_sent || 0), 0)
  const cpnResult = calculateCPN({
    moneySpent: totals.money_spent + externalSpent,
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
  const thisWeekSpent = thisWeekRows.reduce((s, r) => s + (r.money_spent || 0), 0)
  const lastWeekSpent = lastWeekRows.reduce((s, r) => s + (r.money_spent || 0), 0)

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
  if (totals.money_spent > 0) {
    spendByCategory['subscriptions'] = (spendByCategory['subscriptions'] || 0) + totals.money_spent
  }

  // Per-platform breakdown (detailed for DashboardLive)
  const byPlatform: Record<string, { swipes_right: number; matches: number; messages_sent: number; dates_booked: number }> = {}
  for (const r of rows) {
    if (!byPlatform[r.app]) byPlatform[r.app] = { swipes_right: 0, matches: 0, messages_sent: 0, dates_booked: 0 }
    byPlatform[r.app].swipes_right += r.swipes_right
    byPlatform[r.app].matches += r.matches
    byPlatform[r.app].messages_sent += r.conversations_started
    byPlatform[r.app].dates_booked += r.dates_booked
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

  const stats = [
    { label: 'Swipes Today', value: hasAgent ? String(todaySwipes) : '--', trend: undefined, invertColors: false },
    // AI-8926: Always show match count from clapcheeks_matches when analytics_daily is empty.
    { label: 'Total Matches', value: String(totals.matches || realMatchCount), trend: hasAgent ? chartData.trends.matches : undefined, invertColors: false },
    { label: 'Dates Booked', value: hasAgent ? String(totals.dates) : '--', trend: hasAgent ? chartData.trends.dates : undefined, invertColors: false },
    { label: 'Match Rate', value: hasAgent ? `${matchRate.toFixed(1)}%` : '--', trend: undefined, invertColors: false },
    { label: 'Rizz Score', value: hasAgent ? String(rizzScore) : '--', trend: hasAgent ? rizzTrend : undefined, invertColors: false },
    { label: 'CPN', value: hasAgent ? (cpnResult.nuts > 0 ? `$${cpnResult.cpn}` : '--') : '--', trend: hasAgent && cpnResult.nuts > 0 ? cpnTrend : undefined, invertColors: true },
  ]

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="relative max-w-5xl mx-auto">
        {/* Header — top-nav removed 2026-04-27 (sidebar-audit Fix E):
            the in-page top-nav duplicated the global sidebar with mismatched
            labels ("Conversation AI" vs sidebar "Conversations", "AI Coach"
            vs sidebar "Coaching"). Sidebar is now the single source of truth.
            Plan badge + Manage-billing CTA stay because those are dashboard
            chrome, not navigation. */}
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

        {/* Operator briefing — actionable counts pointing to the next page to open */}
        <BriefingCard />

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
            <DashboardChartsLazy initialData={chartData} />
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

        {/* Elite Features — AI-9526: copy now reflects whether your agent
            is reporting data, not promotional fluff */}
        <div className="space-y-4 mb-8">
          <h2 className="font-display text-2xl text-white uppercase tracking-wide gold-text">
            Elite Features
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EliteOnly isElite={userIsElite} featureName="Autopilot">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-white font-semibold text-sm">Autopilot</h3>
                  <div className={`w-2 h-2 rounded-full ${
                    hasAgent && totals.swipes_right > 0 ? "bg-green-400 animate-pulse" : "bg-gray-600"
                  }`} />
                </div>
                <p className="text-white/40 text-xs">
                  {hasAgent && totals.swipes_right > 0
                    ? `Active — ${totals.swipes_right} right-swipes in last 30 days.`
                    : hasAgent
                    ? "Agent connected, but no swipes yet. Run `clapcheeks swipe` to start."
                    : "Install the Mac agent to enable auto-swiping."}
                </p>
              </div>
            </EliteOnly>
            <EliteOnly isElite={userIsElite} featureName="Match Intel">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <h3 className="text-white font-semibold text-sm mb-2">Match Intel</h3>
                <p className="text-white/40 text-xs">
                  {realMatchCount > 0
                    ? `${realMatchCount} matches analyzed. Open Matches to see profile insights.`
                    : "No matches yet — connect a dating app to start collecting profiles."}
                </p>
              </div>
            </EliteOnly>
            <EliteOnly isElite={userIsElite} featureName="Ghost Hunter">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <h3 className="text-white font-semibold text-sm mb-2">Ghost Hunter</h3>
                <p className="text-white/40 text-xs">
                  {convoTotals.conversations_started > 0
                    ? `Tracking ${convoTotals.conversations_started} conversations for re-engagement opportunities.`
                    : "No conversations yet — start chatting to enable ghost detection."}
                </p>
              </div>
            </EliteOnly>
            <EliteOnly isElite={userIsElite} featureName="Date Closer">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <h3 className="text-white font-semibold text-sm mb-2">Date Closer</h3>
                <p className="text-white/40 text-xs">
                  {totals.dates > 0
                    ? `${totals.dates} dates booked in last 30 days. Keep the streak going.`
                    : "No dates booked yet — your AI proposes options when she's ready."}
                </p>
              </div>
            </EliteOnly>
          </div>
        </div>

        {/* AI Coaching Section */}
        {hasAgent && (
          <div className="mb-8">
            <CoachingSectionLazy initialSession={coachingSession} />
          </div>
        )}

        {/* iMessage Test Panel */}
        <div className="mb-8">
          <IMessageTestPanelLazy />
        </div>

      </div>
    </div>
  )
}
