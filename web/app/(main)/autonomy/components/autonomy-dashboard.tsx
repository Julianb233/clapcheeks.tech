'use client'

import { useState, useCallback, useTransition } from 'react'
import { createClient } from '@/lib/convex/client'
import {
  Zap, Shield, Eye, Bot, AlertCircle,
  Check, Clock, Activity, Target,
  Loader2, MessageSquare, ThumbsUp, ThumbsDown
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AutonomyLevel = 'supervised' | 'semi_auto' | 'full_auto' | 'custom'

interface AutonomyConfig {
  global_level: AutonomyLevel
  source: string
  approve_openers: boolean
  approve_replies: boolean
  approve_date_asks: boolean
  approve_bookings: boolean
  auto_respond_enabled: boolean
  require_approval_for_first_message: boolean
  ai_active: boolean | null
  ai_paused_until: string | null
  ai_paused_reason: string | null
  updated_at: string | null
}

interface QueueItem {
  id: string
  action_type: string
  match_name: string
  platform: string | null
  proposed_text: string | null
  proposed_data: Record<string, unknown>
  confidence: number | null
  ai_reasoning: string | null
  status: string
  created_at: string
  expires_at: string
}

interface AutoAction {
  id: string
  action_type: string
  match_name: string | null
  platform: string | null
  confidence: number | null
  status: string
  output_data: Record<string, unknown>
  created_at: string
}

interface PreferenceModel {
  version: number
  training_size: number
  accuracy: number | null
  weights: Record<string, number>
}

interface Props {
  initialConfig: AutonomyConfig
  initialQueue: QueueItem[]
  initialActions: AutoAction[]
  initialModel: PreferenceModel
  totalSwipeDecisions: number
  userId: string
}

// ---------------------------------------------------------------------------
// Level descriptions
// ---------------------------------------------------------------------------
const LEVEL_INFO: Record<AutonomyLevel, { label: string; desc: string; icon: React.ReactNode; color: string }> = {
  supervised: {
    label: 'Supervised',
    desc: 'Openers, replies, date asks, and bookings wait for review',
    icon: <Eye className="w-5 h-5" />,
    color: 'from-blue-500/20 to-blue-600/5 border-blue-500/30',
  },
  semi_auto: {
    label: 'Semi-Auto',
    desc: 'Replies can send; openers, dates, and bookings wait',
    icon: <Shield className="w-5 h-5" />,
    color: 'from-yellow-500/20 to-yellow-600/5 border-yellow-500/30',
  },
  full_auto: {
    label: 'Full Auto',
    desc: 'Only calendar booking still waits for review',
    icon: <Zap className="w-5 h-5" />,
    color: 'from-red-500/20 to-red-600/5 border-red-500/30',
  },
  custom: {
    label: 'Custom',
    desc: 'Stored approval flags do not match a preset',
    icon: <Bot className="w-5 h-5" />,
    color: 'from-white/10 to-white/5 border-white/20',
  },
}

const ACTION_LABELS: Record<string, string> = {
  auto_swipe: 'Auto Swipe',
  auto_respond: 'Auto Reply',
  auto_reengage: 'Re-engage',
  stale_recovery: 'Stale Recovery',
  stage_transition: 'Stage Move',
  date_booking: 'Date Booking',
  app_to_text: 'App → Text',
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
const TABS = ['overview', 'queue', 'log', 'model'] as const
type Tab = typeof TABS[number]
const TAB_LABELS: Record<Tab, { label: string; icon: React.ReactNode }> = {
  overview: { label: 'Overview', icon: <Activity className="w-4 h-4" /> },
  queue: { label: 'Approval Queue', icon: <AlertCircle className="w-4 h-4" /> },
  log: { label: 'Action Log', icon: <Clock className="w-4 h-4" /> },
  model: { label: 'Preference Model', icon: <Target className="w-4 h-4" /> },
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AutonomyDashboard({
  initialConfig,
  initialQueue,
  initialActions,
  initialModel,
  totalSwipeDecisions,
  userId,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [config, setConfig] = useState<AutonomyConfig>(initialConfig)
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue)
  const [actions, setActions] = useState<AutoAction[]>(initialActions)
  const [model] = useState<PreferenceModel>(initialModel)
  const [saving, setSaving] = useState(false)
  const [isPending, startTransition] = useTransition()

  const convex = createClient()

  // Save config changes
  const saveConfig = useCallback(async (updates: Partial<AutonomyConfig>) => {
    setSaving(true)
    try {
      const response = await fetch('/api/autonomy-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Autonomy save failed')
      setConfig(result.config)
    } catch (error) {
      console.error('autonomy save failed', error)
    } finally {
      setSaving(false)
    }
  }, [])

  // Approve/reject queue item
  const handleQueueAction = useCallback(async (id: string, status: 'approved' | 'rejected') => {
    startTransition(async () => {
      await convex
        .from('clapcheeks_approval_queue')
        .update({ status, decided_at: new Date().toISOString(), decided_by: 'user' })
        .eq('id', id)
        .eq('user_id', userId)

      setQueue(prev => prev.filter(item => item.id !== id))
    })
  }, [userId, convex])

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`
              flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all
              ${tab === t
                ? 'bg-gradient-to-r from-yellow-500/20 to-red-600/10 text-white border border-yellow-500/25'
                : 'text-white/50 hover:text-white hover:bg-white/5'}
            `}
          >
            {TAB_LABELS[t].icon}
            {TAB_LABELS[t].label}
            {t === 'queue' && queue.length > 0 && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                {queue.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Level Selector */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-yellow-400" />
              Autonomy Level
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(Object.entries(LEVEL_INFO).filter(([level]) => level !== 'custom') as [AutonomyLevel, typeof LEVEL_INFO[AutonomyLevel]][]).map(([level, info]) => (
                <button
                  key={level}
                  onClick={() => saveConfig({ global_level: level })}
                  className={`
                    relative p-4 rounded-xl border text-left transition-all
                    ${config.global_level === level
                      ? `bg-gradient-to-br ${info.color} shadow-lg`
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'}
                  `}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={config.global_level === level ? 'text-yellow-400' : 'text-white/40'}>
                      {info.icon}
                    </span>
                    <span className="font-medium">{info.label}</span>
                    {config.global_level === level && (
                      <Check className="w-4 h-4 text-green-400 ml-auto" />
                    )}
                  </div>
                  <p className="text-xs text-white/50">{info.desc}</p>
                </button>
              ))}
            </div>
            {config.global_level === 'custom' && (
              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50">
                Custom gates are active: openers {config.approve_openers ? 'review' : 'auto'}, replies {config.approve_replies ? 'review' : 'auto'}, date asks {config.approve_date_asks ? 'review' : 'auto'}, bookings {config.approve_bookings ? 'review' : 'auto'}.
              </div>
            )}
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Queue Depth"
              value={queue.length}
              icon={<AlertCircle className="w-4 h-4" />}
              color={queue.length > 5 ? 'text-red-400' : 'text-green-400'}
            />
            <StatCard
              label="Replies"
              value={config.approve_replies ? 'Review' : 'Auto'}
              icon={<MessageSquare className="w-4 h-4" />}
              color={config.approve_replies ? 'text-yellow-400' : 'text-red-400'}
            />
            <StatCard
              label="Openers"
              value={config.approve_openers ? 'Review' : 'Auto'}
              icon={<Target className="w-4 h-4" />}
              color={config.approve_openers ? 'text-yellow-400' : 'text-red-400'}
            />
            <StatCard
              label="Backend"
              value="Live"
              icon={<Activity className="w-4 h-4" />}
              color="text-green-400"
            />
          </div>

          {/* Runtime approval gates */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Bot className="w-5 h-5 text-yellow-400" />
              Runtime Approval Gates
              {saving && <Loader2 className="w-4 h-4 animate-spin text-white/40 ml-2" />}
            </h2>
            <div className="space-y-4">
              <Toggle
                label="Approve openers before sending"
                desc="Backed by clapcheeks_user_settings.approve_openers"
                enabled={config.approve_openers}
                onChange={v => saveConfig({ approve_openers: v } as Partial<AutonomyConfig>)}
              />
              <Toggle
                label="Approve replies before sending"
                desc="When off, the reply worker treats replies as auto-send eligible"
                enabled={config.approve_replies}
                onChange={v => saveConfig({ approve_replies: v } as Partial<AutonomyConfig>)}
              />
              <Toggle
                label="Approve date asks before sending"
                desc="Backed by clapcheeks_user_settings.approve_date_asks"
                enabled={config.approve_date_asks}
                onChange={v => saveConfig({ approve_date_asks: v } as Partial<AutonomyConfig>)}
              />
              <Toggle
                label="Approve calendar bookings"
                desc="Backed by clapcheeks_user_settings.approve_bookings"
                enabled={config.approve_bookings}
                onChange={v => saveConfig({ approve_bookings: v } as Partial<AutonomyConfig>)}
              />
              <Toggle
                label="AI active master switch"
                desc={config.ai_paused_reason ? String(config.ai_paused_reason) : 'Backed by clapcheeks_user_settings.ai_active'}
                enabled={config.ai_active !== false}
                onChange={v => saveConfig({ ai_active: v })}
              />
            </div>
            <div className="mt-5 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/40">
              Source: {config.source}. Last updated: {config.updated_at ? new Date(config.updated_at).toLocaleString() : 'unknown'}.
              {config.ai_paused_until ? ` Paused until: ${new Date(config.ai_paused_until).toLocaleString()}.` : ''}
            </div>
          </div>

          {/* Backend coverage */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
              Backend Coverage
            </h2>
            <div className="grid gap-2 text-sm">
              <CoverageRow label="Approval gates" status="Live" detail="Supabase settings row read by runtime workers" />
              <CoverageRow label="Approval queue" status="Live" detail="Convex queues mappings approve/reject items" />
              <CoverageRow label="Auto-swipe controls" status="Not exposed" detail="No live Convex mapping for autonomy model controls yet" muted />
              <CoverageRow label="Preference model" status="Not exposed" detail="No live Convex mapping for swipe training/model rows yet" muted />
            </div>
          </div>
        </div>
      )}

      {/* Approval Queue Tab */}
      {tab === 'queue' && (
        <div className="space-y-4">
          {queue.length === 0 ? (
            <div className="text-center py-16 bg-white/[0.03] border border-white/10 rounded-2xl">
              <Check className="w-10 h-10 text-green-400/50 mx-auto mb-3" />
              <p className="text-white/50 text-sm">All clear — no items awaiting approval</p>
            </div>
          ) : (
            queue.map(item => (
              <div key={item.id} className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                        {ACTION_LABELS[item.action_type] || item.action_type}
                      </span>
                      <span className="text-sm font-medium">{item.match_name}</span>
                      {item.platform && (
                        <span className="text-[10px] text-white/30 uppercase">{item.platform}</span>
                      )}
                    </div>

                    {item.proposed_text && (
                      <div className="mt-2 p-3 bg-white/5 rounded-lg text-sm text-white/80 border border-white/5">
                        &ldquo;{item.proposed_text}&rdquo;
                      </div>
                    )}

                    {item.ai_reasoning && (
                      <p className="mt-2 text-xs text-white/40">{item.ai_reasoning}</p>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-xs text-white/30">
                      {item.confidence !== null && (
                        <span className={`font-mono ${
                          item.confidence >= 80 ? 'text-green-400' :
                          item.confidence >= 50 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {item.confidence}% confidence
                        </span>
                      )}
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleQueueAction(item.id, 'approved')}
                      disabled={isPending}
                      className="px-3 py-2 rounded-lg bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 transition text-sm flex items-center gap-1.5"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => handleQueueAction(item.id, 'rejected')}
                      disabled={isPending}
                      className="px-3 py-2 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition text-sm flex items-center gap-1.5"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Action Log Tab */}
      {tab === 'log' && (
        <div className="space-y-2">
          {actions.length === 0 ? (
            <div className="text-center py-16 bg-white/[0.03] border border-white/10 rounded-2xl">
              <Clock className="w-10 h-10 text-white/20 mx-auto mb-3" />
              <p className="text-white/50 text-sm">Auto-action log is not exposed by the live Convex backend yet</p>
            </div>
          ) : (
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs text-white/40 uppercase tracking-wider">
                      <th className="text-left p-3">Action</th>
                      <th className="text-left p-3">Match</th>
                      <th className="text-left p-3">Confidence</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-left p-3">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map(action => (
                      <tr key={action.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="p-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                            {ACTION_LABELS[action.action_type] || action.action_type}
                          </span>
                        </td>
                        <td className="p-3 text-white/80">{action.match_name || '—'}</td>
                        <td className="p-3">
                          {action.confidence !== null ? (
                            <span className={`font-mono text-xs ${
                              action.confidence >= 80 ? 'text-green-400' :
                              action.confidence >= 50 ? 'text-yellow-400' : 'text-red-400'
                            }`}>
                              {action.confidence}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="p-3">
                          <span className={`text-xs ${
                            action.status === 'executed' ? 'text-green-400' :
                            action.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                          }`}>
                            {action.status}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-white/40">
                          {new Date(action.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preference Model Tab */}
      {tab === 'model' && (
        <div className="space-y-6">
          {model.version === 0 && totalSwipeDecisions === 0 ? (
            <div className="text-center py-16 bg-white/[0.03] border border-white/10 rounded-2xl">
              <Target className="w-10 h-10 text-white/20 mx-auto mb-3" />
              <p className="text-white/50 text-sm">Preference model data is not exposed by the live Convex backend yet</p>
            </div>
          ) : (
          <>
          {/* Model Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 text-center">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Model Version</p>
              <p className="text-3xl font-bold text-white">v{model.version}</p>
            </div>
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 text-center">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Training Samples</p>
              <p className="text-3xl font-bold text-white">{model.training_size}</p>
              <p className="text-xs text-white/30 mt-1">
                {totalSwipeDecisions >= 200
                  ? 'Ready for production'
                  : `${200 - totalSwipeDecisions} more needed`}
              </p>
            </div>
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 text-center">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Accuracy</p>
              <p className={`text-3xl font-bold ${
                model.accuracy && model.accuracy >= 70 ? 'text-green-400' :
                model.accuracy && model.accuracy >= 50 ? 'text-yellow-400' :
                model.accuracy ? 'text-red-400' : 'text-white/30'
              }`}>
                {model.accuracy ? `${model.accuracy}%` : '—'}
              </p>
              <p className="text-xs text-white/30 mt-1">Target: 70%+</p>
            </div>
          </div>

          {/* Progress bar toward 200 samples */}
          <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">Training Progress</h3>
              <span className="text-xs text-white/40">{totalSwipeDecisions} / 200 swipes</span>
            </div>
            <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-yellow-500 to-red-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min((totalSwipeDecisions / 200) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-white/40 mt-2">
              {totalSwipeDecisions >= 200
                ? 'Your preference model has enough data for accurate predictions.'
                : `Swipe ${200 - totalSwipeDecisions} more profiles manually to train the model.`}
            </p>
          </div>

          {/* Feature Weights */}
          {Object.keys(model.weights).length > 0 && (
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
              <h3 className="text-sm font-medium mb-4">Feature Weights</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(model.weights)
                  .filter(([k]) => k !== '_bias')
                  .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                  .map(([feature, weight]) => (
                    <div key={feature} className="p-2 bg-white/5 rounded-lg">
                      <p className="text-[10px] text-white/40 uppercase tracking-wider truncate">
                        {feature.replace(/_/g, ' ')}
                      </p>
                      <p className={`text-sm font-mono ${weight > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {weight > 0 ? '+' : ''}{weight.toFixed(3)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}
          </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-2 text-white/40 mb-1">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function Toggle({
  label, desc, enabled, onChange, small,
}: {
  label: string
  desc: string
  enabled: boolean
  onChange: (v: boolean) => void
  small?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${small ? 'py-1' : 'py-2'}`}>
      <div>
        <p className={`font-medium ${small ? 'text-sm' : ''}`}>{label}</p>
        <p className={`text-white/40 ${small ? 'text-[11px]' : 'text-xs'}`}>{desc}</p>
      </div>
      <button
        type="button"
        aria-label={label}
        aria-pressed={enabled}
        onClick={() => onChange(!enabled)}
        className={`shrink-0 transition-colors rounded-full ${
          small ? 'w-10 h-5' : 'w-12 h-6'
        } ${enabled ? 'bg-yellow-500' : 'bg-white/20'}`}
      >
        <div className={`
          bg-white rounded-full shadow transition-transform
          ${small ? 'w-4 h-4 mx-0.5' : 'w-5 h-5 mx-0.5'}
          ${enabled ? (small ? 'translate-x-5' : 'translate-x-6') : 'translate-x-0'}
        `} />
      </button>
    </div>
  )
}

function CoverageRow({ label, status, detail, muted }: { label: string; status: string; detail: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="min-w-0">
        <p className="text-white/80">{label}</p>
        <p className="text-xs text-white/40">{detail}</p>
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
        muted
          ? 'border-white/10 bg-white/5 text-white/40'
          : 'border-green-500/30 bg-green-500/10 text-green-300'
      }`}>
        {status}
      </span>
    </div>
  )
}
