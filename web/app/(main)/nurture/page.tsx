'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

type FollowupConfig = {
  id: string
  enabled: boolean
  delays_hours: number[]
  max_followups: number
  app_to_text_enabled: boolean
  warmth_threshold: number
  min_messages_before_transition: number
  optimal_send_start_hour: number
  optimal_send_end_hour: number
  quiet_hours_start: number
  quiet_hours_end: number
  timezone: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function NurturePage() {
  const [config, setConfig] = useState<FollowupConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [delaysText, setDelaysText] = useState('24, 72, 168')

  // Manual trigger form
  const [trigger, setTrigger] = useState({
    match_name: '',
    phone: '',
    last_message: '',
    conversation_summary: '',
  })
  const [triggerLoading, setTriggerLoading] = useState(false)
  const [triggerResult, setTriggerResult] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/followup-sequences')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to load config')
        return
      }
      setConfig(data.config)
      if (Array.isArray(data.config?.delays_hours)) {
        setDelaysText(data.config.delays_hours.join(', '))
      }
    } catch {
      setError('Failed to load nurture config')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  async function save(updates: Partial<FollowupConfig>) {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/followup-sequences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Save failed')
    } else {
      setConfig(data.config)
      setSavedAt(new Date().toLocaleTimeString())
    }
    setSaving(false)
  }

  async function saveDelays() {
    const parsed = delaysText
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n) && n > 0)
      .slice(0, 10)
    if (parsed.length === 0) {
      setError('Enter at least one positive delay (hours)')
      return
    }
    await save({ delays_hours: parsed })
  }

  async function fireManualTrigger() {
    if (!trigger.match_name) {
      setTriggerResult('Match name is required')
      return
    }
    setTriggerLoading(true)
    setTriggerResult(null)
    const res = await fetch('/api/followup-sequences/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_name: trigger.match_name,
        phone: trigger.phone || null,
        last_message: trigger.last_message || null,
        conversation_summary: trigger.conversation_summary || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setTriggerResult(`Error: ${data.error ?? 'unknown'}`)
    } else {
      setTriggerResult(
        `Scheduled step ${data.step + 1} for ${trigger.match_name}: ` +
          `fires ~${new Date(data.scheduled_at).toLocaleString()} (delay ${data.delay_hours}h)`
      )
      setTrigger({ match_name: '', phone: '', last_message: '', conversation_summary: '' })
    }
    setTriggerLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="text-white/40 text-sm">Loading nurture config...</div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="text-red-400 text-sm">{error ?? 'No config loaded'}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center text-sm">🌱</div>
            <h1 className="text-2xl md:text-3xl font-semibold">Nurture</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
              config.enabled
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-white/5 text-white/40 border-white/10'
            }`}>
              {config.enabled ? 'on' : 'off'}
            </span>
          </div>
          <p className="text-sm text-white/50 ml-11">
            Auto follow-up sequences and app-to-text transitions. Drafts land in{' '}
            <Link href="/scheduled" className="text-blue-400 hover:underline">Scheduled</Link>{' '}
            for your approval.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 ml-4">✕</button>
          </div>
        )}
        {savedAt && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm">
            Saved at {savedAt}
          </div>
        )}

        {/* Master toggle */}
        <Section title="Sequence">
          <Row label="Enabled" hint="Master switch — when off, no follow-ups are queued.">
            <Toggle checked={config.enabled} onChange={v => save({ enabled: v })} disabled={saving} />
          </Row>
          <Row label="Delays (hours)" hint="Comma-separated. e.g. 24, 72, 168 = day 1, day 3, day 7.">
            <div className="flex gap-2">
              <input
                value={delaysText}
                onChange={e => setDelaysText(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
              />
              <button
                onClick={saveDelays}
                disabled={saving}
                className="px-3 py-2 rounded-lg bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 text-xs hover:bg-emerald-600/40 disabled:opacity-50"
              >
                Save
              </button>
            </div>
            <div className="text-xs text-white/40 mt-1">Current: [{config.delays_hours.join(', ')}]</div>
          </Row>
          <Row label="Max follow-ups per match" hint="Stop after this many drafts even if delay slots remain.">
            <NumberInput
              value={config.max_followups}
              min={0}
              max={10}
              onCommit={v => save({ max_followups: v })}
              disabled={saving}
            />
          </Row>
        </Section>

        {/* App-to-text */}
        <Section title="App → Text Transition">
          <Row label="Enabled" hint="When a conversation gets warm, draft a polite ask to move to iMessage.">
            <Toggle
              checked={config.app_to_text_enabled}
              onChange={v => save({ app_to_text_enabled: v })}
              disabled={saving}
            />
          </Row>
          <Row label="Warmth threshold" hint="0.0–1.0. Higher = wait for more positive signal before asking.">
            <NumberInput
              value={config.warmth_threshold}
              min={0}
              max={1}
              step={0.05}
              onCommit={v => save({ warmth_threshold: v })}
              disabled={saving}
            />
          </Row>
          <Row label="Min messages before transition" hint="Don't ask before this many total messages exchanged.">
            <NumberInput
              value={config.min_messages_before_transition}
              min={1}
              max={50}
              onCommit={v => save({ min_messages_before_transition: v })}
              disabled={saving}
            />
          </Row>
        </Section>

        {/* Timing */}
        <Section title="Send Window">
          <Row label="Optimal start (local hour)" hint="Earliest hour to fire a follow-up in your timezone.">
            <HourSelect
              value={config.optimal_send_start_hour}
              onChange={v => save({ optimal_send_start_hour: v })}
              disabled={saving}
            />
          </Row>
          <Row label="Optimal end (local hour)" hint="Latest hour. Window is [start, end). Most clients pick 18 → 21.">
            <HourSelect
              value={config.optimal_send_end_hour}
              onChange={v => save({ optimal_send_end_hour: v })}
              disabled={saving}
            />
          </Row>
          <Row label="Quiet hours start" hint="Never schedule inside quiet hours.">
            <HourSelect
              value={config.quiet_hours_start}
              onChange={v => save({ quiet_hours_start: v })}
              disabled={saving}
            />
          </Row>
          <Row label="Quiet hours end" hint="Wraps midnight if end < start.">
            <HourSelect
              value={config.quiet_hours_end}
              onChange={v => save({ quiet_hours_end: v })}
              disabled={saving}
            />
          </Row>
          <Row label="Timezone" hint="IANA name. Default: America/Los_Angeles.">
            <input
              defaultValue={config.timezone}
              onBlur={e => {
                if (e.target.value && e.target.value !== config.timezone) {
                  save({ timezone: e.target.value })
                }
              }}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 w-full md:w-64"
            />
          </Row>
        </Section>

        {/* Manual trigger */}
        <Section title="Trigger Follow-up Manually">
          <p className="text-xs text-white/40 mb-3">
            Drops a pending follow-up draft for one match. The next un-fired step in the delay
            sequence is used. Useful when a match has gone cold and the auto-cron hasn&rsquo;t
            picked them up yet.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Match name *</label>
              <VoiceInput
                className="w-full h-auto bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                placeholder="e.g. Sofia"
                value={trigger.match_name}
                onChange={(v) => setTrigger(p => ({ ...p, match_name: v }))}
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Phone (optional, E.164)</label>
              <VoiceInput
                className="w-full h-auto bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                placeholder="+16195550123"
                value={trigger.phone}
                onChange={(v) => setTrigger(p => ({ ...p, phone: v }))}
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Last message from her (optional)</label>
              <VoiceTextarea
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 resize-none"
                rows={2}
                placeholder="What was the last thing she said?"
                value={trigger.last_message}
                onChange={(v) => setTrigger(p => ({ ...p, last_message: v }))}
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Conversation summary (optional)</label>
              <VoiceTextarea
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 resize-none"
                rows={3}
                placeholder="Quick context — what's the vibe, where did it stall, etc."
                value={trigger.conversation_summary}
                onChange={(v) => setTrigger(p => ({ ...p, conversation_summary: v }))}
              />
            </div>
            <button
              onClick={fireManualTrigger}
              disabled={triggerLoading}
              className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 text-sm font-medium transition-all disabled:opacity-50"
            >
              {triggerLoading ? 'Drafting...' : 'Draft follow-up'}
            </button>
            {triggerResult && (
              <div className={`text-sm p-3 rounded-lg border ${
                triggerResult.startsWith('Error')
                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              }`}>
                {triggerResult}
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0a0a14] border border-white/10 rounded-2xl p-5 md:p-6 mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60 mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-1">
        <label className="text-sm text-white/80">{label}</label>
      </div>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-xs text-white/40 mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-emerald-500' : 'bg-white/10'
      } disabled:opacity-50`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  )
}

function NumberInput({
  value, min, max, step = 1, onCommit, disabled,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onCommit: (v: number) => void
  disabled?: boolean
}) {
  const [local, setLocal] = useState(String(value))
  useEffect(() => { setLocal(String(value)) }, [value])
  return (
    <input
      type="number"
      value={local}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local)
        if (Number.isFinite(n) && n !== value) onCommit(n)
      }}
      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 w-32"
    />
  )
}

function HourSelect({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={e => onChange(parseInt(e.target.value, 10))}
      disabled={disabled}
      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 w-32"
    >
      {HOURS.map(h => (
        <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
      ))}
    </select>
  )
}
