'use client'

import { ConversationMessage, formatTimeAgo } from '@/lib/matches/types'

// Channel badge styles for all supported platforms (AI-8807)
const CHANNEL_BADGES: Record<string, string> = {
  tinder:    'bg-rose-500/20 text-rose-300 border-rose-500/30',
  hinge:     'bg-purple-500/20 text-purple-300 border-purple-500/30',
  bumble:    'bg-amber-500/20 text-amber-300 border-amber-500/30',
  instagram: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  imessage:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  platform:  'bg-white/10 text-white/60 border-white/15',
}

const CHANNEL_LABELS: Record<string, string> = {
  tinder:    'Tinder',
  hinge:     'Hinge',
  bumble:    'Bumble',
  instagram: 'Instagram',
  imessage:  'iMessage',
  platform:  'App',
}

function getChannelBadge(channel: string | null | undefined) {
  const key = (channel ?? 'platform').toLowerCase()
  return {
    cls: CHANNEL_BADGES[key] ?? CHANNEL_BADGES.platform,
    label: CHANNEL_LABELS[key] ?? channel ?? 'App',
  }
}

type Props = {
  messages: ConversationMessage[]
  matchName?: string | null
}

export default function ConversationThread({ messages, matchName }: Props) {
  if (!messages || messages.length === 0) {
    return (
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6 text-center">
        <p className="text-white/40 text-sm">No conversation yet.</p>
        <p className="text-white/25 text-xs mt-1">
          Messages will appear here once the agent logs outbound or incoming replies.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3 max-h-[600px] overflow-y-auto">
      {messages.map((msg, i) => {
        const isOut = msg.direction === 'outgoing'
        const badge = getChannelBadge(msg.channel)
        return (
          <div
            key={msg.id ?? i}
            className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                isOut
                  ? 'bg-gradient-to-br from-yellow-500/90 to-red-600/80 text-black font-medium rounded-br-sm'
                  : 'bg-white/10 text-white/90 rounded-bl-sm'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{msg.body}</div>
              <div
                className={`text-[10px] mt-1 font-mono flex items-center gap-1.5 ${
                  isOut ? 'text-black/50' : 'text-white/40'
                }`}
              >
                <span>{isOut ? 'You' : matchName ?? 'Her'} · {formatTimeAgo(msg.sent_at)}</span>
                {msg.channel && (
                  <span
                    className={`px-1.5 py-px rounded border text-[9px] uppercase ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
