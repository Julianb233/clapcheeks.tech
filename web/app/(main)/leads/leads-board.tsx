'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

export type Lead = {
  id: string
  platform: string
  match_id: string
  name: string | null
  age: number | null
  stage: string
  stageEnteredAt: string | null
  lastMessageAt: string | null
  lastMessageBy: string | null
  messageCount: number
  dateAskedAt: string | null
  dateSlotIso: string | null
  dateBookedAt: string | null
  calendarEventLink: string | null
  zodiac: string | null
  interests: string[]
  promptThemes: string[]
  tag: string | null
  notes: string | null
  outcome: string | null
  dripFired: Record<string, number>
}

type Stage = { key: string; label: string; hint: string }

export default function LeadsBoard({
  stages,
  initialLeads,
}: {
  stages: Stage[]
  initialLeads: Lead[]
}) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [dragged, setDragged] = useState<string | null>(null)
  const [selected, setSelected] = useState<Lead | null>(null)

  const byStage = useMemo(() => {
    const m: Record<string, Lead[]> = {}
    for (const s of stages) m[s.key] = []
    for (const l of leads) (m[l.stage] ?? m.matched).push(l)
    return m
  }, [leads, stages])

  async function moveLead(leadId: string, toStage: string) {
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? { ...l, stage: toStage, stageEnteredAt: new Date().toISOString() }
          : l,
      ),
    )
    const supabase = createClient()
    const { error } = await supabase
      .from('clapcheeks_leads')
      .update({ stage: toStage, stage_entered_at: new Date().toISOString() })
      .eq('id', leadId)
    if (error) {
      console.error('Stage update failed:', error)
      // revert on failure
      setLeads(initialLeads)
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <div
            key={stage.key}
            className="flex-shrink-0 w-[260px] bg-white/[0.03] border border-white/10 rounded-xl"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragged && moveLead(dragged, stage.key)}
          >
            <div className="p-3 border-b border-white/10">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{stage.label}</h2>
                <span className="text-xs text-white/40">
                  {byStage[stage.key]?.length ?? 0}
                </span>
              </div>
              <p className="text-xs text-white/40 mt-0.5">{stage.hint}</p>
            </div>
            <div className="p-2 space-y-2 min-h-[60px]">
              {(byStage[stage.key] ?? []).map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onDragStart={() => setDragged(lead.id)}
                  onDragEnd={() => setDragged(null)}
                  onClick={() => setSelected(lead)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <LeadDrawer lead={selected} onClose={() => setSelected(null)} onSave={(updated) => {
          setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
          setSelected(updated)
        }} />
      )}
    </div>
  )
}


function LeadCard({
  lead,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  lead: Lead
  onDragStart: () => void
  onDragEnd: () => void
  onClick: () => void
}) {
  const hours = lead.lastMessageAt
    ? Math.round((Date.now() - new Date(lead.lastMessageAt).getTime()) / 3_600_000)
    : null
  const ageLabel =
    hours === null
      ? '—'
      : hours < 1
        ? 'just now'
        : hours < 24
          ? `${hours}h ago`
          : `${Math.floor(hours / 24)}d ago`

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="p-3 bg-white/[0.04] hover:bg-white/[0.08] rounded-lg cursor-pointer border border-transparent hover:border-white/10 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {lead.name || lead.match_id.slice(0, 8)}
            {lead.age ? <span className="text-white/40"> · {lead.age}</span> : null}
          </div>
          <div className="text-xs text-white/40 mt-0.5 capitalize">
            {lead.platform}
            {lead.zodiac ? ` · ${lead.zodiac}` : ''}
          </div>
        </div>
        {lead.tag && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70">
            {lead.tag}
          </span>
        )}
      </div>
      <div className="mt-2 text-xs text-white/50 flex items-center justify-between">
        <span>{lead.messageCount} msg</span>
        <span>{ageLabel}</span>
      </div>
      {lead.dateSlotIso && lead.stage === 'date_proposed' && (
        <div className="mt-2 text-xs text-amber-300">
          Proposed: {new Date(lead.dateSlotIso).toLocaleString()}
        </div>
      )}
      {lead.dateBookedAt && lead.stage === 'date_booked' && (
        <div className="mt-2 text-xs text-emerald-300">
          Booked {new Date(lead.dateBookedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}


function LeadDrawer({
  lead,
  onClose,
  onSave,
}: {
  lead: Lead
  onClose: () => void
  onSave: (l: Lead) => void
}) {
  const [tag, setTag] = useState(lead.tag ?? '')
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [outcome, setOutcome] = useState(lead.outcome ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('clapcheeks_leads')
      .update({ tag: tag || null, notes: notes || null, outcome: outcome || null })
      .eq('id', lead.id)
    setSaving(false)
    if (!error) onSave({ ...lead, tag, notes, outcome })
  }

  return (
    <div className="fixed inset-0 z-30 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        className="w-[420px] bg-[#0B0B14] border-l border-white/10 h-full overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-2xl font-semibold">
              {lead.name || 'Unnamed match'}
              {lead.age ? <span className="text-white/40"> · {lead.age}</span> : null}
            </div>
            <div className="text-sm text-white/50 mt-1 capitalize">
              {lead.platform}
              {lead.zodiac ? ` · ${lead.zodiac}` : ''}
              {' · '}
              {lead.messageCount} msg
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <Section label="Stage">{lead.stage.replace('_', ' ')}</Section>
        {lead.lastMessageAt && (
          <Section label="Last message">
            {new Date(lead.lastMessageAt).toLocaleString()} ({lead.lastMessageBy ?? '—'})
          </Section>
        )}
        {lead.dateSlotIso && (
          <Section label="Proposed slot">
            {new Date(lead.dateSlotIso).toLocaleString()}
          </Section>
        )}
        {lead.calendarEventLink && (
          <Section label="Calendar">
            <a href={lead.calendarEventLink} target="_blank" rel="noreferrer" className="text-sky-400 underline">
              Open event
            </a>
          </Section>
        )}
        {lead.interests.length > 0 && (
          <Section label="Interests">{lead.interests.join(', ')}</Section>
        )}
        {lead.promptThemes.length > 0 && (
          <Section label="Her prompts">{lead.promptThemes.join(' · ')}</Section>
        )}

        <div className="mt-6 space-y-3">
          <LabeledInput label="Tag" value={tag} onChange={setTag} placeholder="promising / maybe / pass" />
          <LabeledTextarea label="Notes" value={notes} onChange={setNotes} />
          <LabeledInput label="Date outcome" value={outcome} onChange={setOutcome} placeholder="great / ok / ghosted / bailed" />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="mt-6 w-full py-2 rounded bg-white text-black font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        {Object.keys(lead.dripFired).length > 0 && (
          <div className="mt-6 text-xs text-white/40">
            <div className="uppercase tracking-wider mb-1">Drip history</div>
            {Object.entries(lead.dripFired).map(([rule, ts]) => (
              <div key={rule} className="flex justify-between">
                <span>{rule}</span>
                <span>{new Date(Number(ts) * 1000).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-xs text-white/40 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-white/90 mt-1">{children}</div>
    </div>
  )
}

function LabeledInput({
  label, value, onChange, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-white/40 uppercase tracking-wider">{label}</span>
      <VoiceInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="mt-1 w-full h-auto bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm"
      />
    </label>
  )
}

function LabeledTextarea({
  label, value, onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs text-white/40 uppercase tracking-wider">{label}</span>
      <VoiceTextarea
        value={value}
        onChange={onChange}
        rows={4}
        className="mt-1 w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm resize-y"
      />
    </label>
  )
}
