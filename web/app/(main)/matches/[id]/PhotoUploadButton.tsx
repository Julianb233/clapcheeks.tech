'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

export function PhotoUploadButton({ matchId }: { matchId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onPicked(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    setErr(null)
    try {
      const fd = new FormData()
      Array.from(files).forEach((f) => fd.append('file', f))
      const res = await fetch(`/api/matches/${matchId}/photos`, {
        method: 'POST',
        body: fd,
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-medium disabled:opacity-50"
      >
        {busy ? 'Uploading…' : '📸 Add photos'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="hidden"
        onChange={(e) => void onPicked(e.target.files)}
      />
      {err && (
        <span className="ml-2 text-[11px] text-red-400" role="alert">
          {err}
        </span>
      )}
    </>
  )
}
