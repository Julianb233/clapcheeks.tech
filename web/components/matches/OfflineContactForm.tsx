'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * AI-9579 — Replaces the "Coming soon" stub (TODO AI-8594) with a real form.
 *
 * Posts to /api/matches/offline which calls api.matches.upsertOffline on
 * Convex. On success the parent's useQuery(api.matches.listForUser) refetches
 * automatically via Convex reactivity.
 */
export default function OfflineContactForm() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [notes, setNotes] = React.useState('')

  function reset() {
    setName('')
    setPhone('')
    setEmail('')
    setNotes('')
    setError(null)
  }

  function handleClose() {
    setOpen(false)
    reset()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/matches/offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to add match')
      toast.success(`${name.trim()} added`)
      handleClose()
      // AI-9526 F6 — refresh server-rendered match list so the new row shows
      // without manual reload (Convex reactivity handles dashboards that use
      // useQuery; SSR pages need an explicit refresh).
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const inputCls =
    'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 text-sm'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
        Add offline match
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={handleClose}
        >
          <div
            className="rounded-xl border border-white/10 bg-[#0a0a12] p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Add offline match</h2>
              <button
                type="button"
                onClick={handleClose}
                className="rounded p-1 text-white/40 hover:text-white/80 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {error && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  {error}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">
                  Name <span className="text-pink-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="First name"
                  className={inputCls}
                  required
                  autoFocus
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 867-5309"
                  className={inputCls}
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="her@email.com"
                  className={inputCls}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">
                  Notes <span className="text-white/30">(where you met, vibe, etc.)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Met at the farmers market, super into hiking..."
                  rows={3}
                  className={`${inputCls} resize-none`}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-white/60 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Adding…
                    </>
                  ) : (
                    'Add match'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
