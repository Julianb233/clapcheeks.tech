'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VoiceInput, VoiceTextarea } from '@/components/voice'
import { CalendarConnectCard } from '@/components/settings/calendar-connect-card'
import DripRuleBuilder from '@/components/settings/drip-rule-builder'

export type Persona = {
  first_name: string
  age: number
  location: string
  occupation: string
  height_in: number
  voice_style: string
  humor_flavor: string
  signature_phrases: string[]
  banned_words: string[]
  confidence_anchors: string[]
  attraction_hooks: string[]
  best_stories: string[]
  values: string[]
  date_proposal_style: string
  avoid_topics: string[]
}

export type UserSettings = {
  persona: Persona
  dripRulesYaml: string
  styleText: string
  dateCalendarEmail: string
  dateSlots: string[]
  dateSlotDaysAhead: number
  dateSlotDurationHours: number
  dateTimezone: string
  approveOpeners: boolean
  approveReplies: boolean
  approveDateAsks: boolean
  approveBookings: boolean
}

// Tabs ordered per sidebar-audit Fix D recommended IA:
//   Persona / Drip / Reports / Calendar / Approval Gates
const TABS = [
  { key: 'persona', label: 'Persona' },
  { key: 'drip', label: 'Drip' },
  { key: 'reports', label: 'Reports' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'approval', label: 'Approval Gates' },
] as const

type TabKey = (typeof TABS)[number]['key']

const REPORT_DAYS = [
  { value: 'monday', label: 'Monday' },
  { value: 'friday', label: 'Friday' },
  { value: 'sunday', label: 'Sunday' },
] as const

export default function SettingsForm({
  initial,
  userId,
}: {
  initial: UserSettings
  userId: string
}) {
  const [tab, setTab] = useState<TabKey>('persona')
  const [settings, setSettings] = useState<UserSettings>(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // ── Reports tab state (lives on a different table via a different API) ──
  const [reportsLoaded, setReportsLoaded] = useState(false)
  const [reportsEmailEnabled, setReportsEmailEnabled] = useState(true)
  const [reportsSendDay, setReportsSendDay] = useState('monday')
  const [reportsSaving, setReportsSaving] = useState(false)
  const [reportsMessage, setReportsMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadReports() {
      try {
        const res = await fetch('/api/reports/preferences')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        if (typeof data.email_enabled === 'boolean') {
          setReportsEmailEnabled(data.email_enabled)
        }
        if (data.send_day) {
          setReportsSendDay(data.send_day)
        }
      } finally {
        if (!cancelled) setReportsLoaded(true)
      }
    }
    loadReports()
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }))
  }
  function setPersona<K extends keyof Persona>(key: K, value: Persona[K]) {
    setSettings((s) => ({ ...s, persona: { ...s.persona, [key]: value } }))
  }

  async function save() {
    setSaving(true)
    setMessage('')
    const supabase = createClient()
    const payload = {
      user_id: userId,
      persona: settings.persona,
      drip_rules_yaml: settings.dripRulesYaml,
      style_text: settings.styleText,
      date_calendar_email: settings.dateCalendarEmail,
      date_slots: settings.dateSlots,
      date_slot_days_ahead: settings.dateSlotDaysAhead,
      date_slot_duration_hours: settings.dateSlotDurationHours,
      date_timezone: settings.dateTimezone,
      approve_openers: settings.approveOpeners,
      approve_replies: settings.approveReplies,
      approve_date_asks: settings.approveDateAsks,
      approve_bookings: settings.approveBookings,
    }
    const { error } = await supabase
      .from('clapcheeks_user_settings')
      .upsert(payload, { onConflict: 'user_id' })
    setSaving(false)
    setMessage(error ? `Error: ${error.message}` : 'Saved.')
    if (!error) setTimeout(() => setMessage(''), 3000)
  }

  async function saveReports() {
    setReportsSaving(true)
    setReportsMessage('')
    try {
      const res = await fetch('/api/reports/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_enabled: reportsEmailEnabled,
          send_day: reportsSendDay,
        }),
      })
      if (res.ok) {
        setReportsMessage('Preferences saved')
        setTimeout(() => setReportsMessage(''), 3000)
      } else {
        setReportsMessage('Could not save')
      }
    } finally {
      setReportsSaving(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 ${
              tab === t.key
                ? 'border-white text-white'
                : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'persona' && (
        <section className="space-y-4">
          <Row label="First name">
            <TextInput value={settings.persona.first_name} onChange={(v) => setPersona('first_name', v)} />
          </Row>
          <Row label="Age">
            <NumberInput value={settings.persona.age} onChange={(v) => setPersona('age', v)} />
          </Row>
          <Row label="Occupation">
            <TextInput value={settings.persona.occupation} onChange={(v) => setPersona('occupation', v)} placeholder="your job or lifestyle hook" />
          </Row>
          <Row label="Location">
            <TextInput value={settings.persona.location} onChange={(v) => setPersona('location', v)} />
          </Row>
          <Row label="Height (inches)">
            <NumberInput value={settings.persona.height_in} onChange={(v) => setPersona('height_in', v)} />
          </Row>
          <Row label="Voice style">
            <TextInput value={settings.persona.voice_style} onChange={(v) => setPersona('voice_style', v)} />
          </Row>
          <Row label="Humor flavor">
            <TextInput value={settings.persona.humor_flavor} onChange={(v) => setPersona('humor_flavor', v)} />
          </Row>

          <Row label="Attraction hooks" hint="Things that make you attractive to women. One per line. AI will weave these in naturally.">
            <ListInput value={settings.persona.attraction_hooks} onChange={(v) => setPersona('attraction_hooks', v)} placeholder={"a quirky thing you do\na strong opinion you hold\na specific obsession"} rows={4} />
          </Row>
          <Row label="Confidence anchors" hint="True things about you to reference casually (never brag).">
            <ListInput value={settings.persona.confidence_anchors} onChange={(v) => setPersona('confidence_anchors', v)} rows={3} />
          </Row>
          <Row label="Best stories" hint="Short prose the AI can pull on as anchors.">
            <ListInput value={settings.persona.best_stories} onChange={(v) => setPersona('best_stories', v)} rows={4} />
          </Row>
          <Row label="Signature phrases" hint="Words/phrases you actually use.">
            <ListInput value={settings.persona.signature_phrases} onChange={(v) => setPersona('signature_phrases', v)} rows={2} />
          </Row>
          <Row label="Banned words" hint="Never let the AI use these.">
            <ListInput value={settings.persona.banned_words} onChange={(v) => setPersona('banned_words', v)} rows={2} />
          </Row>
          <Row label="Values">
            <ListInput value={settings.persona.values} onChange={(v) => setPersona('values', v)} rows={2} />
          </Row>
          <Row label="Avoid topics">
            <ListInput value={settings.persona.avoid_topics} onChange={(v) => setPersona('avoid_topics', v)} rows={2} />
          </Row>
          <Row label="Date-ask style">
            <TextInput value={settings.persona.date_proposal_style} onChange={(v) => setPersona('date_proposal_style', v)} />
          </Row>
        </section>
      )}

      {tab === 'drip' && (
        <section className="space-y-4">
          <p className="text-sm text-white/60">
            Build rules visually — each rule fires at most once per match. Use
            &ldquo;Edit raw YAML&rdquo; below if you need to drop into the
            underlying syntax.
          </p>
          <DripRuleBuilder
            value={settings.dripRulesYaml}
            onChange={(v) => set('dripRulesYaml', v)}
          />
          <Row label="Global tone / style (free-form)">
            <VoiceTextarea
              value={settings.styleText}
              onChange={(v) => set('styleText', v)}
              rows={3}
              className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm"
            />
          </Row>
        </section>
      )}

      {tab === 'reports' && (
        <section className="space-y-4">
          <p className="text-sm text-white/60">
            Get a weekly recap of your dating funnel — swipes, matches, dates, top patterns.
          </p>
          {!reportsLoaded ? (
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 animate-pulse h-32" />
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4">Weekly Reports</h3>
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reportsEmailEnabled}
                    onChange={(e) => setReportsEmailEnabled(e.target.checked)}
                    className="rounded border-white/20 bg-white/5 w-4 h-4 accent-fuchsia-600"
                  />
                  <span className="text-white/60 text-sm">Email weekly reports</span>
                </label>

                <div>
                  <label className="text-white/40 text-xs block mb-1">Report day</label>
                  <select
                    value={reportsSendDay}
                    onChange={(e) => setReportsSendDay(e.target.value)}
                    className="w-full max-w-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none appearance-none"
                  >
                    {REPORT_DAYS.map((d) => (
                      <option key={d.value} value={d.value} className="bg-black">
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={saveReports}
                    disabled={reportsSaving}
                    className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {reportsSaving ? 'Saving...' : 'Save report preferences'}
                  </button>
                  {reportsMessage && (
                    <span className="text-emerald-400 text-sm">{reportsMessage}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'calendar' && (
        <section className="space-y-6">
          <p className="text-sm text-white/60">
            Connect Google Calendar so the AI can read your availability and book dates without you.
          </p>
          <CalendarConnectCard nextPath="/settings" />

          <div className="border-t border-white/10 pt-6 space-y-4">
            <h3 className="text-white font-semibold text-sm">Date booking defaults</h3>
            <Row label="Calendar to book on (email)" hint="The Google calendar that receives date events.">
              <TextInput value={settings.dateCalendarEmail} onChange={(v) => set('dateCalendarEmail', v)} placeholder="you@example.com" />
            </Row>
            <Row label="Date slot times (one per line, HH:MM)" hint="Up to N slots per day — default 3.">
              <ListInput value={settings.dateSlots} onChange={(v) => set('dateSlots', v)} rows={4} placeholder={"18:00\n20:00\n21:30"} />
            </Row>
            <Row label="Days ahead to offer">
              <NumberInput value={settings.dateSlotDaysAhead} onChange={(v) => set('dateSlotDaysAhead', v)} />
            </Row>
            <Row label="Event duration (hours)">
              <NumberInput value={settings.dateSlotDurationHours} onChange={(v) => set('dateSlotDurationHours', v)} step={0.5} />
            </Row>
            <Row label="Timezone (IANA)">
              <TextInput value={settings.dateTimezone} onChange={(v) => set('dateTimezone', v)} placeholder="America/New_York" />
            </Row>
            <p className="text-xs text-white/50">
              These map directly to the agent&apos;s <code>DATE_CALENDAR_EMAIL</code>, <code>DATE_SLOTS</code>,
              <code> DATE_SLOT_DAYS_AHEAD</code>, <code>DATE_SLOT_DURATION_HOURS</code>, and
              <code> DATE_TIMEZONE</code> env vars. The daemon reads them on next tick.
            </p>
          </div>
        </section>
      )}

      {tab === 'approval' && (
        <section className="space-y-2">
          <p className="text-sm text-white/60 mb-4">
            When checked, the AI drafts the message and waits for your approval instead of auto-sending.
          </p>
          <Toggle label="Approve openers before sending"
            value={settings.approveOpeners}
            onChange={(v) => set('approveOpeners', v)} />
          <Toggle label="Approve replies before sending"
            value={settings.approveReplies}
            onChange={(v) => set('approveReplies', v)} />
          <Toggle label="Approve date asks before sending"
            value={settings.approveDateAsks}
            onChange={(v) => set('approveDateAsks', v)} />
          <Toggle label="Approve calendar bookings"
            value={settings.approveBookings}
            onChange={(v) => set('approveBookings', v)} />
        </section>
      )}

      {/* The Reports tab has its own save button (different table); every other
          tab persists via the shared "Save" CTA below. */}
      {tab !== 'reports' && (
        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="bg-white text-black font-medium px-5 py-2 rounded disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {message && <span className={message.startsWith('Error') ? 'text-red-400 text-sm' : 'text-emerald-400 text-sm'}>{message}</span>}
        </div>
      )}
    </div>
  )
}

// ---------- tiny UI primitives (kept local so this page is self-contained) -----

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-white/60 uppercase tracking-wider">{label}</span>
      </div>
      {hint && <p className="text-xs text-white/40 mt-0.5 mb-1">{hint}</p>}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function TextInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <VoiceInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full h-auto bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm"
    />
  )
}

function NumberInput({
  value, onChange, step = 1,
}: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm"
    />
  )
}

function ListInput({
  value, onChange, rows = 3, placeholder,
}: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  return (
    <VoiceTextarea
      value={value.join('\n')}
      onChange={(v) => onChange(v.split('\n').map(s => s).filter((s) => s.length > 0 || true))}
      onBlur={(e) => onChange(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
      rows={rows}
      placeholder={placeholder}
      className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm resize-y"
    />
  )
}

function Toggle({
  label, value, onChange,
}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-white/20 bg-white/5 w-4 h-4 accent-fuchsia-600"
      />
      <span className="text-sm text-white/80">{label}</span>
    </label>
  )
}
