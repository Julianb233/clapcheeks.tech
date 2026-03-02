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
  const effectiveDays = days ?? 30

  useEffect(() => {
    if (initialData && !days) return
    setLoading(true)
    fetch(`/api/analytics/summary?days=${effectiveDays}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [initialData, days, effectiveDays])

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-5 h-64 animate-pulse" />
        ))}
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PlatformBreakdown data={data.platforms} />
        <ConversionFunnel data={data.funnel} />
      </div>

      {/* Spending */}
      <SpendingChart
        totalSpent={data.spending.totalSpent}
        costPerMatch={data.spending.costPerMatch}
        costPerDate={data.spending.costPerDate}
        byCategory={data.spending.byCategory}
      />
    </div>
  )
}
