'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function FlakeButton({
  matchId,
  matchName,
  flakeCount,
}: {
  matchId: string
  matchName: string
  flakeCount: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [demote, setDemote] = useState(flakeCount >= 1) // 2nd+ flake demotes by default
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/flake`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          note: note.trim() || undefined,
          demote_stage: demote,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setOpen(false)
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
        className="px-3 py-1.5 rounded-md bg-rose-600/20 hover:bg-rose-600/40 text-xs font-medium text-rose-200 border border-rose-500/30"
        title="Log that she flaked / no-showed"
      >
        🚫 She flaked{flakeCount > 0 ? ` (${flakeCount})` : ''}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-rose-500/30 rounded-2xl p-6 w-full max-w-md space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{matchName} flaked</h3>
              <p className="text-xs text-white/50 mt-1">
                No-show, ghosted, or cancelled at the last second. This will be flake #{flakeCount + 1}.
              </p>
            </div>
            <label className="block text-xs text-white/60">
              Note (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="any context — last-minute cancel, no-show, ghost on day-of, etc."
                rows={2}
                className="mt-1 w-full bg-black/50 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={demote}
                onChange={(e) => setDemote(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              Move her to the &ldquo;faded&rdquo; stage (recommended after 2 flakes)
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
                className="px-4 py-2 rounded-md bg-rose-600 hover:bg-rose-500 text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Logging…' : 'Log flake'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
