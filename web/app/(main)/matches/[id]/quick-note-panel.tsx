'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Mobile-first inline quick-note for the Conversation tab (AI-9608).
 *
 * Lives directly above the composer so the operator can capture an observation
 * about the match the same beat they read her latest message. Saves to the
 * existing /api/memo/[handle] route used by MemoViewer (Convex-backed). Auto-
 * saves on blur with a 1s debounce so a quick thought doesn't get lost.
 */
type Props = {
  handle: string | null
  initialContent?: string
  initialUpdatedAt?: string | null
}

export default function QuickNotePanel({ handle, initialContent, initialUpdatedAt }: Props) {
  const [content, setContent] = useState(initialContent ?? '')
  const [savedAt, setSavedAt] = useState<string | null>(initialUpdatedAt ?? null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSaved = useRef(initialContent ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Persist on debounce + on blur
  const save = async (next: string) => {
    if (!handle || next === lastSaved.current) return
    setStatus('saving')
    try {
      const res = await fetch(`/api/memo/${encodeURIComponent(handle)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: next }),
      })
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      lastSaved.current = next
      setSavedAt(new Date().toISOString())
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 1500)
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (content === lastSaved.current) return
    debounceRef.current = setTimeout(() => {
      void save(content)
    }, 1000)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  if (!handle) return null

  const ageLabel = (() => {
    if (status === 'saving') return 'saving…'
    if (status === 'error') return 'save failed — retry'
    if (!savedAt) return 'unsaved'
    const diffSec = Math.max(0, Math.round((Date.now() - new Date(savedAt).getTime()) / 1000))
    if (diffSec < 60) return `saved ${diffSec}s ago`
    if (diffSec < 3600) return `saved ${Math.round(diffSec / 60)}m ago`
    return `saved ${Math.round(diffSec / 3600)}h ago`
  })()

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-widest text-white/50 font-mono">
          Quick Note
        </span>
        <span className={`text-[10px] font-mono ${status === 'error' ? 'text-red-400' : 'text-white/30'}`}>
          {ageLabel}
        </span>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={() => save(content)}
        placeholder="Quick observation: what she said, what she likes, follow-ups…"
        rows={3}
        className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/30 outline-none resize-none"
      />
    </div>
  )
}
