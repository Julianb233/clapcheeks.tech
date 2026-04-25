'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type RemoveResponse = {
  mode?: 'soft' | 'hard'
  removed?: string
  previousStage?: string
  previousStatus?: string
  error?: string
}

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
  const [undo, setUndo] = useState<{
    previousStage?: string
    previousStatus?: string
    countdown: number
  } | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (undo == null) return
    if (undo.countdown <= 0) {
      setUndo(null)
      return
    }
    timerRef.current = window.setTimeout(
      () => setUndo({ ...undo, countdown: undo.countdown - 1 }),
      1000,
    )
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [undo])

  async function doRemove() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/matches/${matchId}`, { method: 'DELETE' })
      const j = (await res.json().catch(() => ({}))) as RemoveResponse
      if (!res.ok) {
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      setConfirming(false)
      setUndo({
        previousStage: j.previousStage,
        previousStatus: j.previousStatus,
        countdown: 30,
      })
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  async function doUndo() {
    if (!undo) return
    setBusy(true)
    try {
      await fetch(`/api/matches/${matchId}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stage: undo.previousStage,
          status: undo.previousStatus,
        }),
      })
      setUndo(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (undo) {
    return (
      <div
        className="absolute top-2 right-2 left-2 z-30 flex items-center justify-between gap-2 rounded-lg bg-emerald-900/95 backdrop-blur px-3 py-2 text-xs"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <span>Removed. Undo? ({undo.countdown}s)</span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void doUndo()
          }}
          className="px-2 py-1 rounded bg-white/20 hover:bg-white/30 font-semibold"
        >
          Undo
        </button>
      </div>
    )
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
          Archives the match. You&apos;ll have 30s to undo.
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
