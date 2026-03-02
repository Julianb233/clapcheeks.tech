import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ReportsList from './reports-list'
import ReportPreferences from './report-preferences'

export const metadata: Metadata = {
  title: 'Reports — Clap Cheeks',
  description: 'Your weekly performance reports.',
}

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [reportsRes, prefsRes] = await Promise.all([
    supabase
      .from('clapcheeks_weekly_reports')
      .select('id, week_start, week_end, pdf_url, metrics_snapshot, sent_at, created_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(12),
    supabase
      .from('clapcheeks_report_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single(),
  ])

  const reports = reportsRes.data || []
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
