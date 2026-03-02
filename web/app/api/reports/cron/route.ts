import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateReportData } from '@/lib/reports/generate-report-data'
import { renderReportPdf } from '@/lib/reports/generate-pdf'
import { sendReportEmail } from '@/lib/reports/send-report-email'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  // Calculate last week boundaries
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const weekStart = new Date(now)
  weekStart.setUTCDate(now.getUTCDate() - dayOfWeek - 7)
  weekStart.setUTCHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  // Get all users with active subscriptions
  const { data: subscribers } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('status', 'active')

  if (!subscribers || subscribers.length === 0) {
    return NextResponse.json({ message: 'No active subscribers', processed: 0 })
  }

  // Filter by preferences (email_enabled)
  const userIds = subscribers.map((s) => s.user_id)
  const { data: prefs } = await supabase
    .from('clapcheeks_report_preferences')
    .select('user_id, email_enabled')
    .in('user_id', userIds)

  const disabledUsers = new Set(
    (prefs || []).filter((p) => p.email_enabled === false).map((p) => p.user_id)
  )

  const eligibleUsers = userIds.filter((id) => !disabledUsers.has(id))

  let processed = 0
  let errors = 0

  // Process in batches of 10
  const batchSize = 10
  for (let i = 0; i < eligibleUsers.length; i += batchSize) {
    const batch = eligibleUsers.slice(i, i + batchSize)

    await Promise.allSettled(
      batch.map(async (userId) => {
        try {
          const reportData = await generateReportData(supabase, userId, weekStart, weekEnd)
          const pdfBuffer = await renderReportPdf(reportData)

          // Upload PDF
          const filename = `${userId}/${weekStart.toISOString().split('T')[0]}.pdf`
          await supabase.storage
            .from('weekly-reports')
            .upload(filename, pdfBuffer, { contentType: 'application/pdf', upsert: true })

          const { data: urlData } = supabase.storage
            .from('weekly-reports')
            .getPublicUrl(filename)

          // Save report
          await supabase.from('clapcheeks_weekly_reports').upsert({
            user_id: userId,
            week_start: weekStart.toISOString().split('T')[0],
            week_end: weekEnd.toISOString().split('T')[0],
            metrics_snapshot: reportData,
            pdf_url: urlData?.publicUrl || null,
          }, { onConflict: 'user_id,week_start' })

          // Send email
          const { data: { user } } = await supabase.auth.admin.getUserById(userId)
          if (user?.email) {
            await sendReportEmail({
              to: user.email,
              pdfBuffer: Buffer.from(pdfBuffer),
              weekStart: reportData.weekStart,
              weekEnd: reportData.weekEnd,
              rizzScore: reportData.rizzScore,
            })

            await supabase
              .from('clapcheeks_weekly_reports')
              .update({ sent_at: new Date().toISOString() })
              .eq('user_id', userId)
              .eq('week_start', weekStart.toISOString().split('T')[0])
          }

          processed++
        } catch (err) {
          console.error(`Report failed for user ${userId}:`, err)
          errors++
        }
      })
    )
  }

  return NextResponse.json({ processed, errors, total: eligibleUsers.length })
}
