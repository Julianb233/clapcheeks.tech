'use client'

import { useEffect, useState, useCallback } from 'react'

// ── Constants ──────────────────────────────────────────────────────────
const ALL_PLATFORMS = [
  'tinder', 'bumble', 'hinge', 'grindr', 'badoo',
  'happn', 'okcupid', 'pof', 'feeld', 'cmb',
] as const

const DISPLAY_NAMES: Record<string, string> = {
  tinder: 'Tinder',
  bumble: 'Bumble',
  hinge: 'Hinge',
  grindr: 'Grindr',
  badoo: 'Badoo',
  happn: 'Happn',
  okcupid: 'OKCupid',
  pof: 'Plenty of Fish',
  feeld: 'Feeld',
  cmb: 'Coffee Meets Bagel',
}

const POLL_INTERVAL = 30_000 // 30 seconds

// ── Types ──────────────────────────────────────────────────────────────
interface PlatformStats {
  swipes_right: number
  matches: number
  messages_sent: number
  dates_booked: number
}

interface FunnelStep {
  stage: string
  value: number
}

interface SummaryData {
  totals: {
    swipes_right: number
    swipes_left: number
    matches: number
    messages_sent: number
    dates_booked: number
    conversations: number
  }
  todaySwipes: number
  platforms: Record<string, PlatformStats>
  funnel: FunnelStep[]
  spending?: {
    totalSpent: number
    costPerMatch: number
    costPerDate: number
    byCategory: Record<string, number>
  }
}

// Per-platform row for today
interface TodayPlatformRow {
  swipes: number
  matches: number
  conversations: number
  dates_booked: number
  spend: number
}

interface DashboardLiveProps {
  initialData: SummaryData | null
  hasAgent: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────
function healthBadge(todaySwipes: number, configured: boolean) {
  if (!configured) {
    return <span className="inline-block w-2 h-2 rounded-full bg-white/20" title="Not configured" />
  }
  if (todaySwipes > 0) {
    return <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" title="Active" />
  }
  return <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" title="Idle" />
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '0.0%'
  return ((num / denom) * 100).toFixed(1) + '%'
}

// ── Component ──────────────────────────────────────────────────────────
export default function DashboardLive({ initialData, hasAgent }: DashboardLiveProps) {
  const [data, setData] = useState<SummaryData | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics/summary')
      if (!res.ok) return
      const json = await res.json()
      setData(json)
      setLastUpdated(new Date())
    } catch {
      // silently ignore fetch errors — data stays stale
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll every 30 seconds. AI-9500: defer the first poll start until the
  // browser is idle so the live-updating timer doesn't compete with first
  // paint and worsen INP. requestIdleCallback isn't on TS lib.dom in all
  // configs, so guard the access.
  useEffect(() => {
    if (!hasAgent) return
    let interval: ReturnType<typeof setInterval> | null = null
    let idleHandle: number | null = null

    const startPolling = () => {
      interval = setInterval(fetchStats, POLL_INTERVAL)
    }

    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    if (typeof ric === 'function') {
      idleHandle = ric(startPolling, { timeout: 2000 })
    } else {
      // Safari fallback — defer with a short timeout so we still yield to paint
      idleHandle = window.setTimeout(startPolling, 1500) as unknown as number
    }

    return () => {
      if (interval) clearInterval(interval)
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
      if (idleHandle != null) {
        if (typeof cic === 'function') cic(idleHandle)
        else clearTimeout(idleHandle)
      }
    }
  }, [fetchStats, hasAgent])

  if (!hasAgent) return null
  if (loading || !data) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-5 animate-pulse">
        <div className="h-4 w-40 bg-white/10 rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-white/5 rounded" />
          ))}
        </div>
      </div>
    )
  }

  // Build today per-platform data from the summary platforms object
  // The API gives 30-day aggregates per platform; today-specific is from todaySwipes
  // We use 30-day data for the table breakdown
  const platformsFromApi = data.platforms || {}
  const configuredPlatforms = new Set(Object.keys(platformsFromApi))

  const todayTotals: TodayPlatformRow = {
    swipes: 0,
    matches: 0,
    conversations: 0,
    dates_booked: 0,
    spend: 0,
  }

  const platformRows = ALL_PLATFORMS.map((key) => {
    const stats = platformsFromApi[key]
    const isConfigured = configuredPlatforms.has(key)
    const row: TodayPlatformRow = {
      swipes: stats?.swipes_right || 0,
      matches: stats?.matches || 0,
      conversations: stats?.messages_sent || 0,
      dates_booked: stats?.dates_booked || 0,
      spend: 0, // spending not yet per-platform in API
    }
    todayTotals.swipes += row.swipes
    todayTotals.matches += row.matches
    todayTotals.conversations += row.conversations
    todayTotals.dates_booked += row.dates_booked
    todayTotals.spend += row.spend
    return { key, isConfigured, row }
  })

  // Conversation funnel from API data
  const funnel = data.funnel || [
    { stage: 'Swipes', value: data.totals.swipes_right },
    { stage: 'Matches', value: data.totals.matches },
    { stage: 'Conversations', value: data.totals.conversations || data.totals.messages_sent },
    { stage: 'Date-ready', value: Math.round((data.totals.conversations || data.totals.messages_sent) * 0.3) },
    { stage: 'Dates Booked', value: data.totals.dates_booked },
  ]

  // Ensure we have 5 stages for the display
  const funnelStages = [
    { label: 'Swipes', value: funnel[0]?.value ?? data.totals.swipes_right },
    { label: 'Matches', value: funnel[1]?.value ?? data.totals.matches },
    { label: 'Conversations', value: funnel[2]?.value ?? data.totals.messages_sent },
    { label: 'Date-ready', value: funnel[3]?.value ?? Math.round(data.totals.messages_sent * 0.3) },
    { label: 'Dates Booked', value: funnel[4]?.value ?? data.totals.dates_booked },
  ]

  return (
    <div className="space-y-6">
      {/* Last updated indicator */}
      <div className="flex items-center justify-end gap-2 text-white/20 text-xs">
        <div className="w-1.5 h-1.5 rounded-full bg-green-500/50 animate-pulse" />
        Live — updated {lastUpdated.toLocaleTimeString()}
      </div>

      {/* ── Conversation Funnel ─────────────────────────────────────── */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
          Conversion Funnel — Last 30 Days
        </h2>
        <div className="flex items-center gap-0 overflow-x-auto">
          {funnelStages.map((stage, i) => (
            <div key={stage.label} className="flex items-center">
              <div className="flex flex-col items-center min-w-[100px]">
                <span className="text-white font-bold text-lg">{stage.value.toLocaleString()}</span>
                <span className="text-white/50 text-xs mt-0.5">{stage.label}</span>
                {i > 0 && funnelStages[i - 1].value > 0 && (
                  <span className="text-purple-400 text-[10px] mt-1 font-medium">
                    {pct(stage.value, funnelStages[i - 1].value)}
                  </span>
                )}
              </div>
              {i < funnelStages.length - 1 && (
                <div className="text-white/20 mx-1 text-lg font-light shrink-0">&rarr;</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Platform Stats Table ────────────────────────────────────── */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
          All Platforms — Last 30 Days
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
                <th className="text-left py-2 pr-4 font-medium">Platform</th>
                <th className="text-right py-2 px-3 font-medium">Swipes</th>
                <th className="text-right py-2 px-3 font-medium">Matches</th>
                <th className="text-right py-2 px-3 font-medium">Conversations</th>
                <th className="text-right py-2 px-3 font-medium">Dates</th>
                <th className="text-right py-2 pl-3 font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              {/* Total row at top */}
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <td className="py-2.5 pr-4 font-semibold text-white">Total</td>
                <td className="py-2.5 px-3 text-right font-semibold text-white">{todayTotals.swipes.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-right font-semibold text-purple-400">{todayTotals.matches.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-right font-semibold text-white">{todayTotals.conversations.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-right font-semibold text-white">{todayTotals.dates_booked.toLocaleString()}</td>
                <td className="py-2.5 pl-3 text-right font-semibold text-white">
                  {todayTotals.spend > 0 ? `$${todayTotals.spend.toFixed(2)}` : '—'}
                </td>
              </tr>
              {platformRows.map(({ key, isConfigured, row }) => (
                <tr key={key} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      {healthBadge(row.swipes, isConfigured)}
                      <span className="text-white text-sm">{DISPLAY_NAMES[key]}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-white/70">{row.swipes > 0 ? row.swipes.toLocaleString() : '—'}</td>
                  <td className="py-2.5 px-3 text-right text-purple-400 font-medium">{row.matches > 0 ? row.matches.toLocaleString() : '—'}</td>
                  <td className="py-2.5 px-3 text-right text-white/70">{row.conversations > 0 ? row.conversations.toLocaleString() : '—'}</td>
                  <td className="py-2.5 px-3 text-right text-white/70">{row.dates_booked > 0 ? row.dates_booked.toLocaleString() : '—'}</td>
                  <td className="py-2.5 pl-3 text-right text-white/70">
                    {row.spend > 0 ? `$${row.spend.toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Health badge legend */}
        <div className="flex items-center gap-2 md:gap-4 mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] text-white/30">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" /> Active
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/30">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400" /> Idle
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/30">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/20" /> Not configured
          </div>
        </div>
      </div>
    </div>
  )
}
