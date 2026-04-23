'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

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

const TABS = [
  { key: 'persona', label: 'Persona (rizz)' },
  { key: 'drip', label: 'Drip rules' },
  { key: 'dates', label: 'Dates & calendar' },
  { key: 'approval', label: 'Approval gates' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function AISettingsForm({
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

  return (
    <div>
      <div className="flex gap-2 mb-6 border-b border-white/10">
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
            <TextInput value={settings.persona.occupation} onChange={(v) => setPersona('occupation', v)} placeholder="founder / engineer / pilot" />
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
            <ListInput value={settings.persona.attraction_hooks} onChange={(v) => setPersona('attraction_hooks', v)} placeholder="runs a company&#10;pilot in training&#10;cooks a mean risotto" rows={4} />
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
            Raw YAML. Each rule fires at most once per match. Comments start with <code>#</code>.
          </p>
          <VoiceTextarea
            value={settings.dripRulesYaml}
            onChange={(v) => set('dripRulesYaml', v)}
            rows={24}
            className="w-full font-mono text-xs bg-white/[0.04] border border-white/10 rounded px-3 py-2"
            spellCheck={false}
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

      {tab === 'dates' && (
        <section className="space-y-4">
          <Row label="Calendar to book on (email)" hint="The Google calendar that receives date events.">
            <TextInput value={settings.dateCalendarEmail} onChange={(v) => set('dateCalendarEmail', v)} placeholder="julian@aiacrobatics.com" />
          </Row>
          <Row label="Date slot times (one per line, HH:MM)" hint="Up to N slots per day — default 3.">
            <ListInput value={settings.dateSlots} onChange={(v) => set('dateSlots', v)} rows={4} placeholder="18:00&#10;20:00&#10;21:30" />
          </Row>
          <Row label="Days ahead to offer">
            <NumberInput value={settings.dateSlotDaysAhead} onChange={(v) => set('dateSlotDaysAhead', v)} />
          </Row>
          <Row label="Event duration (hours)">
            <NumberInput value={settings.dateSlotDurationHours} onChange={(v) => set('dateSlotDurationHours', v)} step={0.5} />
          </Row>
          <Row label="Timezone (IANA)">
            <TextInput value={settings.dateTimezone} onChange={(v) => set('dateTimezone', v)} placeholder="America/Los_Angeles" />
          </Row>
          <p className="text-xs text-white/50">
            These map directly to the agent's <code>DATE_CALENDAR_EMAIL</code>, <code>DATE_SLOTS</code>,
            <code> DATE_SLOT_DAYS_AHEAD</code>, <code>DATE_SLOT_DURATION_HOURS</code>, and
            <code> DATE_TIMEZONE</code> env vars. The daemon reads them on next tick.
          </p>
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
