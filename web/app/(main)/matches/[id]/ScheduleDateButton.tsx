'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function ScheduleDateButton({
  matchId,
  matchName,
}: {
  matchId: string
  matchName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const [date, setDate] = useState('')
  const [time, setTime] = useState('19:30')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')

  async function submit() {
    if (!date) {
      setErr('Pick a date.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const startsAt = new Date(`${date}T${time}:00`).toISOString()
      const endsAt = new Date(
        new Date(startsAt).getTime() + 90 * 60 * 1000,
      ).toISOString()
      const res = await fetch(`/api/matches/${matchId}/schedule-date`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startsAt,
          endsAt,
          location: location || null,
          notes: notes || null,
          addToCalendar: true,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setDone(true)
      router.refresh()
      setTimeout(() => setOpen(false), 2200)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Schedule failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md bg-pink-600/30 hover:bg-pink-600/50 border border-pink-500/40 text-xs font-medium"
      >
        📅 Schedule date
      </button>
    )
  }

  if (done) {
    return (
      <div className="px-3 py-1.5 rounded-md bg-emerald-600/30 border border-emerald-500/40 text-xs">
        ✓ Booked. Adding to Dating calendar…
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4">
      <div className="bg-zinc-950 border border-white/10 rounded-2xl p-5 w-full max-w-md space-y-4">
        <div>
          <div className="text-base font-semibold">Schedule date with {matchName}</div>
          <div className="text-xs text-white/50 mt-0.5">
            Adds to your Dating calendar.
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-white/70 flex flex-col gap-1">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-white/70 flex flex-col gap-1">
            Time
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <label className="text-xs text-white/70 flex flex-col gap-1">
          Location
          <input
            type="text"
            placeholder="Bar Pavilion, La Jolla"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-white/70 flex flex-col gap-1">
          Notes
          <textarea
            rows={2}
            placeholder="Drinks → walk on the beach. Pickup at 7."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm resize-none"
          />
        </label>
        {err && <div className="text-xs text-red-400">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="px-3 py-1.5 rounded-md bg-gradient-to-r from-pink-600 to-purple-600 text-xs font-medium disabled:opacity-50"
          >
            {busy ? 'Booking…' : 'Book + add to Dating cal'}
          </button>
        </div>
      </div>
    </div>
  )
}
