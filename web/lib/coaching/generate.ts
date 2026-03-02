import Anthropic from '@anthropic-ai/sdk'
import { SupabaseClient } from '@supabase/supabase-js'

interface CoachingTip {
  category: 'timing' | 'messaging' | 'platform' | 'general'
  title: string
  tip: string
  supporting_data: string
  priority: 'high' | 'medium' | 'low'
}

interface StatsSnapshot {
  swipes_right: number
  swipes_left: number
  matches: number
  messages_sent: number
  dates_booked: number
  match_rate: number
  reply_rate: number
  date_conversion: number
  rizz_score: number
  by_platform: Record<string, { swipes: number; matches: number }>
}

function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.setDate(diff))
  return monday.toISOString().split('T')[0]
}

export async function getLatestCoaching(supabase: SupabaseClient, userId: string) {
  const weekStart = getWeekStart()

  const { data } = await supabase
    .from('clapcheeks_coaching_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .single()

  if (!data) return null

  // Fetch feedback for this session
  const { data: feedback } = await supabase
    .from('clapcheeks_tip_feedback')
    .select('tip_index, helpful')
    .eq('coaching_session_id', data.id)
    .eq('user_id', userId)

  return {
    ...data,
    feedback: feedback || [],
  }
}

export async function generateCoaching(supabase: SupabaseClient, userId: string) {
  const weekStart = getWeekStart()

  // Check if we already have coaching for this week
  const existing = await getLatestCoaching(supabase, userId)
  if (existing) return existing

  // Fetch last 30 days of analytics
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().split('T')[0]

  const { data: rows } = await supabase
    .from('analytics_daily')
    .select('app, swipes_right, swipes_left, matches, conversations_started, dates_booked, date')
    .eq('user_id', userId)
    .gte('date', sinceStr)
    .order('date', { ascending: false })

  if (!rows || rows.length === 0) {
    return null
  }

  // Aggregate stats
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

  const matchRate = totals.swipes_right > 0
    ? ((totals.matches / totals.swipes_right) * 100)
    : 0
  const replyRate = totals.messages_sent > 0 && totals.matches > 0
    ? ((totals.messages_sent / totals.matches) * 100)
    : 0
  const dateConversion = totals.matches > 0
    ? ((totals.dates_booked / totals.matches) * 100)
    : 0

  // Per-platform breakdown
  const byPlatform: Record<string, { swipes: number; matches: number }> = {}
  for (const r of rows) {
    if (!byPlatform[r.app]) byPlatform[r.app] = { swipes: 0, matches: 0 }
    byPlatform[r.app].swipes += r.swipes_right || 0
    byPlatform[r.app].matches += r.matches || 0
  }

  const statsSnapshot: StatsSnapshot = {
    ...totals,
    match_rate: matchRate,
    reply_rate: replyRate,
    date_conversion: dateConversion,
    rizz_score: Math.round(matchRate * 2 + dateConversion * 3),
    by_platform: byPlatform,
  }

  // Build platform stats string
  const platformStats = Object.entries(byPlatform)
    .map(([p, d]) => `${p}: ${d.swipes} swipes, ${d.matches} matches (${d.swipes > 0 ? ((d.matches / d.swipes) * 100).toFixed(1) : '0.0'}% rate)`)
    .join('\n')

  // Call Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: `You are a dating performance coach for Clapcheeks, a dating app optimization platform. Analyze these anonymized metrics and give 3 specific, actionable tips to improve results. Be direct and tactical, not generic. Reference actual numbers from the stats.

Rules:
- Each tip must be actionable (user can do something THIS WEEK)
- Tone: confident, slightly irreverent, supportive. Not corporate.
- Never reference personal messages or individual matches
- Focus on patterns and behaviors the user can change

Return a JSON array of tip objects with this shape:
[{ "category": "timing|messaging|platform|general", "title": "short title", "tip": "2-3 sentence actionable advice", "supporting_data": "the stat that prompted this", "priority": "high|medium|low" }]

Return ONLY the JSON array, no other text.`,
    messages: [
      {
        role: 'user',
        content: `Here are my dating stats for the past 30 days:

Platform breakdown:
${platformStats}

Key metrics:
- Match rate: ${matchRate.toFixed(1)}%
- Reply rate: ${replyRate.toFixed(1)}%
- Date conversion: ${dateConversion.toFixed(1)}%
- Rizz Score: ${statsSnapshot.rizz_score}/100
- Total swipes: ${totals.swipes_right + totals.swipes_left}
- Total matches: ${totals.matches}
- Dates booked: ${totals.dates_booked}

Generate 3 personalized coaching tips for this week.`,
      },
    ],
  })

  // Parse response
  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  let tips: CoachingTip[]
  try {
    tips = JSON.parse(responseText)
  } catch {
    // Try extracting JSON from markdown code block
    const match = responseText.match(/\[[\s\S]*\]/)
    if (match) {
      tips = JSON.parse(match[0])
    } else {
      throw new Error('Failed to parse coaching tips from Claude response')
    }
  }

  // Store in database
  const { data: session, error } = await supabase
    .from('clapcheeks_coaching_sessions')
    .upsert({
      user_id: userId,
      week_start: weekStart,
      tips,
      stats_snapshot: statsSnapshot,
    }, { onConflict: 'user_id,week_start' })
    .select()
    .single()

  if (error) throw error

  return { ...session, feedback: [] }
}
