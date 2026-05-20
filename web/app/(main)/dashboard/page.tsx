import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { createClient } from '@/lib/convex/server'
import { logout } from '@/app/auth/actions'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, MessageSquareText, Sparkles, Target, UserRoundPlus, UsersRound, Zap } from 'lucide-react'
import ManageBillingButton from '@/components/manage-billing-button'
import PlanBadge from '@/components/plan-badge'
import EliteOnly from '@/components/elite-only'
import CoachingSection from './components/coaching-section'
import DashboardLive from './components/dashboard-live'
import AgentStatusBadge from './components/agent-status-badge'
import IMessageTestPanel from './components/imessage-test-panel'
import BriefingCard from './components/briefing-card'
import { getLatestCoaching } from '@/lib/coaching/generate'
import { TrendCard } from './components/trend-card'
import { DashboardCharts } from './components/dashboard-charts'
import { calculateRizzScore, getRizzTrend } from '@/lib/rizz'
import { calculateCPN, getCPNTrend } from '@/lib/cpn'
import { ClapcheeksMatchRow, RosterStage, formatTimeAgo } from '@/lib/matches/types'
import { getMatchIdentityStatus } from '@/lib/matches/identity'
import { isDisplayableMatchProfile } from '@/lib/matches/visibility'

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

interface SpendingRow {
  amount: number | string
  category: string
  date: string
}

interface DeviceRow {
  last_seen_at: string
  is_active: boolean
}

function deriveRosterStage(match: ClapcheeksMatchRow): RosterStage {
  if (match.stage) return match.stage
  switch (match.status) {
    case 'new':
    case 'opened':
      return 'new_match'
    case 'conversing':
      return 'chatting'
    case 'date_proposed':
      return 'date_proposed'
    case 'date_booked':
      return 'date_booked'
    case 'dated':
      return 'date_attended'
    case 'stalled':
      return 'faded'
    case 'ghosted':
      return 'ghosted'
    default:
      return 'new_match'
  }
}

function stageLabel(stage: RosterStage) {
  const labels: Record<RosterStage, string> = {
    new_match: 'New',
    chatting: 'Chatting',
    chatting_phone: 'Phone',
    date_proposed: 'Date proposed',
    date_booked: 'Date booked',
    date_attended: 'Dated',
    hooked_up: 'Hooked up',
    recurring: 'Recurring',
    faded: 'Faded',
    ghosted: 'Ghosted',
    archived: 'Archived',
    archived_cluster_dupe: 'Duplicate',
  }
  return labels[stage]
}

function closeProbability(match: ClapcheeksMatchRow) {
  if (typeof match.close_probability === 'number') return Math.round(match.close_probability * 100)
  if (typeof match.final_score === 'number') return Math.round(match.final_score)
  return null
}

function staleHours(match: ClapcheeksMatchRow) {
  const iso = match.last_activity_at ?? match.updated_at
  if (!iso) return 999
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5)
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string
  icon: ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className="flex min-h-16 flex-col items-start justify-between rounded-lg border border-white/10 bg-black/30 p-3 text-xs font-semibold text-white/65 transition-colors hover:border-yellow-500/35 hover:bg-yellow-500/10 hover:text-white"
    >
      <span className="text-yellow-300/80">{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

export default async function Dashboard() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()

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

  const [analyticsRes, convoRes, spendRes, deviceRes, subRes, profileRes, matchesRes] = await Promise.all([
    convex
      .from('clapcheeks_analytics_daily')
      .select('app, swipes_right, swipes_left, matches, conversations_started, dates_booked, money_spent, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr)
      .order('date', { ascending: true }),
    convex
      .from('clapcheeks_conversation_stats')
      .select('platform, messages_sent, conversations_started, conversations_replied, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr)
      .order('date', { ascending: true }),
    convex
      .from('clapcheeks_spending')
      .select('amount, category, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr),
    convex
      .from('devices')
      .select('last_seen_at, is_active')
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false })
      .limit(1),
    convex
      .from('clapcheeks_subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .limit(1)
      .single(),
    convex
      .from('profiles')
      .select('subscription_tier, subscription_status')
      .eq('id', user.id)
      .single(),
    (convex as any)
      .from('clapcheeks_matches')
      .select('*')
      .eq('user_id', user.id)
      .order('close_probability', { ascending: false, nullsFirst: false })
      .order('final_score', { ascending: false, nullsFirst: false })
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .range(0, 199),
  ])

  // Fetch coaching session
  const coachingSession = await getLatestCoaching(convex, user.id)

  const isSubscribed = subRes.data?.status === 'active'
  const userPlan = (profileRes.data?.subscription_tier || 'base') as 'base' | 'elite'
  const userSubStatus = profileRes.data?.subscription_status || 'inactive'
  const userIsElite = userPlan === 'elite' && userSubStatus === 'active'

  const rows: DailyRow[] = analyticsRes.data || []
  const convos: ConvoRow[] = convoRes.data || []
  const spending: SpendingRow[] = spendRes.data || []
  const device: DeviceRow | null = deviceRes.data?.[0] || null
  const rosterMatches: ClapcheeksMatchRow[] = ((matchesRes as any).data || []).filter(isDisplayableMatchProfile)
  const hasAgent = !!device || rows.length > 0 || convos.length > 0 || rosterMatches.length > 0

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
  const matchRateAvailable = totals.swipes_right > 0
  const matchRate = matchRateAvailable ? (totals.matches / totals.swipes_right) * 100 : 0
  const dataQualityWarnings: string[] = []
  if (hasAgent && totals.matches > 0 && totals.swipes_right === 0) {
    dataQualityWarnings.push('Swipe totals are unavailable from Convex, so match rate is hidden instead of showing a fake 0.0%.')
  }
  if (hasAgent && totals.matches > 0 && convoTotals.conversations_started > totals.matches) {
    dataQualityWarnings.push('Conversation totals are live activity counts, not a strict conversion denominator.')
  }

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
    dataQuality: { warnings: dataQualityWarnings },
  }

  // Chart data for Recharts components
  const chartData = {
    totals: { swipes_right: totals.swipes_right, matches: totals.matches, messages_sent: totals.messages, dates_booked: totals.dates, conversations: convoTotals.conversations_started },
    todaySwipes,
    matchRate,
    matchRateAvailable,
    dataQuality: { warnings: dataQualityWarnings },
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
    { label: 'Total Matches', value: hasAgent ? String(totals.matches) : '--', trend: hasAgent ? chartData.trends.matches : undefined, invertColors: false },
    { label: 'Dates Booked', value: hasAgent ? String(totals.dates) : '--', trend: hasAgent ? chartData.trends.dates : undefined, invertColors: false },
    { label: 'Match Rate', value: hasAgent ? (matchRateAvailable ? `${matchRate.toFixed(1)}%` : 'n/a') : '--', trend: undefined, invertColors: false },
    { label: 'Rizz Score', value: hasAgent ? String(rizzScore) : '--', trend: hasAgent ? rizzTrend : undefined, invertColors: false },
    { label: 'CPN', value: hasAgent ? (cpnResult.nuts > 0 ? `$${cpnResult.cpn}` : '--') : '--', trend: hasAgent && cpnResult.nuts > 0 ? cpnTrend : undefined, invertColors: true },
  ]

  const activeStages = new Set<RosterStage>(['new_match', 'chatting', 'chatting_phone', 'date_proposed', 'date_booked', 'date_attended', 'hooked_up', 'recurring', 'faded'])
  const dateIntentStages = new Set<RosterStage>(['chatting_phone', 'date_proposed', 'date_booked'])
  const activeRoster = rosterMatches.filter((match) => activeStages.has(deriveRosterStage(match)))
  const datePipeline = rosterMatches.filter((match) => dateIntentStages.has(deriveRosterStage(match)))
  const dateProposed = rosterMatches.filter((match) => deriveRosterStage(match) === 'date_proposed')
  const dateBooked = rosterMatches.filter((match) => deriveRosterStage(match) === 'date_booked')
  const staleOutreach = activeRoster.filter((match) => staleHours(match) >= 18)
  const highCloseNeedsDate = activeRoster.filter((match) => {
    const stage = deriveRosterStage(match)
    const probability = closeProbability(match) ?? 0
    return probability >= 60 && stage !== 'date_booked' && stage !== 'date_attended' && stage !== 'hooked_up' && stage !== 'recurring'
  })
  const priorityRoster = [...activeRoster]
    .sort((a, b) => {
      const ap = closeProbability(a) ?? 0
      const bp = closeProbability(b) ?? 0
      if (bp !== ap) return bp - ap
      return staleHours(b) - staleHours(a)
    })
    .slice(0, 6)
  const dateQueue = [...datePipeline]
    .sort((a, b) => {
      const stageWeight = (stage: RosterStage) =>
        stage === 'date_proposed' ? 3 : stage === 'chatting_phone' ? 2 : stage === 'date_booked' ? 1 : 0
      const sw = stageWeight(deriveRosterStage(b)) - stageWeight(deriveRosterStage(a))
      if (sw !== 0) return sw
      return (closeProbability(b) ?? 0) - (closeProbability(a) ?? 0)
    })
    .slice(0, 4)
  const rosterInsights = [
    highCloseNeedsDate.length > 0
      ? `${highCloseNeedsDate.length} high-close match${highCloseNeedsDate.length === 1 ? '' : 'es'} should be moved toward a date ask.`
      : 'No high-close match is waiting on a date ask.',
    staleOutreach.length > 0
      ? `${staleOutreach.length} active thread${staleOutreach.length === 1 ? '' : 's'} went quiet for 18h+ and need a revive/check-in.`
      : 'Active threads are fresh right now.',
    dateProposed.length > 0
      ? `${dateProposed.length} proposed date${dateProposed.length === 1 ? '' : 's'} need slot confirmation.`
      : 'No proposed dates are waiting for confirmation.',
    dateBooked.length > 0
      ? `${dateBooked.length} date${dateBooked.length === 1 ? ' is' : 's are'} booked and should get prep/follow-up attention.`
      : 'No booked dates in the current roster snapshot.',
  ]
  const rosterStats = [
    { label: 'Active roster', value: activeRoster.length, helper: 'people worth steering' },
    { label: 'Date pipeline', value: datePipeline.length, helper: 'phone/proposed/booked' },
    { label: 'Need date ask', value: highCloseNeedsDate.length, helper: '60%+ not booked' },
    { label: 'Quiet 18h+', value: staleOutreach.length, helper: 'revive today' },
  ]

  return (
    <div className="min-h-screen overflow-x-hidden bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="relative mx-auto max-w-[1500px] min-w-0">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <span className="font-display text-2xl sm:text-3xl tracking-wide gold-text uppercase">Clapcheeks</span>
            <span className="font-body text-xs text-white/30 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10">beta</span>
            <PlanBadge plan={userPlan} subscriptionStatus={userSubStatus} />
          </div>
          <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {user?.email && (
              <span className="text-white/30 text-xs hidden sm:block">{user.email}</span>
            )}
            <Link
              href="/dashboard/roster"
              className="text-white/70 hover:text-white text-xs bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 px-3 py-1.5 rounded-lg transition-all font-semibold"
            >
              Roster
            </Link>
            <Link
              href="/scheduled"
              className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Scheduled
            </Link>
            <Link
              href="/photos"
              className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Photos
            </Link>
            <Link
              href="/analytics"
              className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Analytics
            </Link>
            <Link
              href="/conversation"
              className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Conversation AI
            </Link>
            <Link
              href="/intelligence"
              className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Intelligence
            </Link>
            <Link
              href="/coaching"
              className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              AI Coach
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
        <div className="mb-6">
          <AgentStatusBadge initialDevice={device} />
        </div>

        <h1 className="font-display text-4xl md:text-5xl text-white uppercase leading-none mb-2">
          ROSTER COMMAND CENTER
        </h1>
        <p className="font-body text-white/40 text-sm mb-8">
          {hasAgent
            ? `Hey ${displayName} — prioritize who to talk to, who to ask out, and what needs scheduling next.`
            : 'Install the agent to start building your active dating roster.'}
        </p>

        {dataQualityWarnings.length > 0 && (
          <div className="mb-6 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100/80">
            {dataQualityWarnings[0]}
          </div>
        )}

        <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.9fr)] items-start gap-4 mb-8">
          <section className="min-w-0 overflow-hidden bg-white/[0.035] border border-white/10 rounded-xl p-4 md:p-5">
            <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-white font-semibold text-lg">Priority roster</h2>
                <p className="text-white/40 text-xs">Sorted by close probability, then silence risk.</p>
              </div>
              <Link
                href="/dashboard/roster"
                className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 rounded-lg px-3 py-1.5 transition-colors"
              >
                <UsersRound className="h-3.5 w-3.5" />
                Open roster
              </Link>
            </div>
            <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {rosterStats.map((item) => (
                <div key={item.label} className="min-w-0 bg-black/35 border border-white/10 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-widest text-white/35 font-mono mb-1">{item.label}</div>
                  <div className="font-mono text-2xl font-bold text-white">{item.value}</div>
                  <div className="text-[11px] text-white/35 mt-1">{item.helper}</div>
                </div>
              ))}
            </div>
            {priorityRoster.length > 0 ? (
              <div className="divide-y divide-white/10 border border-white/10 rounded-lg overflow-hidden">
                {priorityRoster.map((match) => {
                  const probability = closeProbability(match)
                  const stage = deriveRosterStage(match)
                  const identity = getMatchIdentityStatus(match)
                  return (
                    <Link
                      key={match.id}
                      href={`/matches/${match.id}`}
                      className="grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px] gap-3 items-center bg-black/25 hover:bg-white/[0.05] px-3 py-3 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-white text-sm font-semibold truncate">{identity.displayName}</span>
                          {match.age && <span className="text-white/45 text-xs">{match.age}</span>}
                          {identity.needsReview && identity.label && (
                            <span className="hidden sm:inline-flex rounded border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-100">
                              {identity.label}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-white/35 truncate">
                          {match.platform} · {formatTimeAgo(match.last_activity_at ?? match.updated_at)} · {match.bio ?? match.vision_summary ?? 'No profile hook yet'}
                        </div>
                      </div>
                      <span className="hidden md:inline-flex text-[10px] uppercase tracking-widest font-mono text-white/50">
                        {stageLabel(stage)}
                      </span>
                      <span className="hidden md:inline-flex text-[11px] text-white/45">
                        Health {match.health_score ?? 'n/a'}
                      </span>
                      <span className="justify-self-end font-mono text-xs font-bold text-yellow-300 bg-yellow-500/10 border border-yellow-500/25 rounded px-2 py-1">
                        {probability !== null ? `${probability}%` : 'n/a'}
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="bg-black/25 border border-white/10 rounded-lg p-6 text-center">
                <p className="text-sm text-white/45">No roster rows found yet. Match intake will populate this command center.</p>
              </div>
            )}
          </section>

          <aside className="min-w-0 space-y-4">
            <section className="bg-gradient-to-br from-yellow-500/10 to-red-600/5 border border-yellow-500/25 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-yellow-200 font-semibold text-sm">Date scheduling queue</h2>
                  <p className="text-white/40 text-xs">Confirm slots, draft asks, prep booked dates.</p>
                </div>
                <CalendarDays className="h-5 w-5 text-yellow-300" />
              </div>
              <div className="space-y-2">
                {dateQueue.length > 0 ? (
                  dateQueue.map((match) => {
                    const identity = getMatchIdentityStatus(match)
                    return (
                      <Link
                        key={match.id}
                        href={`/conversation?matchName=${encodeURIComponent(identity.displayName)}&platform=${encodeURIComponent(match.platform)}&goal=ask_date`}
                        className="block bg-black/35 hover:bg-black/50 border border-white/10 rounded-lg p-3 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white text-sm font-semibold truncate">{identity.displayName}</span>
                          <span className="text-[10px] uppercase tracking-widest font-mono text-yellow-300">{stageLabel(deriveRosterStage(match))}</span>
                        </div>
                        {identity.needsReview && identity.label && (
                          <div className="mt-1 inline-flex rounded border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-100">
                            {identity.label}
                          </div>
                        )}
                        <p className="text-[11px] text-white/40 mt-1">
                          {deriveRosterStage(match) === 'date_booked'
                            ? 'Prep or send a confirmation.'
                            : deriveRosterStage(match) === 'date_proposed'
                              ? 'Lock the time and place.'
                              : 'Draft the date ask.'}
                        </p>
                      </Link>
                    )
                  })
                ) : (
                  <p className="text-xs text-white/35 bg-black/25 border border-white/10 rounded-lg p-3">
                    No date-ready matches in the current roster snapshot.
                  </p>
                )}
              </div>
            </section>

            <section className="bg-white/[0.035] border border-white/10 rounded-xl p-4">
              <h2 className="text-white font-semibold text-sm mb-3">Quick actions</h2>
              <div className="grid grid-cols-2 gap-2">
                <QuickAction href="/dashboard/roster" icon={<UsersRound className="h-4 w-4" />} label="Manage roster" />
                <QuickAction href="/communications" icon={<MessageSquareText className="h-4 w-4" />} label="Unified inbox" />
                <QuickAction href="/conversation?goal=ask_date" icon={<MessageSquareText className="h-4 w-4" />} label="Draft date ask" />
                <QuickAction href="/scheduled" icon={<CalendarDays className="h-4 w-4" />} label="Review scheduled" />
                <QuickAction href="/matches/add" icon={<UserRoundPlus className="h-4 w-4" />} label="Add contact" />
                <QuickAction href="/intelligence" icon={<Sparkles className="h-4 w-4" />} label="Insights" />
                <QuickAction href="/device" icon={<Zap className="h-4 w-4" />} label="Runtime" />
              </div>
            </section>

            <section className="bg-white/[0.035] border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-emerald-300" />
                <h2 className="text-white font-semibold text-sm">Insights</h2>
              </div>
              <ul className="space-y-2">
                {rosterInsights.map((insight) => (
                  <li key={insight} className="text-xs text-white/50 bg-black/25 border border-white/10 rounded-lg px-3 py-2">
                    {insight}
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

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
