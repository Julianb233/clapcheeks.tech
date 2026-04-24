'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RemoveMatchButton({
  matchId,
  matchName,
}: {
  matchId: string
  matchName: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function doRemove() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/matches/${matchId}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed')
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setConfirming(true)
        }}
        aria-label={`Remove ${matchName} from roster`}
        title="Remove from roster"
        className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/60 hover:bg-red-600 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white text-sm font-bold transition-colors opacity-0 group-hover:opacity-100"
      >
        ×
      </button>
    )
  }

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-sm rounded-2xl p-4"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="text-center">
        <div className="text-sm font-medium mb-1">Remove {matchName}?</div>
        <div className="text-xs text-white/60">
          Deletes the match and conversation history.
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void doRemove()
          }}
          className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-xs font-medium disabled:opacity-50"
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setConfirming(false)
          }}
          className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-medium"
        >
          Cancel
        </button>
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
    </div>
  )
}
