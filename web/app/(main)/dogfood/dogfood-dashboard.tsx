'use client'

import { useState } from 'react'

interface SuccessCriterion {
  passed: boolean
  actual: number | string
  target: number | string
  label: string
}

interface Props {
  health: Array<{
    date: string
    consecutive_streak: number
    days_active: number
    total_crashes: number
    weekly_summary: Record<string, unknown>
  }>
  friction: Array<{
    id: string
    title: string
    description: string
    severity: string
    category: string
    platform: string | null
    resolved: boolean
    resolution: string | null
    created_at: string
  }>
  reports: Array<{
    id: string
    week_start: string
    week_end: string
    metrics_snapshot: Record<string, unknown>
    created_at: string
  }>
  subscription: { status: string; plan_id: string } | null
  successCriteria: Record<string, SuccessCriterion>
  currentStreak: number
  totalCrashes: number
  unresolvedFriction: Array<{ id: string; title: string; severity: string; category: string }>
  blockers: Array<{ id: string; title: string }>
  allPassed: boolean
}

export default function DogfoodDashboard({
  health,
  friction,
  reports,
  subscription,
  successCriteria,
  currentStreak,
  totalCrashes,
  unresolvedFriction,
  blockers,
  allPassed,
}: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'friction' | 'reports'>('overview')

  const streakPct = Math.min(100, (currentStreak / 7) * 100)
  const streakColor = currentStreak >= 7 ? 'bg-green-500' : currentStreak >= 3 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="relative max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-display text-3xl md:text-4xl text-white uppercase tracking-wide">
            Dogfooding
          </h1>
          {allPassed ? (
            <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 font-bold">
              ALL CRITERIA MET
            </span>
          ) : (
            <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 font-bold">
              IN PROGRESS
            </span>
          )}
        </div>
        <p className="text-white/40 text-sm mb-8">
          Phase 33 — Full product validation for 1 week. Track agent health, friction points, and success criteria.
        </p>

        {/* Streak Progress Bar */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold text-sm">Agent Streak</h2>
            <span className="text-white/60 text-xs font-mono">{currentStreak}/7 days</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-3 mb-2">
            <div
              className={`${streakColor} rounded-full h-3 transition-all duration-500`}
              style={{ width: `${streakPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-white/30">
            {[1, 2, 3, 4, 5, 6, 7].map(d => (
              <span key={d} className={d <= currentStreak ? 'text-white/70' : ''}>
                Day {d}
              </span>
            ))}
          </div>
        </div>

        {/* Success Criteria Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {Object.entries(successCriteria).map(([key, c]) => (
            <div
              key={key}
              className={`border rounded-xl p-4 ${
                c.passed
                  ? 'bg-green-500/5 border-green-500/20'
                  : 'bg-white/[0.02] border-white/[0.08]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {c.passed ? (
                  <span className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                    <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-white/30" />
                  </span>
                )}
                <span className={`text-xs font-medium ${c.passed ? 'text-green-400' : 'text-white/60'}`}>
                  {String(c.actual)} / {String(c.target)}
                </span>
              </div>
              <p className="text-white/40 text-xs">{c.label}</p>
            </div>
          ))}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Crashes" value={String(totalCrashes)} bad={totalCrashes > 0} />
          <StatCard label="Friction Points" value={String(unresolvedFriction.length)} bad={blockers.length > 0} />
          <StatCard label="Subscription" value={subscription?.status || 'none'} bad={subscription?.status !== 'active'} />
          <StatCard label="Reports" value={String(reports.length)} bad={reports.length === 0} />
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 border-b border-white/10 pb-px">
          {(['overview', 'friction', 'reports'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-medium rounded-t-lg transition-colors ${
                activeTab === tab
                  ? 'bg-white/10 text-white border border-white/10 border-b-transparent -mb-px'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <OverviewTab health={health} />
        )}
        {activeTab === 'friction' && (
          <FrictionTab friction={friction} />
        )}
        {activeTab === 'reports' && (
          <ReportsTab reports={reports} />
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, bad }: { label: string; value: string; bad: boolean }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
      <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${bad ? 'text-red-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function OverviewTab({ health }: { health: Props['health'] }) {
  if (health.length === 0) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-8 text-center">
        <p className="text-white/40 text-sm mb-4">No health data yet.</p>
        <p className="text-white/30 text-xs">
          Install the agent on your Mac to start tracking:{' '}
          <code className="text-purple-400">bash scripts/install-mac-agent.sh</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {health.map(h => {
        const summary = h.weekly_summary as Record<string, unknown> || {}
        return (
          <div key={h.date} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/80 text-sm font-mono">{h.date}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${
                h.total_crashes === 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {h.total_crashes === 0 ? 'Clean' : `${h.total_crashes} crash${h.total_crashes > 1 ? 'es' : ''}`}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-white/40">Streak</span>
                <p className="text-white font-bold">{h.consecutive_streak} days</p>
              </div>
              <div>
                <span className="text-white/40">Active</span>
                <p className="text-white font-bold">{h.days_active} days</p>
              </div>
              <div>
                <span className="text-white/40">Platforms</span>
                <p className="text-white font-bold">
                  {(summary.platforms_used as string[] || []).join(', ') || '-'}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FrictionTab({ friction }: { friction: Props['friction'] }) {
  if (friction.length === 0) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-8 text-center">
        <p className="text-white/40 text-sm mb-4">No friction points logged yet.</p>
        <p className="text-white/30 text-xs">
          Log issues via CLI: <code className="text-purple-400">clapcheeks dogfood friction &quot;issue title&quot;</code>
        </p>
      </div>
    )
  }

  const severityColors: Record<string, string> = {
    blocker: 'bg-red-500/20 text-red-400 border-red-500/30',
    major: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    minor: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    cosmetic: 'bg-white/10 text-white/50 border-white/20',
  }

  return (
    <div className="space-y-2">
      {friction.map(f => (
        <div key={f.id} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityColors[f.severity] || severityColors.cosmetic}`}>
              {f.severity}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40 border border-white/10">
              {f.category}
            </span>
            {f.platform && (
              <span className="text-[10px] text-white/30">{f.platform}</span>
            )}
            {f.resolved && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                resolved
              </span>
            )}
          </div>
          <h3 className="text-white text-sm font-medium">{f.title}</h3>
          {f.description && f.description !== f.title && (
            <p className="text-white/40 text-xs mt-1">{f.description}</p>
          )}
          {f.resolution && (
            <p className="text-green-400/60 text-xs mt-1">Resolution: {f.resolution}</p>
          )}
          <p className="text-white/20 text-[10px] mt-2">{new Date(f.created_at).toLocaleString()}</p>
        </div>
      ))}
    </div>
  )
}

function ReportsTab({ reports }: { reports: Props['reports'] }) {
  if (reports.length === 0) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-8 text-center">
        <p className="text-white/40 text-sm mb-4">No weekly reports yet.</p>
        <p className="text-white/30 text-xs">
          Generate via CLI: <code className="text-purple-400">clapcheeks dogfood report</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {reports.map(r => {
        const snapshot = r.metrics_snapshot as Record<string, unknown> || {}
        const score = snapshot.dogfood_score as number | undefined
        const criteria = snapshot.success_criteria as Record<string, { passed: boolean }> | undefined

        return (
          <div key={r.id} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-white text-sm font-medium">
                  Week of {r.week_start}
                </h3>
                <p className="text-white/30 text-xs">{r.week_start} - {r.week_end}</p>
              </div>
              {score !== undefined && (
                <div className={`text-2xl font-bold ${
                  score >= 70 ? 'text-green-400' : score >= 40 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {score}
                  <span className="text-xs text-white/30 ml-1">/100</span>
                </div>
              )}
            </div>
            {criteria && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(criteria).map(([key, c]) => (
                  <span
                    key={key}
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      c.passed ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {key.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
