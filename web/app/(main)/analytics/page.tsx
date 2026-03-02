'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DateRangePicker } from '../dashboard/components/date-range-picker'
import { DashboardCharts, type AnalyticsSummary } from '../dashboard/components/dashboard-charts'
import { TrendCard } from '../dashboard/components/trend-card'

export default function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)

  useEffect(() => {
    fetch(`/api/analytics/summary?days=${days}`)
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => {})
  }, [days])

  const matchRate = summary
    ? summary.totals.swipes_right > 0
      ? ((summary.totals.matches / summary.totals.swipes_right) * 100).toFixed(1) + '%'
      : '0%'
    : '--'

  return (
    <div className="min-h-screen bg-black px-6 py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              href="/dashboard"
              className="text-white/40 hover:text-white/70 text-xs transition-colors mb-2 inline-block"
            >
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-500 via-purple-500 to-pink-400 bg-clip-text text-transparent">
              Analytics
            </h1>
          </div>
          <DateRangePicker value={days} onChange={setDays} />
        </div>

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
