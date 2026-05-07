import type { Metadata } from 'next'
import { ConvexHttpClient } from 'convex/browser'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ReportsList from './reports-list'
import ReportPreferences from './report-preferences'
import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_weekly_reports migrated to Convex weekly_reports.

export const metadata: Metadata = {
  title: 'Reports — Clapcheeks',
  description: 'Your weekly performance reports.',
}

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  // AI-9536: weekly_reports lives on Convex.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null

  const [reportRows, prefsRes] = await Promise.all([
    convex
      ? convex
          .query(api.reports.getWeeklyReportsForUser, {
            user_id: user.id,
            limit: 12,
          })
          .catch(() => [])
      : Promise.resolve([]),
    supabase
      .from('clapcheeks_report_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single(),
  ])

  // Map Convex schema (week_start_ms / week_start_iso / week_end_ms) to the
  // legacy {id, week_start, week_end, pdf_url, ...} shape ReportsList expects.
  const reports = (reportRows as Array<{
    _id: string
    _creationTime: number
    week_start_ms: number
    week_end_ms: number
    week_start_iso: string
    pdf_url?: string | null
    metrics_snapshot?: unknown
    sent_at?: number | null
  }>).map((r) => ({
    id: r._id,
    week_start: r.week_start_iso,
    week_end: new Date(r.week_end_ms).toISOString().split('T')[0],
    pdf_url: r.pdf_url ?? null,
    metrics_snapshot: (r.metrics_snapshot ?? {}) as {
      rizzScore?: number
      stats?: { swipes?: number; matches?: number; dates?: number }
    },
    sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    created_at: new Date(r._creationTime).toISOString(),
  }))
  const preferences = prefsRes.data || { email_enabled: true, send_day: 'sunday', send_hour: 8 }

  return (
    <div className="min-h-screen bg-black px-6 py-8">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="orb w-96 h-96 bg-brand-600"
          style={{ top: '10%', left: '50%', transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="relative max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Weekly Reports</h1>
        <p className="text-white/40 text-sm mb-8">
          Your AI-generated performance summaries, delivered weekly.
        </p>

        {/* Report Preferences */}
        <ReportPreferences
          emailEnabled={preferences.email_enabled ?? true}
          sendDay={preferences.send_day ?? 'sunday'}
          sendHour={preferences.send_hour ?? 8}
        />

        {/* Reports List */}
        <ReportsList reports={reports} />
      </div>
    </div>
  )
}
