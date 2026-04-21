'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  onCreated?: (match: { id: string; name: string }) => void
}

function normalizePhoneE164(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export default function OfflineContactForm({ onCreated }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [handle, setHandle] = useState('')
  const [metAt, setMetAt] = useState('')
  const [firstImpression, setFirstImpression] = useState('')

  function reset() {
    setName('')
    setPhone('')
    setHandle('')
    setMetAt('')
    setFirstImpression('')
    setError(null)
    setSuccess(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    const e164 = normalizePhoneE164(phone)
    if (!e164) {
      setError('Phone must be a 10-digit US number.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/matches/offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          instagram_handle: handle.trim() || null,
          met_at: metAt.trim() || null,
          first_impression: firstImpression.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? `Server returned ${res.status}`)
        return
      }
      setSuccess(`Added ${data?.match?.name ?? name}. Pulling iMessage history now.`)
      if (onCreated && data?.match?.id) {
        onCreated({ id: data.match.id, name: data.match.name })
      }
      reset()
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError((err as Error).message || 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm font-semibold transition-all"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
        Add offline contact
      </button>
    )
  }

  return (
    <div className="bg-white/[0.04] border border-white/15 rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">Add offline contact</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          className="text-white/40 hover:text-white/70 text-xs font-mono"
        >
          cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Name *
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sarah"
            className="bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Phone *
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555-123-4567"
            className="bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Instagram handle
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@sarah.m"
            className="bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Where we met
          <input
            type="text"
            value={metAt}
            onChange={(e) => setMetAt(e.target.value)}
            placeholder="at the gym"
            className="bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60 sm:col-span-2">
          First-impression notes
          <textarea
            value={firstImpression}
            onChange={(e) => setFirstImpression(e.target.value)}
            rows={2}
            placeholder="Funny, mentioned she's from Seattle, big into climbing."
            className="bg-black/40 border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/60 resize-none"
          />
        </label>

        {error && (
          <div className="sm:col-span-2 text-xs font-mono text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {success && (
          <div className="sm:col-span-2 text-xs font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-3 py-2">
            {success}
          </div>
        )}

        <div className="sm:col-span-2 flex justify-end gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-500 to-red-600 text-black text-sm font-bold hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Adding...' : 'Add contact'}
          </button>
        </div>
      </form>
    </div>
  )
}
