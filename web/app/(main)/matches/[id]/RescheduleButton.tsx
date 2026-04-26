'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RescheduleButton({
  matchId,
  matchName,
}: {
  matchId: string
  matchName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newSlot, setNewSlot] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/reschedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          new_slot_iso: newSlot ? new Date(newSlot).toISOString() : null,
          note: note.trim() || undefined,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setOpen(false)
      setNewSlot('')
      setNote('')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-medium"
        title="Log that she rescheduled the date"
      >
        🔁 She rescheduled
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{matchName} rescheduled</h3>
              <p className="text-xs text-white/50 mt-1">
                Push the date to a new time. Counts toward her reschedule history.
              </p>
            </div>
            <label className="block text-xs text-white/60">
              New slot (optional)
              <input
                type="datetime-local"
                value={newSlot}
                onChange={(e) => setNewSlot(e.target.value)}
                className="mt-1 w-full bg-black/50 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block text-xs text-white/60">
              Note (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="why did she push? was it work / family / vague?"
                rows={2}
                className="mt-1 w-full bg-black/50 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
              />
            </label>
            {err && <div className="text-xs text-rose-400">{err}</div>}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-md text-sm text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Logging…' : 'Log reschedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
