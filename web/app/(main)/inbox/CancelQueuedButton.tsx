'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function CancelQueuedButton({
  matchId,
  queueId,
}: {
  matchId: string
  queueId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function cancel() {
    if (!confirm('Cancel this queued message?')) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(
        `/api/matches/${matchId}/send/cancel?queueId=${encodeURIComponent(queueId)}`,
        { method: 'POST' },
      )
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void cancel()
        }}
        className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-red-600 hover:text-white border border-white/10 text-[11px] disabled:opacity-50"
      >
        {busy ? '…' : 'Cancel'}
      </button>
      {err && <div className="text-[10px] text-red-400">{err}</div>}
    </div>
  )
}
