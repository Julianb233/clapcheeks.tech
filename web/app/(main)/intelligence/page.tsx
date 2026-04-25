'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Stats {
  opener_reply_rate: number
  by_platform: Record<string, number>
  stage_funnel: { opened: number; replied: number; date_ready: number; booked: number }
  top_openers: { text: string; reply_rate: number; platform: string }[]
  best_send_time: { hour: number; day: string } | null
  trend: { this_week: number; last_week: number }
  heatmap: { day: number; hour: number; total: number; replied: number }[]
}

// Derive a human-readable "communication persona" from match reply patterns
function getPersona(replyRate: number): { label: string; color: string; desc: string } {
  if (replyRate >= 0.6) return { label: 'Engaged Texter', color: 'text-green-400', desc: 'Replies quickly and often — high interest signal.' }
  if (replyRate >= 0.35) return { label: 'Selective Responder', color: 'text-amber-400', desc: 'Responds selectively — quality over frequency.' }
  return { label: 'Slow Burn', color: 'text-blue-400', desc: 'Takes time to warm up — patience pays off.' }
}

// Infer what communication style works best from A/B data
function getBestStyle(styles: { style: string; reply_rate: number }[]): string {
  if (!styles.length) return 'No data yet'
  const best = [...styles].sort((a, b) => b.reply_rate - a.reply_rate)[0]
  return best.style.charAt(0).toUpperCase() + best.style.slice(1)
}

interface ABResult {
  styles: { style: string; sent: number; reply_rate: number }[]
  winner: string | null
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function IntelligencePage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [abTest, setAbTest] = useState<ABResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, abRes] = await Promise.all([
          fetch('/api/intelligence/stats'),
          fetch('/api/intelligence/ab-test'),
        ])

        if (statsRes.ok) setStats(await statsRes.json())
        if (abRes.ok) setAbTest(await abRes.json())
      } catch {
        // silent in production
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white/40 text-sm">Loading intelligence data...</div>
      </div>
    )
  }

  const funnel = stats?.stage_funnel || { opened: 0, replied: 0, date_ready: 0, booked: 0 }
  const funnelSteps = [
    { label: 'Opened', value: funnel.opened },
    { label: 'Replied', value: funnel.replied },
    { label: 'Date-ready', value: funnel.date_ready },
    { label: 'Booked', value: funnel.booked },
  ]

  const trendDelta = stats
    ? Math.round((stats.trend.this_week - stats.trend.last_week) * 100)
    : 0

  // Build heatmap grid (7 days x 24 hours)
  const heatmapGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const cell of stats?.heatmap || []) {
    if (cell.total > 0) {
      heatmapGrid[cell.day][cell.hour] = cell.replied / cell.total
    }
  }
  const maxRate = Math.max(...heatmapGrid.flat(), 0.01)

  return (
    <div className="min-h-screen bg-black px-6 py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Conversation Intelligence</h1>
            <p className="text-white/40 text-sm mt-1">Opener performance, A/B testing, and conversion analytics</p>
          </div>
          <Link
            href="/dashboard"
            className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
          >
            Back to Dashboard
          </Link>
        </div>

        {/* Section 1: Opener Performance */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 mb-6">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Opener Performance</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Reply rate big number */}
            <div className="flex flex-col items-center justify-center bg-white/[0.03] rounded-xl p-6">
              <span className="text-4xl font-bold text-white">
                {stats ? `${Math.round(stats.opener_reply_rate * 100)}%` : '--'}
              </span>
              <span className="text-white/40 text-xs mt-1">Overall Reply Rate</span>
              {trendDelta !== 0 && (
                <span className={`text-xs mt-2 ${trendDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {trendDelta > 0 ? '+' : ''}{trendDelta}% vs last week
                </span>
              )}
            </div>

            {/* By-platform breakdown */}
            <div className="md:col-span-2">
              <h3 className="text-white/60 text-xs font-medium mb-3">By Platform</h3>
              <div className="space-y-3">
                {stats && Object.entries(stats.by_platform).length > 0 ? (
                  Object.entries(stats.by_platform).map(([platform, rate]) => (
                    <div key={platform}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white/70 text-sm capitalize">{platform}</span>
                        <span className="text-white/50 text-xs">{Math.round(rate * 100)}%</span>
                      </div>
                      <div className="w-full h-2 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                          style={{ width: `${Math.round(rate * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-white/30 text-xs">No platform data yet. Send some openers to start tracking.</p>
                )}
              </div>
            </div>
          </div>

          {/* Top openers */}
          {stats && stats.top_openers.length > 0 && (
            <div className="mt-6">
              <h3 className="text-white/60 text-xs font-medium mb-3">Top Performing Openers</h3>
              <div className="space-y-2">
                {stats.top_openers.map((opener, i) => (
                  <div key={i} className="flex items-start gap-3 bg-white/[0.03] rounded-lg p-3">
                    <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${
                      opener.reply_rate >= 0.5 ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/50'
                    }`}>
                      {Math.round(opener.reply_rate * 100)}%
                    </span>
                    <span className="text-white/70 text-sm flex-1 break-words">{opener.text}</span>
                    <span className="text-white/30 text-xs capitalize shrink-0">{opener.platform}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Section 2: Conversation Funnel */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 mb-6">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Conversation Funnel</h2>

          <div className="flex items-end gap-2 md:gap-4 justify-center">
            {funnelSteps.map((step, i) => {
              const maxVal = Math.max(...funnelSteps.map(s => s.value), 1)
              const height = Math.max((step.value / maxVal) * 120, 8)
              const convRate = i > 0 && funnelSteps[i - 1].value > 0
                ? Math.round((step.value / funnelSteps[i - 1].value) * 100)
                : null

              return (
                <div key={step.label} className="flex flex-col items-center flex-1">
                  {convRate !== null && (
                    <span className="text-white/30 text-[10px] mb-1">{convRate}%</span>
                  )}
                  <div
                    className="w-full max-w-[80px] rounded-t-lg bg-gradient-to-t from-purple-600 to-pink-500 transition-all duration-500"
                    style={{ height: `${height}px` }}
                  />
                  <div className="mt-2 text-center">
                    <div className="text-white font-semibold text-sm">{step.value}</div>
                    <div className="text-white/40 text-[10px]">{step.label}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Section 3: A/B Opener Test */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 mb-6">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">A/B Opener Test</h2>

          {abTest && abTest.styles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {abTest.styles.slice(0, 3).map((style) => (
                <div
                  key={style.style}
                  className={`rounded-xl p-4 border ${
                    style.style === abTest.winner
                      ? 'bg-green-900/20 border-green-700/40'
                      : 'bg-white/[0.03] border-white/[0.08]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white/70 text-sm font-medium capitalize">{style.style}</span>
                    {style.style === abTest.winner && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                        WINNER
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-white mb-1">
                    {Math.round(style.reply_rate * 100)}%
                  </div>
                  <div className="text-white/30 text-xs">{style.sent} openers sent</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/30 text-xs">
              No A/B test data yet. Tag your openers with different styles to compare performance.
            </p>
          )}
        </div>

        {/* Section: Match Communication Style */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 mb-6">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-1">
            How Your Matches Communicate
          </h2>
          <p className="text-white/30 text-xs mb-5">
            Based on reply patterns, timing, and which opener styles get responses — this is how your matches behave.
          </p>

          {stats ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Communication persona */}
              <div className="bg-white/[0.03] rounded-xl p-4">
                <div className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Overall Persona</div>
                {(() => {
                  const p = getPersona(stats.opener_reply_rate)
                  return (
                    <>
                      <div className={`text-lg font-bold mb-1 ${p.color}`}>{p.label}</div>
                      <div className="text-white/40 text-xs leading-relaxed">{p.desc}</div>
                    </>
                  )
                })()}
              </div>

              {/* Best response style */}
              <div className="bg-white/[0.03] rounded-xl p-4">
                <div className="text-white/40 text-[10px] uppercase tracking-wider mb-2">They Respond Best To</div>
                <div className="text-lg font-bold text-white mb-1">
                  {abTest ? getBestStyle(abTest.styles) : 'Warm'}
                </div>
                <div className="text-white/40 text-xs leading-relaxed">
                  {abTest?.winner
                    ? `"${abTest.winner}" openers get the most replies across your matches.`
                    : 'Run the A/B test longer to see which style wins.'}
                </div>
              </div>

              {/* Response timing */}
              <div className="bg-white/[0.03] rounded-xl p-4">
                <div className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Best Time to Message</div>
                <div className="text-lg font-bold text-white mb-1">
                  {stats.best_send_time
                    ? `${stats.best_send_time.day} ${stats.best_send_time.hour}:00`
                    : 'Eve / Weekends'}
                </div>
                <div className="text-white/40 text-xs leading-relaxed">
                  {stats.best_send_time
                    ? 'Highest reply rate based on when you send.'
                    : 'Need more data — send more messages to calibrate.'}
                </div>
              </div>

              {/* Conversion breakdown */}
              <div className="bg-white/[0.03] rounded-xl p-4 md:col-span-3">
                <div className="text-white/40 text-[10px] uppercase tracking-wider mb-3">Conversion Rates</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(() => {
                    const f = stats.stage_funnel
                    const rates = [
                      { label: 'Open → Reply',     value: f.opened  > 0 ? ((f.replied    / f.opened)  * 100).toFixed(0) + '%' : '—' },
                      { label: 'Reply → Date-Ready', value: f.replied > 0 ? ((f.date_ready / f.replied) * 100).toFixed(0) + '%' : '—' },
                      { label: 'Date-Ready → Booked', value: f.date_ready > 0 ? ((f.booked / f.date_ready) * 100).toFixed(0) + '%' : '—' },
                      { label: 'Open → Date',      value: f.opened  > 0 ? ((f.booked     / f.opened)  * 100).toFixed(0) + '%' : '—' },
                    ]
                    return rates.map(r => (
                      <div key={r.label} className="text-center">
                        <div className="text-2xl font-bold text-white">{r.value}</div>
                        <div className="text-white/35 text-[10px] mt-0.5">{r.label}</div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-white/30 text-xs">
              No data yet. Once your agent is running and messages are flowing, communication patterns will appear here.
            </p>
          )}
        </div>

        {/* Section 4: Best Send Times */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 mb-6">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Best Send Times</h2>

          {stats?.best_send_time && (
            <p className="text-white/50 text-xs mb-4">
              Best time to send: <span className="text-white font-medium">{stats.best_send_time.day} at {stats.best_send_time.hour}:00</span>
            </p>
          )}

          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Hour labels */}
              <div className="flex gap-px mb-1 ml-10">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="flex-1 text-center text-[9px] text-white/20">
                    {h % 3 === 0 ? `${h}` : ''}
                  </div>
                ))}
              </div>

              {/* Heatmap rows */}
              {DAY_LABELS.map((dayLabel, dayIdx) => (
                <div key={dayLabel} className="flex items-center gap-px mb-px">
                  <span className="text-white/30 text-[10px] w-10 text-right pr-2 shrink-0">{dayLabel}</span>
                  {heatmapGrid[dayIdx].map((rate, hour) => {
                    const intensity = maxRate > 0 ? rate / maxRate : 0
                    const bg = intensity > 0.7
                      ? 'bg-green-500'
                      : intensity > 0.4
                      ? 'bg-green-600/70'
                      : intensity > 0.1
                      ? 'bg-green-800/50'
                      : 'bg-white/[0.04]'
                    return (
                      <div
                        key={hour}
                        className={`flex-1 aspect-square rounded-sm ${bg} transition-colors`}
                        title={`${dayLabel} ${hour}:00 — ${Math.round(rate * 100)}% reply rate`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <span className="text-white/20 text-[10px]">Low</span>
            <div className="flex gap-px">
              <div className="w-3 h-3 rounded-sm bg-white/[0.04]" />
              <div className="w-3 h-3 rounded-sm bg-green-800/50" />
              <div className="w-3 h-3 rounded-sm bg-green-600/70" />
              <div className="w-3 h-3 rounded-sm bg-green-500" />
            </div>
            <span className="text-white/20 text-[10px]">High</span>
          </div>
        </div>
      </div>
    </div>
  )
}
