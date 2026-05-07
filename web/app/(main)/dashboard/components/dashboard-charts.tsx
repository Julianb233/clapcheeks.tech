'use client'

import { useEffect, useState } from 'react'
import { SwipeMatchChart } from './analytics-charts'
import { RizzScoreCard } from './rizz-score-card'
import { PlatformBreakdown } from './platform-breakdown'
import { ConversionFunnel } from './conversion-funnel'
import { SpendingChart } from './spending-chart'

export interface AnalyticsSummary {
  totals: {
    swipes_right: number
    matches: number
    messages_sent: number
    dates_booked: number
    conversations: number
  }
  todaySwipes: number
  matchRate: number
  rizzScore: number
  rizzTrend: { direction: 'up' | 'down' | 'same'; delta: number }
  platforms: Record<string, { swipes_right: number; matches: number; messages_sent: number; dates_booked: number }>
  timeSeries: { date: string; swipes_right: number; matches: number }[]
  funnel: { stage: string; value: number }[]
  spending: {
    totalSpent: number
    costPerMatch: number
    costPerDate: number
    cpn?: number
    cpnGrade?: string
    cpnVerdict?: string
    cpnNuts?: number
    byCategory: Record<string, number>
  }
  trends: {
    swipes: { direction: 'up' | 'down' | 'same'; delta: number }
    matches: { direction: 'up' | 'down' | 'same'; delta: number }
    dates: { direction: 'up' | 'down' | 'same'; delta: number }
  }
}

interface DashboardChartsProps {
  initialData: AnalyticsSummary | null
  days?: number
}

export function DashboardCharts({ initialData, days }: DashboardChartsProps) {
  const [data, setData] = useState<AnalyticsSummary | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState<string | null>(null)
  const effectiveDays = days ?? 30

  const load = () => {
    setLoading(true)
    setError(null)
    fetch(`/api/analytics/summary?days=${effectiveDays}`)
      .then((r) => r.json())
      .then(setData)
      // AI-9574: surface error instead of silently swallowing it
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load analytics'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (initialData && !days) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, days, effectiveDays])

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-5 h-64 animate-pulse" />
        ))}
      </div>
    )
  }

  // AI-9574: show inline error card with retry button
  if (error) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <p className="text-amber-400 font-semibold text-sm">Analytics unavailable</p>
            <p className="text-white/40 text-xs mt-0.5 truncate">{error}</p>
          </div>
        </div>
        <button
          onClick={load}
          className="shrink-0 text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Rizz Score Card */}
      <RizzScoreCard
        score={data.rizzScore}
        trend={data.rizzTrend}
        matchRate={data.matchRate}
      />

      {/* Swipe & Match Trend */}
      <SwipeMatchChart data={data.timeSeries} />

      {/* Platform Breakdown + Conversion Funnel side by side on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <PlatformBreakdown data={data.platforms} />
        <ConversionFunnel data={data.funnel} />
      </div>

      {/* Spending */}
      <SpendingChart
        totalSpent={data.spending.totalSpent}
        costPerMatch={data.spending.costPerMatch}
        costPerDate={data.spending.costPerDate}
        cpn={data.spending.cpn}
        cpnGrade={data.spending.cpnGrade}
        cpnVerdict={data.spending.cpnVerdict}
        cpnNuts={data.spending.cpnNuts}
        byCategory={data.spending.byCategory}
      />
    </div>
  )
}
