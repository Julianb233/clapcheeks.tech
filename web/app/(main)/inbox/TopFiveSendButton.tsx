'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function TopFiveSendButton({
  matchId,
  matchName,
  draftText,
}: {
  matchId: string
  matchName: string
  draftText: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function send() {
    if (!confirm(`Send to ${matchName}:\n\n"${draftText}"`)) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: draftText }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setSent(true)
      setTimeout(() => {
        router.refresh()
      }, 800)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1 min-w-[88px]">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void send()
        }}
        className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
          sent
            ? 'bg-emerald-600 text-white'
            : busy
              ? 'bg-pink-700 text-white/60'
              : 'bg-pink-600 hover:bg-pink-500 text-white'
        } disabled:opacity-60`}
        title={`Send "${draftText}" to ${matchName}`}
      >
        {sent ? '✓ Sent' : busy ? 'Sending…' : 'Send →'}
      </button>
      {err && <div className="text-[9px] text-red-400">{err}</div>}
    </div>
  )
}
