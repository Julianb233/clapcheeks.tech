import { NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'
import { getFleetUserId } from '@/lib/fleet-user'

import { createClient } from '@/lib/supabase/server'
import { getLatestCoaching, generateCoaching } from '@/lib/coaching/generate'
import {
  calculatePerformanceScore,
  compareToBenchmarks,
  getPositiveInsights,
  type PerformanceMetrics,
} from '@/lib/coaching/benchmarks'
import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_analytics_daily migrated to Convex analytics_daily.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch last 30 days of analytics
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().split('T')[0]

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null

  // AI-9575: conversation_stats migrated to Convex.
  // AI-9526 Q14: Convex namespace is fleet-julian, not the Supabase auth UUID.
  const fleetUserId = getFleetUserId()
  const [analyticsRows, convoRows] = await Promise.all([
    convex
      ? convex
          .query(api.telemetry.getDailyForUser, {
            user_id: fleetUserId,
            since_day_iso: sinceStr,
          })
          .catch(() => [])
      : Promise.resolve([]),
    convex
      ? convex
          .query(api.conversation_stats.listForUser, {
            user_id: fleetUserId,
            since_date: sinceStr,
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])

  const rows = (analyticsRows as Array<{
    app: string
    day_iso: string
    swipes_right: number
    swipes_left: number
    matches: number
    conversations_started: number
    dates_booked: number
  }>).map((r) => ({
    app: r.app,
    swipes_right: r.swipes_right,
    swipes_left: r.swipes_left,
    matches: r.matches,
    conversations_started: r.conversations_started,
    dates_booked: r.dates_booked,
    date: r.day_iso,
  }))
  type ConvoRow = {
    conversations_started: number
    conversations_replied: number
    date: string
  }
  // AI-9575: Convex returns typed arrays directly (no .data wrapper).
  const convos: ConvoRow[] = (convoRows as ConvoRow[]) ?? []

  // Aggregate totals
  const totals = rows.reduce(
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
    }),
    { conversations_started: 0 }
  )

  const totalSwipes = totals.swipes_right + totals.swipes_left

  const metrics: PerformanceMetrics = {
    matchRate: totals.swipes_right > 0 ? totals.matches / totals.swipes_right : 0,
    conversationRate: totals.matches > 0 ? convoTotals.conversations_started / totals.matches : 0,
    dateRate: totals.matches > 0 ? totals.dates_booked / totals.matches : 0,
    likeRatio: totalSwipes > 0 ? totals.swipes_right / totalSwipes : 0,
  }

  const score = calculatePerformanceScore(metrics)
  const benchmarks = compareToBenchmarks(metrics)
  const positives = getPositiveInsights(metrics)

  // Get cached coaching tips or generate new ones
  let coaching = await getLatestCoaching(supabase, user.id)
  if (!coaching) {
    try {
      coaching = await generateCoaching(supabase, user.id)
    } catch (error) {
      console.error('Failed to generate coaching:', error)
    }
  }

  return NextResponse.json({
    // AI-9526 F9 — surface sessionId so the page can pass it back when posting
    // tip feedback. /api/coaching/feedback otherwise 400s with missing fields.
    sessionId: coaching?.id ?? null,
    score,
    tips: coaching?.tips || [],
    benchmarks,
    positives,
    generatedAt: coaching?.generated_at || new Date().toISOString(),
  })
}
