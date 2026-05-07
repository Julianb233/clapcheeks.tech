import { NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'

import { createClient } from '@/lib/supabase/server'
import { sendReportEmail } from '@/lib/reports/send-report-email'
import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_weekly_reports migrated to Convex weekly_reports.

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
    if (!convexUrl) {
      return NextResponse.json(
        { error: 'server_unconfigured' },
        { status: 500 },
      )
    }
    const convex = new ConvexHttpClient(convexUrl)

    // Fetch latest report (sorted by week_start_ms desc)
    const reports = await convex.query(api.reports.getWeeklyReportsForUser, {
      user_id: user.id,
      limit: 1,
    })
    const report = reports?.[0] ?? null

    if (!report) {
      return NextResponse.json({ error: 'No report found' }, { status: 404 })
    }

    if (!report.pdf_url) {
      return NextResponse.json({ error: 'Report PDF not available' }, { status: 404 })
    }

    if (!user.email) {
      return NextResponse.json({ error: 'No email on account' }, { status: 400 })
    }

    // Download the PDF from storage
    const pdfRes = await fetch(report.pdf_url)
    if (!pdfRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch PDF' }, { status: 500 })
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer())

    const metrics = report.metrics_snapshot as
      | { weekStart?: string; weekEnd?: string; rizzScore?: number }
      | null

    const weekEndIso = new Date(report.week_end_ms).toISOString().split('T')[0]
    await sendReportEmail({
      to: user.email,
      pdfBuffer,
      weekStart: metrics?.weekStart || report.week_start_iso,
      weekEnd: metrics?.weekEnd || weekEndIso,
      rizzScore: metrics?.rizzScore || 0,
    })

    // Update sent_at
    await convex.mutation(api.reports.markReportSent, {
      id: report._id,
      pdf_url: report.pdf_url,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Report send error:', error)
    return NextResponse.json({ error: 'Failed to send report' }, { status: 500 })
  }
}
