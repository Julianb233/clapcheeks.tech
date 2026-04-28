'use client'

/**
 * AI-8876: ConversationComposer
 *
 * Minimal iMessage-style composer bar for the conversation thread tab.
 * Features:
 *  - Text input with send button (queues via /api/conversation/send)
 *  - Paperclip (+) attach button → file picker → POST /api/conversation/[matchId]/attach
 *  - Outbound typing indicator (Y7): debounced 200ms → POST /api/conversation/[matchId]/typing
 *    Auto-cancels on send or after 5s idle.
 *
 * The handle prop is used as the iMessage recipient (E.164 phone preferred,
 * falls back to platform:externalId when no phone is on file).
 * If handle is undefined (e.g. Tinder-only match with no phone), attach is hidden
 * and typing indicator is a no-op.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type Props = {
  /** clapcheeks_matches.id (UUID) */
  matchId: string
  /** iMessage recipient: E.164 phone OR platform:externalId */
  handle?: string
}

const TYPING_IDLE_MS = 5000   // stop indicator after 5s of no keystroke
const TYPING_DEBOUNCE_MS = 200  // debounce before firing start-typing

export default function ConversationComposer({ matchId, handle }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTypingRef = useRef(false)

  // iMessage-capable: only show attach + typing if we have a handle
  const hasHandle = Boolean(handle)

  // ── Typing indicator ──────────────────────────────────────────────────────

  const stopTyping = useCallback(async () => {
    if (!isTypingRef.current || !handle) return
    isTypingRef.current = false
    try {
      await fetch(`/api/conversation/${encodeURIComponent(matchId)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, stopped: true }),
      })
    } catch {
      // best-effort
    }
  }, [handle, matchId])

  const startTyping = useCallback(async () => {
    if (!handle) return
    if (!isTypingRef.current) {
      isTypingRef.current = true
      try {
        await fetch(`/api/conversation/${encodeURIComponent(matchId)}/typing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle }),
        })
      } catch {
        // best-effort
      }
    }
    // Reset idle timer
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => void stopTyping(), TYPING_IDLE_MS)
  }, [handle, matchId, stopTyping])

  const onTextChange = useCallback(
    (value: string) => {
      setText(value)
      if (!hasHandle) return
      // Debounce the typing signal
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      if (value.length > 0) {
        typingTimerRef.current = setTimeout(
          () => void startTyping(),
          TYPING_DEBOUNCE_MS,
        )
      } else {
        void stopTyping()
      }
    },
    [hasHandle, startTyping, stopTyping],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  // ── Send text ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    void stopTyping()
    try {
      const resp = await fetch('/api/conversation/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          matchName: matchId,
          platform: handle?.includes(':') ? handle.split(':')[0] : 'imessage',
        }),
      })
      if (resp.ok) {
        setText('')
      } else {
        const err = (await resp.json().catch(() => ({}))) as { error?: string }
        toast.error(err.error ?? 'Failed to send message')
      }
    } catch {
      toast.error('Network error — message not sent')
    } finally {
      setSending(false)
    }
  }, [text, sending, matchId, handle, stopTyping])

  // ── Attach file ───────────────────────────────────────────────────────────

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file || !handle) return
      setAttaching(true)
      void stopTyping()
      try {
        const form = new FormData()
        form.append('file', file)
        form.append('handle', handle)
        const resp = await fetch(
          `/api/conversation/${encodeURIComponent(matchId)}/attach`,
          { method: 'POST', body: form },
        )
        if (resp.ok) {
          toast.success(`Sent ${file.name}`)
        } else {
          const err = (await resp.json().catch(() => ({}))) as {
            error?: string
            detail?: string
          }
          if (err.error === 'bb_not_configured') {
            toast.error('BlueBubbles not set up — attachment not sent')
          } else {
            toast.error(err.detail ?? err.error ?? 'Attachment failed')
          }
        }
      } catch {
        toast.error('Network error — attachment not sent')
      } finally {
        setAttaching(false)
        // Reset file input so the same file can be selected again
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [handle, matchId, stopTyping],
  )

  return (
    <div className="flex items-end gap-2 p-3 rounded-xl border border-white/10 bg-white/5">
      {/* Hidden file input (triggered by attach button) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
        className="sr-only"
        aria-label="Attach file"
        onChange={(e) => void handleFileSelected(e)}
      />

      {/* Attach button (iMessage-capable matches only) */}
      {hasHandle && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={attaching}
          title="Attach file"
          aria-label="Attach file"
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {attaching ? (
            <span className="w-3 h-3 rounded-full border-2 border-white/50 border-t-transparent animate-spin" />
          ) : (
            <span className="text-sm font-bold leading-none">+</span>
          )}
        </button>
      )}

      {/* Text input */}
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void handleSend()
          }
        }}
        placeholder={
          hasHandle
            ? 'Message… (Enter to send, Shift+Enter for newline)'
            : 'Type a message to queue for the daemon…'
        }
        rows={1}
        className="flex-1 resize-none bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40 max-h-32 overflow-y-auto"
        style={{ minHeight: '2.25rem' }}
      />

      {/* Send button */}
      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={!text.trim() || sending}
        title="Send (Enter)"
        aria-label="Send message"
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {sending ? (
          <span className="w-3 h-3 rounded-full border-2 border-white/50 border-t-transparent animate-spin" />
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
          </svg>
        )}
      </button>
    </div>
  )
}
