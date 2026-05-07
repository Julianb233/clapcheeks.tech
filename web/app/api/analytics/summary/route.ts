import { NextRequest, NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'

import { createClient } from '@/lib/supabase/server'
import { calculateRizzScore, getRizzTrend, type AnalyticsRow } from '@/lib/rizz'
import { api } from '@/convex/_generated/api'

const VALID_DAYS = [7, 30, 90] as const

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const daysParam = Number(request.nextUrl.searchParams.get('days') ?? 30)
  const days = VALID_DAYS.includes(daysParam as (typeof VALID_DAYS)[number]) ? daysParam : 30

  const now = new Date()
  const rangeStart = new Date(now)
  rangeStart.setDate(rangeStart.getDate() - days)
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const fourteenDaysAgo = new Date(now)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  const fmt = (d: Date) => d.toISOString().split('T')[0]

  // AI-9536: clapcheeks_analytics_daily migrated to Convex analytics_daily.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null

  type AnalyticsDailyRow = {
    app: string
    swipes_right: number
    swipes_left: number
    matches: number
    conversations_started: number
    dates_booked: number
    money_spent: number
    date: string
  }

  const [analyticsRows, convoRes, spendRes] = await Promise.all([
    convex
      ? convex
          .query(api.telemetry.getDailyForUser, {
            user_id: user.id,
            since_day_iso: fmt(rangeStart),
          })
          .catch(() => [])
      : Promise.resolve([]),
    supabase
      .from('clapcheeks_conversation_stats')
      .select('platform, messages_sent, messages_received, conversations_started, conversations_replied, conversations_ghosted, date')
      .eq('user_id', user.id)
      .gte('date', fmt(rangeStart))
      .order('date', { ascending: true }),
    supabase
      .from('clapcheeks_spending')
      .select('amount, category, date')
      .eq('user_id', user.id)
      .gte('date', fmt(rangeStart)),
  ])

  // Convex returns day_iso; map to legacy `date` field name so the
  // analytics code below works unchanged.
  const analytics: AnalyticsDailyRow[] = (
    analyticsRows as Array<{
      app: string
      day_iso: string
      swipes_right: number
      swipes_left: number
      matches: number
      conversations_started: number
      dates_booked: number
      money_spent: number
    }>
  )
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
    .sort((a, b) => a.date.localeCompare(b.date))
  type ConvoRow = {
    platform: string
    messages_sent: number
    messages_received: number
    conversations_started: number
    conversations_replied: number
    conversations_ghosted: number
    date: string
  }
  type SpendingRow = { amount: number | string; category: string; date: string }
  const convos: ConvoRow[] = (convoRes.data as ConvoRow[] | null) ?? []
  const spending: SpendingRow[] = (spendRes.data as SpendingRow[] | null) ?? []

  // Range aggregates
  const totals = analytics.reduce(
    (acc, r) => ({
      swipes_right: acc.swipes_right + (r.swipes_right || 0),
      swipes_left: acc.swipes_left + (r.swipes_left || 0),
      matches: acc.matches + (r.matches || 0),
      messages_sent: acc.messages_sent + (r.conversations_started || 0),
      dates_booked: acc.dates_booked + (r.dates_booked || 0),
    }),
    { swipes_right: 0, swipes_left: 0, matches: 0, messages_sent: 0, dates_booked: 0 }
  )

  const convoTotals = convos.reduce(
    (acc, r) => ({
      conversations_started: acc.conversations_started + (r.conversations_started || 0),
      conversations_replied: acc.conversations_replied + (r.conversations_replied || 0),
    }),
    { conversations_started: 0, conversations_replied: 0 }
  )

  // Per-platform breakdown
  const platforms: Record<string, { swipes_right: number; matches: number; messages_sent: number; dates_booked: number }> = {}
  for (const r of analytics) {
    if (!platforms[r.app]) platforms[r.app] = { swipes_right: 0, matches: 0, messages_sent: 0, dates_booked: 0 }
    platforms[r.app].swipes_right += r.swipes_right || 0
    platforms[r.app].matches += r.matches || 0
    platforms[r.app].messages_sent += r.conversations_started || 0
    platforms[r.app].dates_booked += r.dates_booked || 0
  }

  // Daily time series (merge analytics + conversations by date)
  const dailyMap: Record<string, {
    date: string; swipes_right: number; matches: number;
    messages_sent: number; dates_booked: number; conversations_replied: number
  }> = {}
  for (const r of analytics) {
    if (!dailyMap[r.date]) dailyMap[r.date] = { date: r.date, swipes_right: 0, matches: 0, messages_sent: 0, dates_booked: 0, conversations_replied: 0 }
    dailyMap[r.date].swipes_right += r.swipes_right || 0
    dailyMap[r.date].matches += r.matches || 0
    dailyMap[r.date].messages_sent += r.conversations_started || 0
    dailyMap[r.date].dates_booked += r.dates_booked || 0
  }
  for (const r of convos) {
    if (!dailyMap[r.date]) dailyMap[r.date] = { date: r.date, swipes_right: 0, matches: 0, messages_sent: 0, dates_booked: 0, conversations_replied: 0 }
    dailyMap[r.date].conversations_replied += r.conversations_replied || 0
  }
  const timeSeries = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))

  // Rizz Score -- this week vs last week
  const thisWeekRows: AnalyticsRow[] = analytics
    .filter(r => r.date >= fmt(sevenDaysAgo))
    .map(r => ({
      swipes_right: r.swipes_right || 0,
      matches: r.matches || 0,
      messages_sent: r.conversations_started || 0,
      conversations_replied: convos.filter(c => c.date === r.date).reduce((s, c) => s + (c.conversations_replied || 0), 0),
      dates_booked: r.dates_booked || 0,
    }))
  const lastWeekRows: AnalyticsRow[] = analytics
    .filter(r => r.date >= fmt(fourteenDaysAgo) && r.date < fmt(sevenDaysAgo))
    .map(r => ({
      swipes_right: r.swipes_right || 0,
      matches: r.matches || 0,
      messages_sent: r.conversations_started || 0,
      conversations_replied: convos.filter(c => c.date === r.date).reduce((s, c) => s + (c.conversations_replied || 0), 0),
      dates_booked: r.dates_booked || 0,
    }))

  const rizzScore = calculateRizzScore(thisWeekRows.length > 0 ? thisWeekRows : analytics.map(r => ({
    swipes_right: r.swipes_right || 0,
    matches: r.matches || 0,
    messages_sent: r.conversations_started || 0,
    conversations_replied: 0,
    dates_booked: r.dates_booked || 0,
  })))
  const lastWeekRizz = calculateRizzScore(lastWeekRows)
  const rizzTrend = getRizzTrend(rizzScore, lastWeekRizz)

  // Spending
  const totalSpent = spending.reduce((s, r) => s + Number(r.amount), 0)
  const spendByCategory: Record<string, number> = {}
  for (const r of spending) {
    spendByCategory[r.category] = (spendByCategory[r.category] || 0) + Number(r.amount)
  }
  const costPerMatch = totals.matches > 0 ? totalSpent / totals.matches : 0
  const costPerDate = totals.dates_booked > 0 ? totalSpent / totals.dates_booked : 0

  // Conversion funnel
  const funnel = [
    { stage: 'Swipes', value: totals.swipes_right },
    { stage: 'Matches', value: totals.matches },
    { stage: 'Conversations', value: convoTotals.conversations_started },
    { stage: 'Dates', value: totals.dates_booked },
  ]

  // Today stats
  const today = fmt(now)
  const todayRows = analytics.filter(r => r.date === today)
  const todaySwipes = todayRows.reduce((a, r) => a + (r.swipes_right || 0) + (r.swipes_left || 0), 0)

  // Week-over-week trends
  const thisWeekTotals = analytics.filter(r => r.date >= fmt(sevenDaysAgo)).reduce(
    (acc, r) => ({ swipes: acc.swipes + (r.swipes_right || 0), matches: acc.matches + (r.matches || 0), dates: acc.dates + (r.dates_booked || 0) }),
    { swipes: 0, matches: 0, dates: 0 }
  )
  const lastWeekTotals = analytics.filter(r => r.date >= fmt(fourteenDaysAgo) && r.date < fmt(sevenDaysAgo)).reduce(
    (acc, r) => ({ swipes: acc.swipes + (r.swipes_right || 0), matches: acc.matches + (r.matches || 0), dates: acc.dates + (r.dates_booked || 0) }),
    { swipes: 0, matches: 0, dates: 0 }
  )

  function trend(curr: number, prev: number) {
    if (prev === 0) return { direction: curr > 0 ? 'up' : 'same', delta: curr > 0 ? 100 : 0 }
    const pct = Math.round(((curr - prev) / prev) * 100)
    if (Math.abs(pct) < 2) return { direction: 'same' as const, delta: 0 }
    return { direction: pct > 0 ? 'up' as const : 'down' as const, delta: pct }
  }

  return NextResponse.json({
    totals: { ...totals, conversations: convoTotals.conversations_started },
    todaySwipes,
    matchRate: totals.swipes_right > 0 ? ((totals.matches / totals.swipes_right) * 100) : 0,
    rizzScore,
    rizzTrend,
    platforms,
    timeSeries,
    funnel,
    spending: { totalSpent, costPerMatch, costPerDate, byCategory: spendByCategory },
    trends: {
      swipes: trend(thisWeekTotals.swipes, lastWeekTotals.swipes),
      matches: trend(thisWeekTotals.matches, lastWeekTotals.matches),
      dates: trend(thisWeekTotals.dates, lastWeekTotals.dates),
    },
  })
}
