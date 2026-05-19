'use client'

import * as React from 'react'
import { Loader2, Plus, X } from 'lucide-react'

type SubmitState = 'idle' | 'saving' | 'success' | 'error'

export default function OfflineContactForm() {
  const [open, setOpen] = React.useState(false)
  const [state, setState] = React.useState<SubmitState>('idle')
  const [message, setMessage] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({
    name: '',
    phone: '',
    instagram_handle: '',
    notes: '',
  })

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('saving')
    setMessage(null)
    try {
      const res = await fetch('/api/matches/offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || json.detail || 'Failed to add offline match')
      setState('success')
      setMessage(`${json.match?.name || form.name} was added to Convex.`)
      setForm({ name: '', phone: '', instagram_handle: '', notes: '' })
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'Failed to add offline match')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setState('idle')
          setMessage(null)
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
        Add offline match
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <form
            className="w-full max-w-md rounded-xl border border-white/10 bg-[#0a0a12] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-white">Add offline match</h2>
                <p className="mt-1 text-xs text-white/40">Creates a Convex offline match and queues local enrichment jobs.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white"
                aria-label="Close offline match form"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs text-white/50">
                Name
                <input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-pink-500/50"
                  placeholder="Raghad"
                />
              </label>
              <label className="block text-xs text-white/50">
                Phone
                <input
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  required
                  inputMode="tel"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-pink-500/50"
                  placeholder="6195551234"
                />
              </label>
              <label className="block text-xs text-white/50">
                Instagram
                <input
                  value={form.instagram_handle}
                  onChange={(e) => update('instagram_handle', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-pink-500/50"
                  placeholder="@handle"
                />
              </label>
              <label className="block text-xs text-white/50">
                Notes
                <textarea
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-pink-500/50"
                  placeholder="Where you met, context, next move"
                />
              </label>
            </div>

            {message && (
              <p className={`mt-3 text-xs ${state === 'error' ? 'text-red-300' : 'text-green-300'}`}>
                {message}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-white/50 hover:bg-white/10 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={state === 'saving'}
                className="inline-flex items-center gap-2 rounded-lg bg-pink-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pink-400 disabled:opacity-50"
              >
                {state === 'saving' && <Loader2 className="h-4 w-4 animate-spin" />}
                Add match
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
