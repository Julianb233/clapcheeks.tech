import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendReportEmail } from '@/lib/reports/send-report-email'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch latest report
    const { data: report, error: fetchError } = await supabase
      .from('clapcheeks_weekly_reports')
      .select('*')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(1)
      .single()

    if (fetchError || !report) {
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

    const metrics = report.metrics_snapshot as { weekStart: string; weekEnd: string; rizzScore: number }

    await sendReportEmail({
      to: user.email,
      pdfBuffer,
      weekStart: metrics.weekStart || report.week_start,
      weekEnd: metrics.weekEnd || report.week_end,
      rizzScore: metrics.rizzScore || 0,
    })

    // Update sent_at
    await supabase
      .from('clapcheeks_weekly_reports')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', report.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Report send error:', error)
    return NextResponse.json({ error: 'Failed to send report' }, { status: 500 })
  }
}
