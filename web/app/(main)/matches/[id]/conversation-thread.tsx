'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Conversation thread (iMessage-style) for a single match.
 *
 * Reads from clapcheeks_conversations via /api/matches/[id]/conversation
 * (server-side). Supports two storage shapes:
 *   1. Single row per (user_id, match_id, platform) with a `messages` JSONB
 *      array. Each entry: { is_from_me, text, sent_at, is_auto_sent? ... }.
 *   2. Many rows, one per message, with body/direction/sent_at/channel.
 *
 * We accept either shape and normalize into ChatMessage[] for rendering.
 */

export type ChatMessage = {
  id: string
  text: string
  is_from_me: boolean
  sent_at: string | null
  is_auto_sent?: boolean
  channel?: string | null
}

type Props = {
  messages: ChatMessage[]
  emptyHint?: string
}

function formatDateDivider(d: Date): string {
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

function formatTimeStamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export default function ConversationThread({ messages, emptyHint }: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const sorted = useMemo(() => {
    return [...messages].sort((a, b) => {
      const aT = a.sent_at ? new Date(a.sent_at).getTime() : 0
      const bT = b.sent_at ? new Date(b.sent_at).getTime() : 0
      return aT - bT
    })
  }, [messages])

  const summary = useMemo(() => {
    if (sorted.length === 0) return null
    const first = sorted.find((m) => m.sent_at)
    const last = [...sorted].reverse().find((m) => m.sent_at)
    return {
      count: sorted.length,
      first: first?.sent_at ? new Date(first.sent_at) : null,
      last: last?.sent_at ? new Date(last.sent_at) : null,
    }
  }, [sorted])

  useEffect(() => {
    if (!autoScroll) return
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [sorted.length, autoScroll])

  if (sorted.length === 0) {
    return (
      <div className="p-8 rounded-xl border border-white/10 bg-white/5 text-center">
        <div className="text-3xl mb-2">{'\u{1F4AC}'}</div>
        <p className="text-sm text-white/60">
          {emptyHint ??
            'No conversation yet — drafts will appear here once exchanged.'}
        </p>
      </div>
    )
  }

  // Group consecutive messages by day for date dividers.
  let lastKey: string | null = null
  const groups: Array<{ key: string; date: Date; messages: ChatMessage[] }> = []
  for (const msg of sorted) {
    const d = msg.sent_at ? new Date(msg.sent_at) : new Date(0)
    const k = dayKey(d)
    if (k !== lastKey) {
      groups.push({ key: k, date: d, messages: [msg] })
      lastKey = k
    } else {
      groups[groups.length - 1].messages.push(msg)
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      {/* Header summary */}
      {summary && (
        <div className="px-4 py-3 border-b border-white/10 bg-black/30 text-[11px] text-white/60 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <strong className="text-white/90">{summary.count}</strong>{' '}
            message{summary.count === 1 ? '' : 's'}
          </span>
          {summary.first && (
            <span>
              First:{' '}
              <span className="text-white/80">
                {formatTimeStamp(summary.first)}
              </span>
            </span>
          )}
          {summary.last && (
            <span>
              Latest:{' '}
              <span className="text-white/80">
                {formatTimeStamp(summary.last)}
              </span>
            </span>
          )}
          <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer select-none text-white/50">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-pink-500"
            />
            auto-scroll
          </label>
        </div>
      )}

      {/* Scroll body */}
      <div className="max-h-[70vh] overflow-y-auto px-4 py-4 space-y-4">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-white/10" />
              <div className="text-[10px] uppercase tracking-wider text-white/40">
                {group.date.getTime() === 0
                  ? 'No date'
                  : formatDateDivider(group.date)}
              </div>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <div className="space-y-1.5">
              {group.messages.map((m) => (
                <Bubble key={m.id} msg={m} />
              ))}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isMe = msg.is_from_me
  const stamp = msg.sent_at ? new Date(msg.sent_at) : null
  const tooltip = stamp
    ? `${formatTimeStamp(stamp)}${msg.channel ? ` · ${msg.channel}` : ''}`
    : msg.channel ?? ''

  return (
    <div
      className={`flex ${isMe ? 'justify-end' : 'justify-start'} group`}
    >
      <div
        className={`max-w-[78%] px-3.5 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap break-words shadow-sm ${
          isMe
            ? 'bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-br-md'
            : 'bg-white/10 text-white/90 rounded-bl-md'
        }`}
        title={tooltip}
      >
        {msg.text || (
          <span className="italic text-white/50">[empty message]</span>
        )}
        {(msg.is_auto_sent || msg.channel === 'imessage') && isMe && (
          <span className="ml-2 text-[10px] uppercase tracking-wider opacity-75">
            {msg.is_auto_sent ? '\u{1F916} auto' : 'iMessage'}
          </span>
        )}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] mt-0.5 text-white/70">
          {stamp ? formatTimeStamp(stamp) : ''}
        </div>
      </div>
    </div>
  )
}
