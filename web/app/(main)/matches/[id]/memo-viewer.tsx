'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * Memo viewer/editor — surfaces the per-contact memo file content with
 * edit-and-save capability.
 *
 * The local agent writes per-contact memos to ~/.clapcheeks/memos/+E164.md on
 * the operator's Mac. sync.py mirrors content into clapcheeks_memos via the
 * /api/memo/[handle] route. This component reads + writes through that API.
 *
 * `handle` should be the E.164 phone if available, otherwise the platform
 * external_id (e.g. "tinder:abc123").
 */

type Props = {
  handle: string | null
  // Optional initial content from server-side fetch; if omitted, fetched on mount.
  initialContent?: string
  initialUpdatedAt?: string | null
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function MemoViewer({
  handle,
  initialContent,
  initialUpdatedAt,
}: Props) {
  const [content, setContent] = useState(initialContent ?? '')
  const [updatedAt, setUpdatedAt] = useState<string | null>(
    initialUpdatedAt ?? null,
  )
  const [loading, setLoading] = useState(initialContent === undefined)
  const [saving, setSaving] = useState(false)
  const [previewOn, setPreviewOn] = useState(false)
  const lastSaved = useRef(initialContent ?? '')

  // Fetch on mount unless we already have initial content.
  useEffect(() => {
    if (!handle) {
      setLoading(false)
      return
    }
    if (initialContent !== undefined) {
      lastSaved.current = initialContent
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/memo/${encodeURIComponent(handle)}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`Load failed (${res.status})`)
        const json = (await res.json()) as {
          content: string
          updated_at: string | null
        }
        if (cancelled) return
        setContent(json.content ?? '')
        setUpdatedAt(json.updated_at ?? null)
        lastSaved.current = json.content ?? ''
      } catch (err) {
        if (!cancelled) toast.error(`Memo load failed: ${(err as Error).message}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [handle, initialContent])

  const save = useCallback(async () => {
    if (!handle) {
      toast.error('No contact handle — cannot save memo')
      return
    }
    if (content === lastSaved.current) return
    setSaving(true)
    try {
      const res = await fetch(`/api/memo/${encodeURIComponent(handle)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Save failed (${res.status})`)
      }
      const json = (await res.json()) as {
        content: string
        updated_at: string
      }
      lastSaved.current = json.content
      setUpdatedAt(json.updated_at)
      toast.success('Memo saved')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [content, handle])

  // Cmd/Ctrl-S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  if (!handle) {
    return (
      <div className="p-8 rounded-xl border border-white/10 bg-white/5 text-center">
        <div className="text-3xl mb-2">{'\u{1F4DD}'}</div>
        <p className="text-sm text-white/60 mb-1">
          No contact handle for this match.
        </p>
        <p className="text-xs text-white/40">
          Memos auto-generate when a phone number is exchanged on Tinder/Hinge.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-6 rounded-xl border border-white/10 bg-white/5 text-sm text-white/60">
        Loading memo...
      </div>
    )
  }

  const dirty = content !== lastSaved.current
  const isEmpty = content.trim().length === 0

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-black/30 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-white/60">
          <span className="font-mono text-white/80">{handle}</span>
          {updatedAt && (
            <span className="text-white/40">
              &middot; updated {relativeTime(updatedAt)}
            </span>
          )}
          {dirty && (
            <span className="text-amber-400 text-[11px] uppercase tracking-wider">
              unsaved
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewOn((v) => !v)}
            className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/80 hover:text-white transition-colors"
          >
            {previewOn ? 'Edit' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="px-3 py-1 rounded-md bg-pink-600 hover:bg-pink-500 text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {isEmpty && !previewOn && (
        <div className="px-4 pt-4 text-xs text-white/50">
          No memo yet for this contact. Memos auto-generate when a phone number
          is exchanged on Tinder/Hinge — or you can write one here.
        </div>
      )}

      {previewOn ? (
        <pre className="p-4 text-sm text-white/85 whitespace-pre-wrap break-words font-sans min-h-[200px] max-h-[60vh] overflow-y-auto">
          {content || '(empty)'}
        </pre>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={() => void save()}
          placeholder={`# Memo for ${handle}\n\n- Vibes:\n- Conversation hooks:\n- Follow-ups:\n- Logistics:\n`}
          spellCheck={false}
          className="w-full min-h-[300px] max-h-[60vh] bg-black/30 border-0 px-4 py-4 text-sm text-white placeholder:text-white/30 focus:outline-none resize-y font-mono"
        />
      )}
    </div>
  )
}
