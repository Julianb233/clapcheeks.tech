import { NextRequest, NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'

import { createAdminClient } from '@/lib/supabase/admin'
import { generateReportData } from '@/lib/reports/generate-report-data'
import { renderReportPdf } from '@/lib/reports/generate-pdf'
import { sendReportEmail } from '@/lib/reports/send-report-email'
import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_weekly_reports migrated to Convex weekly_reports.

export const maxDuration = 300

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // AI-9537: subscriptions + report preferences read from Convex.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  if (!convexUrl) throw new Error('CONVEX_URL not set')
  const convex = new ConvexHttpClient(convexUrl)

  // Calculate last week boundaries
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const weekStart = new Date(now)
  weekStart.setUTCDate(now.getUTCDate() - dayOfWeek - 7)
  weekStart.setUTCHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  // Get all users with active subscriptions
  const userIds: string[] = await convex.query(api.billing.listActiveUserIds, {})

  if (!userIds || userIds.length === 0) {
    return NextResponse.json({ message: 'No active subscribers', processed: 0 })
  }

  // Filter by preferences (email_enabled)
  const prefs: Array<{ user_id: string; email_enabled: boolean }> = await convex.query(
    api.reportPreferences.listEmailEnabledMap,
    { user_ids: userIds }
  )

  const disabledUsers = new Set(
    prefs.filter((p) => p.email_enabled === false).map((p) => p.user_id)
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

          // Save report (Convex)
          const upsertResult = await convex.mutation(
            api.reports.upsertWeeklyReport,
            {
              user_id: userId,
              week_start_ms: weekStart.getTime(),
              week_end_ms: weekEnd.getTime(),
              week_start_iso: weekStart.toISOString().split('T')[0],
              metrics_snapshot: reportData,
              pdf_url: urlData?.publicUrl ?? undefined,
              report_type: 'standard',
            },
          )

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

            await convex.mutation(api.reports.markReportSent, {
              id: upsertResult._id,
              pdf_url: urlData?.publicUrl ?? undefined,
            })
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
