import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateReportData } from '@/lib/reports/generate-report-data'
import { renderReportPdf } from '@/lib/reports/generate-pdf'
import { sendReportEmail } from '@/lib/reports/send-report-email'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { userId, weekStart: weekStartParam } = body as { userId?: string; weekStart?: string }

    // If userId provided, generate for single user (on-demand)
    // Otherwise, authenticate via session
    let targetUserId: string

    if (userId) {
      // Verify caller is the user or this is a cron call
      const authHeader = request.headers.get('authorization')
      const cronSecret = process.env.CRON_SECRET

      if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        targetUserId = userId
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || user.id !== userId) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        targetUserId = user.id
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      targetUserId = user.id
    }

    // Calculate week boundaries
    const weekStart = weekStartParam
      ? new Date(weekStartParam)
      : getLastWeekStart()
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)

    // Generate report data
    const reportData = await generateReportData(supabase, targetUserId, weekStart, weekEnd)

    // Render PDF
    const pdfBuffer = await renderReportPdf(reportData)

    // Upload to Supabase Storage
    const filename = `${targetUserId}/${weekStart.toISOString().split('T')[0]}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('weekly-reports')
      .upload(filename, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('weekly-reports')
      .getPublicUrl(filename)

    const pdfUrl = urlData?.publicUrl || null

    // Save report record
    const { error: dbError } = await supabase
      .from('clapcheeks_weekly_reports')
      .upsert({
        user_id: targetUserId,
        week_start: weekStart.toISOString().split('T')[0],
        week_end: weekEnd.toISOString().split('T')[0],
        metrics_snapshot: reportData,
        pdf_url: pdfUrl,
      }, { onConflict: 'user_id,week_start' })

    if (dbError) {
      console.error('DB save error:', dbError)
    }

    // Send email if user has it enabled
    const { data: prefs } = await supabase
      .from('clapcheeks_report_preferences')
      .select('email_enabled')
      .eq('user_id', targetUserId)
      .single()

    const emailEnabled = prefs?.email_enabled !== false // default true

    if (emailEnabled) {
      const supabaseAdmin = createAdminClient()
      const { data: { user: targetUser } } = await supabaseAdmin.auth.admin.getUserById(targetUserId)
      if (targetUser?.email) {
        try {
          await sendReportEmail({
            to: targetUser.email,
            pdfBuffer: Buffer.from(pdfBuffer),
            weekStart: reportData.weekStart,
            weekEnd: reportData.weekEnd,
            rizzScore: reportData.rizzScore,
          })

          // Mark as sent
          await supabase
            .from('clapcheeks_weekly_reports')
            .update({ sent_at: new Date().toISOString() })
            .eq('user_id', targetUserId)
            .eq('week_start', weekStart.toISOString().split('T')[0])
        } catch (emailErr) {
          console.error('Email send failed:', emailErr)
        }
      }
    }

    return NextResponse.json({
      success: true,
      report: {
        weekStart: reportData.weekStart,
        weekEnd: reportData.weekEnd,
        rizzScore: reportData.rizzScore,
        pdfUrl,
      },
    })
  } catch (error) {
    console.error('Report generation error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

function getLastWeekStart(): Date {
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const daysToSubtract = dayOfWeek + 7 // Go back to last Sunday
  const lastSunday = new Date(now)
  lastSunday.setUTCDate(now.getUTCDate() - daysToSubtract)
  lastSunday.setUTCHours(0, 0, 0, 0)
  return lastSunday
}
