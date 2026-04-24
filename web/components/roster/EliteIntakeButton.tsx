'use client'

import { useState, useRef } from 'react'

type Extracted = {
  name: string | null
  phone_e164: string | null
  email: string | null
  instagram_handle: string | null
  city: string | null
  notes: string | null
  confidence: number
}

export default function EliteIntakeButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    match_id: string
    merged: boolean
    extracted: Extracted
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('source', 'screenshot-web')
      const res = await fetch('/api/roster/intake', { method: 'POST', body: fd })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).detail || res.statusText
        throw new Error(msg)
      }
      setResult(await res.json())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="text-xs font-mono bg-gradient-to-r from-yellow-500/20 to-rose-500/20 hover:from-yellow-500/30 hover:to-rose-500/30 border border-yellow-500/40 text-yellow-200 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
      >
        {busy ? 'Extracting…' : '+ Add from screenshot'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ''
        }}
      />
      {error && (
        <div className="absolute right-0 mt-2 bg-red-500/15 border border-red-500/30 text-red-200 text-xs rounded-lg p-3 max-w-xs">
          {error}
        </div>
      )}
      {result && (
        <div className="absolute right-0 mt-2 bg-black border border-yellow-500/30 text-white text-xs rounded-lg p-4 max-w-xs shadow-xl z-50">
          <div className="font-semibold text-yellow-300 mb-2">
            {result.merged ? 'Updated existing' : 'Added to Elite'}
          </div>
          <dl className="space-y-1">
            {result.extracted.name && <Row k="Name" v={result.extracted.name} />}
            {result.extracted.phone_e164 && <Row k="Phone" v={result.extracted.phone_e164} />}
            {result.extracted.email && <Row k="Email" v={result.extracted.email} />}
            {result.extracted.instagram_handle && (
              <Row k="IG" v={'@' + result.extracted.instagram_handle} />
            )}
            {result.extracted.city && <Row k="City" v={result.extracted.city} />}
            {result.extracted.notes && <Row k="Notes" v={result.extracted.notes} />}
          </dl>
          <div className="mt-3 text-white/40 font-mono text-[10px]">
            confidence: {(result.extracted.confidence * 100).toFixed(0)}% · match {result.match_id.slice(0, 8)}
          </div>
          <button
            onClick={() => setResult(null)}
            className="mt-3 text-white/60 hover:text-white text-xs font-mono"
          >
            close
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-white/40 w-12 flex-shrink-0">{k}</dt>
      <dd className="text-white/90 break-all">{v}</dd>
    </div>
  )
}
