'use client'

import { useState } from 'react'

interface AutonomyConfig {
  global_level: string
  auto_swipe_enabled: boolean
  auto_swipe_confidence_min: number
  auto_respond_enabled: boolean
  auto_respond_confidence_min: number
  stale_recovery_enabled: boolean
  stale_hours_threshold: number
}

interface ApprovalItem {
  id: string
  action_type: string
  match_name: string
  platform: string
  proposed_text?: string
  confidence: number
  created_at: string
  ai_reasoning?: string
}

interface AutoAction {
  id: string
  action_type: string
  match_name: string
  platform: string
  confidence: number
  status: string
  created_at: string
}

interface DashboardData {
  config: AutonomyConfig
  pendingApprovals: ApprovalItem[]
  recentActions: AutoAction[]
  preferenceModel: { version: number; training_size: number; accuracy: number | null }
  stats: {
    totalSwipeDecisions: number
    userSwipes: number
    autoSwipes: number
    avgAutoConfidence: number
    modelAccuracy: number | null
    modelVersion: number
    modelTrainingSize: number
  }
}

export default function AutonomyDashboard({ initialData }: { initialData: DashboardData }) {
  const [config, setConfig] = useState(initialData.config)
  const [pendingApprovals, setPendingApprovals] = useState(initialData.pendingApprovals)
  const { stats, recentActions, preferenceModel } = initialData

  const autonomyLevels = [
    { value: 'supervised', label: 'Supervised', desc: 'All actions require your approval' },
    { value: 'semi', label: 'Semi-Auto', desc: 'Auto-swipe + respond, dates need approval' },
    { value: 'full', label: 'Full Auto', desc: 'Everything automated, review edge cases only' },
  ]

  const modelReady = (stats.modelAccuracy ?? 0) >= 0.7
  const overallStatus = config.global_level === 'full' && modelReady
    ? 'full_auto'
    : config.global_level === 'semi' && modelReady
    ? 'semi_auto'
    : stats.modelTrainingSize > 0
    ? 'learning'
    : 'inactive'

  const statusColors: Record<string, string> = {
    full_auto: 'bg-green-500',
    semi_auto: 'bg-blue-500',
    learning: 'bg-amber-500',
    inactive: 'bg-white/20',
  }

  const statusLabels: Record<string, string> = {
    full_auto: 'Full Autonomy',
    semi_auto: 'Semi-Autonomous',
    learning: 'Learning',
    inactive: 'Inactive',
  }

  async function handleLevelChange(level: string) {
    setConfig({ ...config, global_level: level })
    try {
      await fetch('/api/autonomy-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ global_level: level }),
      })
    } catch (e) {
      console.error('Failed to update level', e)
    }
  }

  async function handleApproval(id: string, approved: boolean) {
    setPendingApprovals(prev => prev.filter(item => item.id !== id))
    try {
      await fetch(`/api/autonomy-approval/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: approved ? 'approved' : 'rejected' }),
      })
    } catch (e) {
      console.error('Failed to resolve approval', e)
    }
  }

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl md:text-4xl text-white uppercase tracking-wide">
              Autonomy Engine
            </h1>
            <p className="text-white/40 text-sm mt-1">
              AI confidence dashboard and approval controls
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${statusColors[overallStatus]} ${overallStatus !== 'inactive' ? 'animate-pulse' : ''}`} />
            <span className="text-white/60 text-sm font-medium">{statusLabels[overallStatus]}</span>
          </div>
        </div>

        {/* Confidence Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <ConfidenceCard
            label="Model Accuracy"
            value={stats.modelAccuracy != null ? `${Math.round(stats.modelAccuracy * 100)}%` : '--'}
            subtext={`${stats.modelTrainingSize} training samples`}
            status={modelReady ? 'good' : stats.modelTrainingSize > 0 ? 'warning' : 'inactive'}
          />
          <ConfidenceCard
            label="Auto Swipes"
            value={String(stats.autoSwipes)}
            subtext={`${stats.avgAutoConfidence}% avg confidence`}
            status={stats.autoSwipes > 0 ? 'good' : 'inactive'}
          />
          <ConfidenceCard
            label="Pending Approvals"
            value={String(pendingApprovals.length)}
            subtext="items need review"
            status={pendingApprovals.length > 5 ? 'warning' : pendingApprovals.length > 0 ? 'attention' : 'good'}
          />
          <ConfidenceCard
            label="Actions Today"
            value={String(recentActions.filter(a => isToday(a.created_at)).length)}
            subtext={`${recentActions.length} total recent`}
            status={recentActions.length > 0 ? 'good' : 'inactive'}
          />
        </div>

        {/* Autonomy Level Selector */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 mb-6">
          <h2 className="text-white font-semibold text-sm mb-4 uppercase tracking-wide">Autonomy Level</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {autonomyLevels.map(level => (
              <button
                key={level.value}
                onClick={() => handleLevelChange(level.value)}
                className={`text-left p-4 rounded-lg border transition-all ${
                  config.global_level === level.value
                    ? 'border-purple-500/50 bg-purple-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${
                    config.global_level === level.value ? 'bg-purple-400' : 'bg-white/20'
                  }`} />
                  <span className="text-white font-medium text-sm">{level.label}</span>
                </div>
                <p className="text-white/40 text-xs">{level.desc}</p>
              </button>
            ))}
          </div>
          {!modelReady && config.global_level !== 'supervised' && (
            <div className="mt-3 flex items-center gap-2 text-amber-400 text-xs">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span>Model accuracy below 70% threshold. Keep swiping to train it.</span>
            </div>
          )}
        </div>

        {/* Preference Model Stats */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 mb-6">
          <h2 className="text-white font-semibold text-sm mb-4 uppercase tracking-wide">Preference Model</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-white/40 text-xs mb-1">Version</p>
              <p className="text-white font-mono text-lg">v{preferenceModel.version || 0}</p>
            </div>
            <div>
              <p className="text-white/40 text-xs mb-1">Training Samples</p>
              <p className="text-white font-mono text-lg">{stats.modelTrainingSize}</p>
            </div>
            <div>
              <p className="text-white/40 text-xs mb-1">Accuracy</p>
              <p className={`font-mono text-lg ${modelReady ? 'text-green-400' : 'text-white'}`}>
                {stats.modelAccuracy != null ? `${Math.round(stats.modelAccuracy * 100)}%` : '--'}
              </p>
            </div>
            <div>
              <p className="text-white/40 text-xs mb-1">Threshold</p>
              <p className="text-white/60 font-mono text-lg">70%</p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-white/40 mb-1">
              <span>Training Progress</span>
              <span>{stats.modelTrainingSize} / 100 swipes</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div
                className="bg-purple-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, stats.modelTrainingSize)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Pending Approvals */}
        {pendingApprovals.length > 0 && (
          <div className="bg-white/[0.03] border border-amber-500/20 rounded-xl p-5 mb-6">
            <h2 className="text-white font-semibold text-sm mb-4 uppercase tracking-wide flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Pending Approvals ({pendingApprovals.length})
            </h2>
            <div className="space-y-3">
              {pendingApprovals.map(item => (
                <div key={item.id} className="bg-black/30 border border-white/10 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white text-sm font-medium truncate">{item.match_name}</span>
                        <span className="text-white/30 text-xs">{item.platform}</span>
                        <ActionTypeBadge type={item.action_type} />
                      </div>
                      {item.proposed_text && (
                        <p className="text-white/60 text-sm mt-1 italic">&ldquo;{item.proposed_text}&rdquo;</p>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-white/40 text-xs">
                          Confidence: {item.confidence ? `${Math.round(item.confidence * 100)}%` : '--'}
                        </span>
                        <span className="text-white/30 text-xs">
                          {formatTimeAgo(item.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleApproval(item.id, true)}
                        className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 text-xs rounded-lg transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleApproval(item.id, false)}
                        className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs rounded-lg transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Auto-Actions Log */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
          <h2 className="text-white font-semibold text-sm mb-4 uppercase tracking-wide">Recent Actions</h2>
          {recentActions.length === 0 ? (
            <p className="text-white/30 text-sm">No autonomous actions yet. Start swiping to train the model.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {recentActions.slice(0, 20).map(action => (
                <div key={action.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <ActionTypeBadge type={action.action_type} />
                  <div className="flex-1 min-w-0">
                    <span className="text-white/70 text-sm truncate block">{action.match_name || 'Unknown'}</span>
                  </div>
                  <span className="text-white/30 text-xs">{action.platform}</span>
                  <ConfidencePill confidence={action.confidence} />
                  <StatusPill status={action.status} />
                  <span className="text-white/20 text-xs whitespace-nowrap">{formatTimeAgo(action.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Sub-components

function ConfidenceCard({ label, value, subtext, status }: {
  label: string; value: string; subtext: string; status: string
}) {
  const colors: Record<string, string> = {
    good: 'border-green-500/20',
    warning: 'border-amber-500/20',
    attention: 'border-blue-500/20',
    inactive: 'border-white/[0.08]',
  }

  return (
    <div className={`bg-white/[0.03] border ${colors[status]} rounded-xl p-4`}>
      <p className="text-white/40 text-xs mb-1">{label}</p>
      <p className="text-white font-mono text-xl font-bold">{value}</p>
      <p className="text-white/30 text-xs mt-0.5">{subtext}</p>
    </div>
  )
}

function ActionTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    auto_swipe: 'bg-purple-500/20 text-purple-400',
    auto_respond: 'bg-blue-500/20 text-blue-400',
    auto_opener: 'bg-green-500/20 text-green-400',
    recovery: 'bg-amber-500/20 text-amber-400',
    date_ask: 'bg-pink-500/20 text-pink-400',
  }
  const labels: Record<string, string> = {
    auto_swipe: 'Swipe',
    auto_respond: 'Reply',
    auto_opener: 'Opener',
    recovery: 'Recovery',
    date_ask: 'Date Ask',
  }

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors[type] || 'bg-white/10 text-white/40'}`}>
      {labels[type] || type}
    </span>
  )
}

function ConfidencePill({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null
  const pct = Math.round(confidence * 100)
  const color = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400'
  return <span className={`text-xs font-mono ${color}`}>{pct}%</span>
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    executed: 'bg-green-500/20 text-green-400',
    queued: 'bg-amber-500/20 text-amber-400',
    rejected: 'bg-red-500/20 text-red-400',
    sent: 'bg-green-500/20 text-green-400',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors[status] || 'bg-white/10 text-white/40'}`}>
      {status}
    </span>
  )
}

function isToday(dateStr: string): boolean {
  return new Date(dateStr).toDateString() === new Date().toDateString()
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
