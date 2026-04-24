import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLatestCoaching, generateCoaching } from '@/lib/coaching/generate'
import {
  calculatePerformanceScore,
  compareToBenchmarks,
  getPositiveInsights,
  type PerformanceMetrics,
} from '@/lib/coaching/benchmarks'

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

  const [analyticsRes, convoRes] = await Promise.all([
    supabase
      .from('clapcheeks_analytics_daily')
      .select('platform, swipes_right, swipes_left, matches, messages_sent, dates_booked, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr)
      .order('date', { ascending: false }),
    supabase
      .from('clapcheeks_conversation_stats')
      .select('conversations_started, conversations_replied, date')
      .eq('user_id', user.id)
      .gte('date', sinceStr),
  ])

  const rows = analyticsRes.data || []
  const convos = convoRes.data || []

  // Aggregate totals
  const totals = rows.reduce(
    (acc, r) => ({
      swipes_right: acc.swipes_right + (r.swipes_right || 0),
      swipes_left: acc.swipes_left + (r.swipes_left || 0),
      matches: acc.matches + (r.matches || 0),
      messages_sent: acc.messages_sent + (r.messages_sent || 0),
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
    score,
    tips: coaching?.tips || [],
    benchmarks,
    positives,
    generatedAt: coaching?.generated_at || new Date().toISOString(),
  })
}
