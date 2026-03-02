import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { generateReportData } from '@/lib/reports/generate-report-data'
import { renderWeeklyReportEmail } from '@/lib/email/weekly-report'
import { Resend } from 'resend'

export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Calculate last week boundaries (Monday to Sunday)
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const weekStart = new Date(now)
  weekStart.setUTCDate(now.getUTCDate() - dayOfWeek - 6) // Last Monday
  weekStart.setUTCHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6) // Last Sunday

  // Get all users with active subscriptions
  const { data: subscribers } = await supabaseAdmin
    .from('clapcheeks_subscriptions')
    .select('user_id')
    .eq('subscription_status', 'active')

  if (!subscribers || subscribers.length === 0) {
    return NextResponse.json({ message: 'No active subscribers', processed: 0 })
  }

  // Filter by preferences (email_enabled)
  const userIds = subscribers.map((s) => s.user_id)
  const { data: prefs } = await supabaseAdmin
    .from('clapcheeks_report_preferences')
    .select('user_id, email_enabled')
    .in('user_id', userIds)

  const disabledUsers = new Set(
    (prefs || []).filter((p) => p.email_enabled === false).map((p) => p.user_id)
  )

  const eligibleUserIds = userIds.filter((id) => !disabledUsers.has(id))

  if (eligibleUserIds.length === 0) {
    return NextResponse.json({ message: 'No eligible users', processed: 0 })
  }

  // Batch-fetch emails from profiles table (avoid admin.getUserById in loop)
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, email')
    .in('id', eligibleUserIds)

  const emailMap = new Map<string, string>()
  for (const p of profiles || []) {
    if (p.email) {
      emailMap.set(p.id, p.email)
    }
  }

  let processed = 0
  let errors = 0

  // Process in batches of 10
  const batchSize = 10
  for (let i = 0; i < eligibleUserIds.length; i += batchSize) {
    const batch = eligibleUserIds.slice(i, i + batchSize)

    await Promise.allSettled(
      batch.map(async (userId) => {
        try {
          const email = emailMap.get(userId)
          if (!email) {
            console.warn(`No email found for user ${userId}, skipping`)
            return
          }

          // Generate report data
          const reportData = await generateReportData(
            supabaseAdmin,
            userId,
            weekStart,
            weekEnd
          )

          // Generate AI tip
          const aiTip = await generateAiTip(reportData.stats)

          // Render email HTML
          const html = await renderWeeklyReportEmail({
            stats: reportData.stats,
            aiTip,
            dashboardUrl: 'https://clapcheeks.tech/dashboard',
            unsubscribeUrl: `https://clapcheeks.tech/reports?unsubscribe=1`,
          })

          // Send via Resend
          const { error: sendError } = await resend.emails.send({
            from: 'Clap Cheeks <reports@clapcheeks.tech>',
            to: [email],
            subject: 'Your Clap Cheeks Week in Review',
            html,
            headers: {
              'List-Unsubscribe': '<https://clapcheeks.tech/reports?unsubscribe=1>',
            },
          })

          if (sendError) {
            throw new Error(`Resend error: ${sendError.message}`)
          }

          // Record in weekly reports table
          const weekStartStr = weekStart.toISOString().split('T')[0]
          const weekEndStr = weekEnd.toISOString().split('T')[0]

          await supabaseAdmin.from('clapcheeks_weekly_reports').upsert(
            {
              user_id: userId,
              week_start: weekStartStr,
              week_end: weekEndStr,
              metrics_snapshot: reportData,
              sent_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,week_start' }
          )

          processed++
        } catch (err) {
          console.error(`Weekly report failed for user ${userId}:`, err)
          errors++
        }
      })
    )
  }

  return NextResponse.json({
    processed,
    errors,
    total: eligibleUserIds.length,
  })
}

async function generateAiTip(stats: {
  swipes: number
  swipesChange: number
  matches: number
  matchesChange: number
  messages: number
  messagesChange: number
  dates: number
  datesChange: number
}): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `You are a dating coach. Based on these stats, give ONE specific actionable tip (2-3 sentences). Be direct, not generic.
Stats: ${stats.swipes} swipes (${stats.swipesChange}%), ${stats.matches} matches (${stats.matchesChange}%), ${stats.messages} conversations (${stats.messagesChange}%), ${stats.dates} dates (${stats.datesChange}%).`,
        },
      ],
    })

    const text =
      message.content[0].type === 'text' ? message.content[0].text : ''
    if (text) return text

    return getFallbackTip()
  } catch (err) {
    console.error('AI tip generation failed, using fallback:', err)
    return getFallbackTip()
  }
}

async function getFallbackTip(): Promise<string> {
  // Try to get latest coaching tip from DB
  try {
    const { data } = await supabaseAdmin
      .from('clapcheeks_coaching_sessions')
      .select('tips')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (data?.tips && Array.isArray(data.tips) && data.tips.length > 0) {
      const tip = data.tips[0]
      return typeof tip === 'string' ? tip : (tip as { tip?: string }).tip || 'Keep swiping and stay consistent with your messaging game!'
    }
  } catch {
    // Ignore
  }

  return 'Keep swiping and stay consistent with your messaging game!'
}
