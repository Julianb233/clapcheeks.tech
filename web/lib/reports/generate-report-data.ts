import { SupabaseClient } from '@supabase/supabase-js'
import { ConvexHttpClient } from 'convex/browser'

import type { ReportData } from './generate-pdf'
import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_analytics_daily migrated to Convex analytics_daily.
type AnalyticsRow = {
  app: string
  swipes_right: number
  swipes_left: number
  matches: number
  conversations_started: number
  dates_booked: number
}

async function fetchAnalyticsRange(
  userId: string,
  sinceIso: string,
  untilIso: string,
): Promise<AnalyticsRow[]> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  if (!url) return []
  const convex = new ConvexHttpClient(url)
  try {
    const rows = (await convex.query(api.telemetry.getDailyForUser, {
      user_id: userId,
      since_day_iso: sinceIso,
      until_day_iso: untilIso,
    })) as Array<AnalyticsRow & { day_iso: string }>
    return rows.map((r) => ({
      app: r.app,
      swipes_right: r.swipes_right,
      swipes_left: r.swipes_left,
      matches: r.matches,
      conversations_started: r.conversations_started,
      dates_booked: r.dates_booked,
    }))
  } catch {
    return []
  }
}

export async function generateReportData(
  supabase: SupabaseClient,
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<ReportData> {
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // Previous week for comparisons
  const prevStart = new Date(weekStart)
  prevStart.setDate(prevStart.getDate() - 7)
  const prevEnd = new Date(weekEnd)
  prevEnd.setDate(prevEnd.getDate() - 7)
  const prevStartStr = prevStart.toISOString().split('T')[0]
  const prevEndStr = prevEnd.toISOString().split('T')[0]

  // Fetch this week + last week analytics
  // AI-9537: coaching_sessions migrated to Convex.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null
  const [thisWeek, prevWeek, coachingRow] = await Promise.all([
    fetchAnalyticsRange(userId, weekStartStr, weekEndStr),
    fetchAnalyticsRange(userId, prevStartStr, prevEndStr),
    convex
      ? convex
          .query(api.coaching.getRecentForUserInRange, {
            user_id: userId,
            start_ms: weekStart.getTime(),
            end_ms: weekEnd.getTime(),
          })
          .catch(() => null as { tips?: unknown } | null)
      : Promise.resolve(null as { tips?: unknown } | null),
  ])

  // Aggregate this week
  const tw = aggregateRows(thisWeek)
  const pw = aggregateRows(prevWeek)

  // Calculate changes
  function pctChange(curr: number, prev: number): number {
    if (prev === 0) return curr > 0 ? 100 : 0
    return Math.round(((curr - prev) / prev) * 100)
  }

  // Per-platform breakdown
  const platformMap: Record<string, { swipes: number; matches: number }> = {}
  for (const row of thisWeek) {
    const p = row.app
    if (!platformMap[p]) platformMap[p] = { swipes: 0, matches: 0 }
    platformMap[p].swipes += row.swipes_right
    platformMap[p].matches += row.matches
  }

  const platforms = Object.entries(platformMap).map(([name, data]) => ({
    name,
    swipes: data.swipes,
    matches: data.matches,
    matchRate: data.swipes > 0 ? (data.matches / data.swipes) * 100 : 0,
  })).sort((a, b) => b.matches - a.matches)

  // Conversion funnel
  const swipesToMatches = tw.swipesRight > 0 ? (tw.matches / tw.swipesRight) * 100 : 0
  const matchesToConvos = tw.matches > 0 ? (tw.messages / tw.matches) * 100 : 0
  const convosToDates = tw.messages > 0 ? (tw.dates / tw.messages) * 100 : 0

  // Rizz score: composite metric
  const rizzScore = computeRizzScore(tw)
  const prevRizzScore = computeRizzScore(pw)

  // Coaching tips
  const coachingTips: string[] = []
  const tipData = coachingRow?.tips
  if (Array.isArray(tipData)) {
    coachingTips.push(...tipData.slice(0, 3))
  }

  return {
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    rizzScore,
    rizzScoreChange: rizzScore - prevRizzScore,
    stats: {
      swipes: tw.swipesRight + tw.swipesLeft,
      swipesChange: pctChange(tw.swipesRight + tw.swipesLeft, pw.swipesRight + pw.swipesLeft),
      matches: tw.matches,
      matchesChange: pctChange(tw.matches, pw.matches),
      dates: tw.dates,
      datesChange: pctChange(tw.dates, pw.dates),
      messages: tw.messages,
      messagesChange: pctChange(tw.messages, pw.messages),
    },
    platforms,
    funnel: {
      swipesToMatches,
      matchesToConvos,
      convosToDates,
    },
    coachingTips,
  }
}

interface AggregatedStats {
  swipesRight: number
  swipesLeft: number
  matches: number
  messages: number
  dates: number
}

function aggregateRows(rows: Array<{
  swipes_right: number
  swipes_left: number
  matches: number
  conversations_started: number
  dates_booked: number
}>): AggregatedStats {
  return rows.reduce(
    (acc, r) => ({
      swipesRight: acc.swipesRight + r.swipes_right,
      swipesLeft: acc.swipesLeft + r.swipes_left,
      matches: acc.matches + r.matches,
      messages: acc.messages + r.conversations_started,
      dates: acc.dates + r.dates_booked,
    }),
    { swipesRight: 0, swipesLeft: 0, matches: 0, messages: 0, dates: 0 }
  )
}

function computeRizzScore(stats: AggregatedStats): number {
  const matchRate = stats.swipesRight > 0 ? stats.matches / stats.swipesRight : 0
  const convoRate = stats.matches > 0 ? stats.messages / stats.matches : 0
  const dateRate = stats.messages > 0 ? stats.dates / stats.messages : 0

  // Weighted composite: match rate (40%), convo rate (30%), date rate (30%)
  const raw =
    Math.min(matchRate * 10, 1) * 40 +
    Math.min(convoRate, 1) * 30 +
    Math.min(dateRate * 5, 1) * 30

  return Math.round(Math.min(Math.max(raw, 0), 100))
}
