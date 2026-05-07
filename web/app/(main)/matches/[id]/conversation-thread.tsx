'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api as convexApi } from '@/convex/_generated/api'
import type { MessageChannel } from '@/lib/matches/conversation'
import type { ConversationMessage } from '@/lib/matches/types'

/**
 * Unified cross-channel conversation thread (AI-8807, AI-8876)
 *
 * Shows messages from all platforms — Tinder, Hinge, Bumble, Instagram,
 * iMessage — merged chronologically with channel badges and handoff markers.
 *
 * AI-8876 additions:
 *  - Typing bubble: shown when an inbound typing-indicator event lands for
 *    this match (auto-clears after 3 s).
 *  - Read receipt: shows "Read" + timestamp when chat-read-status-changed
 *    fires on the realtime channel.
 *  - Inbound reactions/tapbacks: rendered on individual message bubbles from
 *    clapcheeks_conversations.reactions JSONB, mapped to emoji.
 *  - Live message append: new messages from realtime are appended without
 *    a page reload.
 */

export type ChatMessage = {
  id: string
  text: string
  is_from_me: boolean
  sent_at: string | null
  is_auto_sent?: boolean
  channel?: MessageChannel | string | null
  /** Reactions/tapbacks on this individual message */
  reactions?: ReactionEntry[]
}

/** Shape stored in clapcheeks_conversations.reactions JSONB array */
type ReactionEntry = {
  msg_guid?: string
  kind?: string
  actor?: string
  ts?: string
}

// ── Tapback emoji map ─────────────────────────────────────────────────────────

const TAPBACK_EMOJI: Record<string, string> = {
  love:        '❤️',
  like:        '👍',
  dislike:     '👎',
  laugh:       '😂',
  emphasize:   '‼️',
  question:    '❓',
  heart:       '❤️',
  thumbsup:    '👍',
  thumbsdown:  '👎',
  ha:          '😂',
  '0':         '❤️',   // BB numeric variant
  '1':         '👍',
  '2':         '👎',
  '3':         '😂',
  '4':         '‼️',
  '5':         '❓',
}

function tapbackEmoji(kind: string | undefined): string {
  if (!kind) return '👍'
  return TAPBACK_EMOJI[kind.toLowerCase()] ?? kind
}

// ── Channel badge config ──────────────────────────────────────────────────────

type BadgeConfig = {
  label: string
  badgeClass: string
  bubbleClass: string
  chipActiveClass: string
  chipClass: string
}

const CHANNEL_CONFIG: Record<string, BadgeConfig> = {
  tinder: {
    label: 'Tinder',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    bubbleClass: 'bg-gradient-to-br from-rose-500 to-orange-500 text-white',
    chipActiveClass: 'bg-rose-500/30 text-rose-200 border-rose-500/50',
    chipClass: 'bg-white/5 text-white/50 border-white/10 hover:text-white/80',
  },
  hinge: {
    label: 'Hinge',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    bubbleClass: 'bg-gradient-to-br from-purple-600 to-violet-700 text-white',
    chipActiveClass: 'bg-purple-500/30 text-purple-200 border-purple-500/50',
    chipClass: 'bg-white/5 text-white/50 border-white/10 hover:text-white/80',
  },
  bumble: {
    label: 'Bumble',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    bubbleClass: 'bg-gradient-to-br from-amber-400 to-yellow-500 text-black',
    chipActiveClass: 'bg-amber-500/30 text-amber-200 border-amber-500/50',
    chipClass: 'bg-white/5 text-white/50 border-white/10 hover:text-white/80',
  },
  instagram: {
    label: 'Instagram',
    badgeClass: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
    bubbleClass: 'bg-gradient-to-br from-pink-500 via-red-500 to-orange-500 text-white',
    chipActiveClass: 'bg-pink-500/30 text-pink-200 border-pink-500/50',
    chipClass: 'bg-white/5 text-white/50 border-white/10 hover:text-white/80',
  },
  imessage: {
    label: 'iMessage',
    badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    bubbleClass: 'bg-gradient-to-br from-blue-500 to-blue-700 text-white',
    chipActiveClass: 'bg-blue-500/30 text-blue-200 border-blue-500/50',
    chipClass: 'bg-white/5 text-white/50 border-white/10 hover:text-white/80',
  },
  platform: {
    label: 'App',
    badgeClass: 'bg-white/10 text-white/60 border-white/15',
    bubbleClass: 'bg-gradient-to-br from-pink-500 to-purple-600 text-white',
    chipActiveClass: 'bg-white/20 text-white border-white/30',
    chipClass: 'bg-white/5 text-white/50 border-white/10 hover:text-white/80',
  },
}

const DEFAULT_BADGE: BadgeConfig = CHANNEL_CONFIG.platform

function getChannelConfig(channel: string | null | undefined): BadgeConfig {
  if (!channel) return DEFAULT_BADGE
  return CHANNEL_CONFIG[channel.toLowerCase()] ?? DEFAULT_BADGE
}

// ── Date/time helpers ────────────────────────────────────────────────────────

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
    weekday: 'long',
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

// ── Helper: ConversationMessage → ChatMessage ─────────────────────────────────

function realtimeMsgToChatMessage(
  entry: ConversationMessage,
  idx: number,
): ChatMessage {
  return {
    id: entry.id ?? `rt-${Date.now()}-${idx}`,
    text: entry.body,
    is_from_me: entry.direction === 'outgoing',
    sent_at: entry.sent_at,
    channel: entry.channel ?? entry.platform ?? 'imessage',
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type FilterChannel = 'all' | string

type Props = {
  messages: ChatMessage[]
  /** match_id from clapcheeks_conversations for realtime subscription */
  matchId?: string | null
  /** AI-9572: Convex conversation _id for reactive subscription */
  convexConversationId?: string | null
  /** reactions JSONB from the conversation row */
  reactions?: ReactionEntry[] | null
  emptyHint?: string
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ConversationThread({
  messages,
  matchId,
  convexConversationId,
  reactions,
  emptyHint,
}: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeFilter, setActiveFilter] = useState<FilterChannel>('all')

  // Live messages appended from realtime
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([])
  // Typing indicator (true = their side is typing)
  const [peerTyping, setPeerTyping] = useState(false)
  // Read receipt timestamp (null = no read event yet)
  const [readAt, setReadAt] = useState<Date | null>(null)
  // Live reactions updates
  const [liveReactions, setLiveReactions] = useState<ReactionEntry[]>(
    reactions ?? [],
  )

  // Merge server-provided reactions on prop change
  useEffect(() => {
    setLiveReactions(reactions ?? [])
  }, [reactions])

  // ── Convex reactive subscription (AI-9572) ───────────────────────────────
  // Replaces Supabase Realtime. Messages are written to Convex (post-AI-9526),
  // so useQuery on api.messages.listByConversation gives live updates for free.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convexMessages = useQuery(
    (convexApi as any).messages.listByConversation,
    convexConversationId ? { conversation_id: convexConversationId as any } : 'skip',
  )

  // Map Convex message rows -> ChatMessage whenever the query updates
  useEffect(() => {
    if (!convexMessages) return
    setLiveMessages(
      (convexMessages as Array<Record<string, unknown>>).map((m) => ({
        id: m._id as string,
        text: m.body as string,
        is_from_me: (m.direction as string) === 'outbound',
        sent_at: m.sent_at ? new Date(m.sent_at as number).toISOString() : null,
        channel: (m.platform as string | undefined) ?? 'imessage',
      })),
    )
  }, [convexMessages])

  // Cleanup typing timer on unmount
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [])

  // ── Merged message list ─────────────────────────────────────────────────────

  const allMessages = useMemo(() => {
    const combined = [...messages, ...liveMessages]
    // Deduplicate by id (live messages can duplicate server-rendered ones after hydration)
    const seen = new Set<string>()
    return combined.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
  }, [messages, liveMessages])

  // Inject per-message reactions from the conversation row reactions JSONB
  const messagesWithReactions = useMemo<ChatMessage[]>(() => {
    if (!liveReactions.length) return allMessages
    return allMessages.map((m) => {
      const msgReactions = liveReactions.filter(
        (r) => r.msg_guid && m.id.includes(r.msg_guid),
      )
      return msgReactions.length > 0
        ? { ...m, reactions: msgReactions }
        : m
    })
  }, [allMessages, liveReactions])

  // Collect unique channels present in the conversation
  const channelsPresent = useMemo(() => {
    const seen = new Set<string>()
    for (const m of messagesWithReactions) {
      if (m.channel) seen.add(m.channel.toLowerCase())
    }
    return Array.from(seen).sort()
  }, [messagesWithReactions])

  // Sorted full list
  const sorted = useMemo(() => {
    return [...messagesWithReactions].sort((a, b) => {
      const aT = a.sent_at ? new Date(a.sent_at).getTime() : 0
      const bT = b.sent_at ? new Date(b.sent_at).getTime() : 0
      return aT - bT
    })
  }, [messagesWithReactions])

  // Filtered list (for display)
  const filtered = useMemo(() => {
    if (activeFilter === 'all') return sorted
    return sorted.filter(
      (m) => (m.channel ?? 'platform').toLowerCase() === activeFilter,
    )
  }, [sorted, activeFilter])

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [filtered.length, peerTyping, autoScroll])

  if (sorted.length === 0) {
    return (
      <div className="p-8 rounded-xl border border-white/10 bg-white/5 text-center">
        <div className="text-3xl mb-2">&#128172;</div>
        <p className="text-sm text-white/60">
          {emptyHint ??
            'No conversation yet — messages will appear here once exchanged.'}
        </p>
      </div>
    )
  }

  // Build render groups: day groups containing render items (messages + handoff markers)
  const renderItems = buildRenderItems(filtered)

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      {/* Header summary */}
      {summary && (
        <div className="px-4 py-3 border-b border-white/10 bg-black/30 text-[11px] text-white/60 flex flex-wrap gap-x-4 gap-y-1 items-center">
          <span>
            <strong className="text-white/90">{summary.count}</strong>{' '}
            message{summary.count === 1 ? '' : 's'}
          </span>
          {summary.first && (
            <span>
              First:{' '}
              <span className="text-white/80">{formatTimeStamp(summary.first)}</span>
            </span>
          )}
          {summary.last && (
            <span>
              Latest:{' '}
              <span className="text-white/80">{formatTimeStamp(summary.last)}</span>
            </span>
          )}
          {readAt && (
            <span className="text-blue-300/80">
              Read {formatTimeStamp(readAt)}
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

      {/* Channel filter chips */}
      {channelsPresent.length > 1 && (
        <div className="px-4 py-2 border-b border-white/10 flex gap-1.5 flex-wrap">
          <FilterChip
            label="All"
            count={sorted.length}
            active={activeFilter === 'all'}
            onClick={() => setActiveFilter('all')}
            activeClass="bg-white/20 text-white border-white/30"
            inactiveClass="bg-white/5 text-white/50 border-white/10 hover:text-white/80"
          />
          {channelsPresent.map((ch) => {
            const cfg = getChannelConfig(ch)
            return (
              <FilterChip
                key={ch}
                label={cfg.label}
                count={sorted.filter((m) => (m.channel ?? 'platform').toLowerCase() === ch).length}
                active={activeFilter === ch}
                onClick={() => setActiveFilter(ch)}
                activeClass={cfg.chipActiveClass}
                inactiveClass={cfg.chipClass}
              />
            )
          })}
        </div>
      )}

      {/* Empty filtered state */}
      {filtered.length === 0 && (
        <div className="p-8 text-center text-sm text-white/50">
          No messages on{' '}
          {getChannelConfig(activeFilter !== 'all' ? activeFilter : null).label} yet.
        </div>
      )}

      {/* Scroll body */}
      <div className="max-h-[70vh] overflow-y-auto px-4 py-4 space-y-4">
        {renderItems.map((item) => {
          if (item.type === 'day') {
            return (
              <DayDivider key={item.key} label={formatDateDivider(item.date)} />
            )
          }
          if (item.type === 'handoff') {
            return (
              <HandoffMarker
                key={item.key}
                fromChannel={item.fromChannel}
                toChannel={item.toChannel}
                date={item.date}
              />
            )
          }
          return (
            <Bubble
              key={item.msg.id}
              msg={item.msg}
              showBadge={item.showBadge}
              groupedWithPrev={item.groupedWithPrev}
            />
          )
        })}

        {/* Peer typing bubble (AI-8876) */}
        {peerTyping && <TypingBubble />}

        {/* Read receipt (AI-8876) */}
        {readAt && !peerTyping && (
          <ReadReceipt readAt={readAt} />
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Render item types ────────────────────────────────────────────────────────

type RenderItem =
  | { type: 'day'; key: string; date: Date }
  | {
      type: 'handoff'
      key: string
      fromChannel: string
      toChannel: string
      date: Date | null
    }
  | {
      type: 'bubble'
      key: string
      msg: ChatMessage
      showBadge: boolean
      groupedWithPrev: boolean
    }

function buildRenderItems(msgs: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = []
  let lastDayKey: string | null = null
  let prevChannel: string | null = null
  let prevIsMe: boolean | null = null
  let prevSentAt: number | null = null

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const d = m.sent_at ? new Date(m.sent_at) : null
    const dk = d ? dayKey(d) : 'no-date'
    const ch = (m.channel ?? 'platform').toLowerCase()

    // Day separator
    if (dk !== lastDayKey) {
      items.push({
        type: 'day',
        key: `day-${dk}-${i}`,
        date: d ?? new Date(0),
      })
      lastDayKey = dk
    }

    // Handoff marker: channel changed and consecutive messages on different channels
    if (prevChannel !== null && ch !== prevChannel) {
      items.push({
        type: 'handoff',
        key: `handoff-${i}-${prevChannel}-${ch}`,
        fromChannel: prevChannel,
        toChannel: ch,
        date: d,
      })
    }

    // 60s direction grouping: suppress badge if same direction within 60s
    const thisTime = d ? d.getTime() : null
    const groupedWithPrev =
      prevIsMe === m.is_from_me &&
      prevSentAt !== null &&
      thisTime !== null &&
      Math.abs(thisTime - prevSentAt) < 60_000 &&
      prevChannel === ch

    // Show channel badge on first message of a new channel block
    const showBadge = prevChannel !== ch || i === 0

    items.push({
      type: 'bubble',
      key: m.id,
      msg: m,
      showBadge,
      groupedWithPrev,
    })

    prevChannel = ch
    prevIsMe = m.is_from_me
    prevSentAt = thisTime
  }

  return items
}

// ── Sub-components ───────────────────────────────────────────────────────────

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-white/10" />
      <div className="text-[10px] uppercase tracking-wider text-white/40 whitespace-nowrap">
        {label}
      </div>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  )
}

function HandoffMarker({
  fromChannel,
  toChannel,
  date,
}: {
  fromChannel: string
  toChannel: string
  date: Date | null
}) {
  const toCfg = getChannelConfig(toChannel)
  const dateStr = date ? formatTimeStamp(date) : null
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-white/10" />
      <div
        className={`px-3 py-1 rounded-full border text-[10px] font-medium tracking-wide ${toCfg.badgeClass}`}
      >
        Moved to {toCfg.label}
        {dateStr ? ` · ${dateStr}` : ''}
      </div>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  )
}

/** AI-8876: Animated three-dot typing indicator (peer is typing) */
function TypingBubble() {
  return (
    <div className="flex justify-start mt-1.5" aria-label="Typing indicator">
      <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-white/10 flex items-center gap-1">
        <span
          className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce"
          style={{ animationDelay: '0ms', animationDuration: '800ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce"
          style={{ animationDelay: '150ms', animationDuration: '800ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce"
          style={{ animationDelay: '300ms', animationDuration: '800ms' }}
        />
      </div>
    </div>
  )
}

/** AI-8876: "Read" receipt indicator below the last outgoing message */
function ReadReceipt({ readAt }: { readAt: Date }) {
  return (
    <div className="flex justify-end pr-1">
      <span className="text-[10px] text-blue-400/80 tracking-wide">
        Read {formatTimeStamp(readAt)}
      </span>
    </div>
  )
}

function Bubble({
  msg,
  showBadge,
  groupedWithPrev,
}: {
  msg: ChatMessage
  showBadge: boolean
  groupedWithPrev: boolean
}) {
  const isMe = msg.is_from_me
  const ch = (msg.channel ?? 'platform').toLowerCase()
  const cfg = getChannelConfig(ch)
  const stamp = msg.sent_at ? new Date(msg.sent_at) : null
  const tooltip = stamp
    ? `${formatTimeStamp(stamp)}${msg.channel ? ` · ${cfg.label}` : ''}`
    : msg.channel ?? ''

  // Aggregate reactions by emoji
  const reactionGroups = useMemo<Array<{ emoji: string; count: number }>>(() => {
    if (!msg.reactions?.length) return []
    const counts: Record<string, number> = {}
    for (const r of msg.reactions) {
      const emoji = tapbackEmoji(r.kind)
      counts[emoji] = (counts[emoji] ?? 0) + 1
    }
    return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }))
  }, [msg.reactions])

  return (
    <div
      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group ${groupedWithPrev ? 'mt-0.5' : 'mt-1.5'}`}
    >
      <div
        className={`max-w-[78%] px-3.5 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap break-words shadow-sm ${
          isMe ? `${cfg.bubbleClass} rounded-br-md` : 'bg-white/10 text-white/90 rounded-bl-md'
        }`}
        title={tooltip}
      >
        {msg.text || (
          <span className="italic text-white/50">[empty message]</span>
        )}

        {/* Channel badge + auto indicator */}
        <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
          {showBadge && (
            <span
              className={`text-[9px] px-1.5 py-px rounded border uppercase tracking-wide ${
                isMe
                  ? 'bg-black/20 text-white/60 border-white/20'
                  : cfg.badgeClass
              }`}
            >
              {cfg.label}
            </span>
          )}
          {msg.is_auto_sent && isMe && (
            <span className="text-[9px] uppercase tracking-wide opacity-75">
              &#129302; auto
            </span>
          )}
        </div>

        {/* Hover timestamp */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] mt-0.5 text-white/70">
          {stamp ? formatTimeStamp(stamp) : ''}
        </div>
      </div>

      {/* AI-8876: Inbound tapback/reaction bubbles */}
      {reactionGroups.length > 0 && (
        <div
          className={`flex gap-0.5 mt-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}
          aria-label="Message reactions"
        >
          {reactionGroups.map(({ emoji, count }) => (
            <span
              key={emoji}
              className="inline-flex items-center gap-0.5 text-[13px] px-1.5 py-0.5 rounded-full bg-white/10 border border-white/10"
              title={`${count} reaction${count > 1 ? 's' : ''}`}
            >
              {emoji}
              {count > 1 && (
                <span className="text-[10px] text-white/60">{count}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  activeClass,
  inactiveClass,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  activeClass: string
  inactiveClass: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
        active ? activeClass : inactiveClass
      }`}
    >
      {label}
      <span
        className={`ml-1 text-[10px] ${active ? 'opacity-80' : 'opacity-50'}`}
      >
        {count}
      </span>
    </button>
  )
}
