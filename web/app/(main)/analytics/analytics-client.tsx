'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DateRangePicker } from '../dashboard/components/date-range-picker'
import { DashboardCharts, type AnalyticsSummary } from '../dashboard/components/dashboard-charts'
import { TrendCard } from '../dashboard/components/trend-card'

export default function AnalyticsClient() {
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    fetch(`/api/analytics/summary?days=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load analytics')
        return r.json()
      })
      .then(setSummary)
      .catch(() => {
        setError('Failed to load analytics data')
      })
  }, [days])

  const matchRate = summary
    ? summary.totals.swipes_right > 0
      ? ((summary.totals.matches / summary.totals.swipes_right) * 100).toFixed(1) + '%'
      : '0%'
    : '--'

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 animate-slide-up">
          <div>
            <Link
              href="/dashboard"
              className="text-white/40 hover:text-white/70 text-xs transition-colors mb-2 inline-block"
            >
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold gradient-text">
              Analytics
            </h1>
          </div>
          <DateRangePicker value={days} onChange={setDays} />
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-8 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Trend cards row */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <TrendCard
              label="Total Swipes"
              value={String(summary.totals.swipes_right)}
              trend={summary.trends.swipes}
            />
            <TrendCard
              label="Matches"
              value={String(summary.totals.matches)}
              trend={summary.trends.matches}
            />
            <TrendCard
              label="Dates Booked"
              value={String(summary.totals.dates_booked)}
              trend={summary.trends.dates}
            />
            <TrendCard label="Match Rate" value={matchRate} />
          </div>
        )}

        {/* Charts */}
        <DashboardCharts initialData={null} days={days} />
      </div>
    </div>
  )
}
