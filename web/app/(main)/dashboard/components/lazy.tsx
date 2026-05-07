'use client'

/**
 * AI-9500: client-side dynamic-import wrappers for the dashboard's heavy
 * below-the-fold components.
 *
 * Why this file exists: in Next 15, `dynamic({ ssr: false })` cannot be
 * called from a Server Component. The dashboard page is a Server Component
 * (it runs `await createClient()` for Supabase). So we route the lazy loads
 * through these tiny client-component wrappers, which forward props through
 * to the real components.
 *
 * Effect on the page bundle:
 *   - Recharts (~250KB minified) is no longer in the initial JS — it loads
 *     after first paint when the user is most likely to interact, dramatically
 *     reducing main-thread work and INP on the dashboard.
 *   - CoachingSection + IMessageTestPanel (both client components with their
 *     own state + polling + lucide icons) also defer.
 *
 * The components keep their original behavior; only the load timing changes.
 */

import dynamic from 'next/dynamic'
import type { AnalyticsSummary } from './dashboard-charts'

interface CoachingTip {
  category: string
  title: string
  tip: string
  supporting_data: string
  priority: string
}
interface CoachingSession {
  id: string
  tips: CoachingTip[]
  generated_at: string
  feedback: { tip_index: number; helpful: boolean }[]
}

export const DashboardChartsLazy = dynamic<{
  initialData: AnalyticsSummary | null
  days?: number
}>(
  () => import('./dashboard-charts').then((m) => m.DashboardCharts),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white/5 border border-white/10 rounded-xl h-64 animate-pulse"
          />
        ))}
      </div>
    ),
  },
)

export const CoachingSectionLazy = dynamic<{
  initialSession: CoachingSession | null
}>(() => import('./coaching-section'), {
  ssr: false,
  loading: () => (
    <div className="bg-white/5 border border-white/10 rounded-xl h-32 animate-pulse" />
  ),
})

export const IMessageTestPanelLazy = dynamic(() => import('./imessage-test-panel'), {
  ssr: false,
  loading: () => (
    <div className="bg-white/5 border border-white/10 rounded-xl h-24 animate-pulse" />
  ),
})
