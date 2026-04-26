'use client'

import { useEffect, useState } from 'react'

type Event = {
  id: string
  event_type: 'date_proposed' | 'date_booked' | 'date_attended' | 'rescheduled' | 'flaked' | 'cancelled_by_him' | 'cancelled_by_her'
  original_slot: string | null
  new_slot: string | null
  note: string | null
  created_at: string
}

const EVENT_META: Record<Event['event_type'], { icon: string; tone: string; label: string }> = {
  date_proposed:    { icon: '💬', tone: 'text-sky-300',     label: 'Date proposed' },
  date_booked:      { icon: '📅', tone: 'text-amber-300',   label: 'Date booked' },
  date_attended:    { icon: '✅', tone: 'text-emerald-300', label: 'Date attended' },
  rescheduled:      { icon: '🔁', tone: 'text-amber-300',   label: 'She rescheduled' },
  flaked:           { icon: '🚫', tone: 'text-rose-300',    label: 'She flaked' },
  cancelled_by_him: { icon: '👋', tone: 'text-zinc-300',    label: 'You cancelled' },
  cancelled_by_her: { icon: '🚫', tone: 'text-rose-300',    label: 'She cancelled' },
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function HistoryTab({ matchId }: { matchId: string }) {
  const [events, setEvents] = useState<Event[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/matches/${matchId}/events`)
      .then(r => r.json())
      .then(d => setEvents(d.events ?? []))
      .catch(e => setErr(e instanceof Error ? e.message : 'failed'))
  }, [matchId])

  if (err) return <div className="text-xs text-rose-400">History: {err}</div>
  if (events === null) return <div className="text-xs text-white/40">Loading history…</div>
  if (events.length === 0) {
    return (
      <div className="text-xs text-white/40 italic px-1 py-2">
        No date events yet. Reschedule / flake / outcome events will appear here.
      </div>
    )
  }

  return (
    <ol className="space-y-2">
      {events.map(ev => {
        const meta = EVENT_META[ev.event_type]
        return (
          <li key={ev.id} className="flex gap-3 items-start text-sm">
            <div className="flex-shrink-0 w-7 text-center text-base leading-none pt-0.5">{meta.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`font-medium ${meta.tone}`}>{meta.label}</span>
                <span className="text-[10px] text-white/40 font-mono">{relTime(ev.created_at)}</span>
              </div>
              {(ev.original_slot || ev.new_slot) && (
                <div className="text-[11px] text-white/50 mt-0.5">
                  {ev.original_slot && <>was: <span className="text-white/70">{fmt(ev.original_slot)}</span></>}
                  {ev.original_slot && ev.new_slot && <span className="mx-1">→</span>}
                  {ev.new_slot && <>now: <span className="text-white/70">{fmt(ev.new_slot)}</span></>}
                </div>
              )}
              {ev.note && (
                <div className="text-xs text-white/60 mt-0.5 italic">&ldquo;{ev.note}&rdquo;</div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
