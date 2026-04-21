'use client'

import { ConversationMessage, formatTimeAgo } from '@/lib/matches/types'

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
                {msg.channel === 'imessage' && (
                  <span className="px-1.5 py-px rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[9px] uppercase">
                    iMessage
                  </span>
                )}
                {msg.channel === 'platform' && msg.platform && (
                  <span className="px-1.5 py-px rounded bg-white/10 text-white/60 border border-white/15 text-[9px] uppercase">
                    {msg.platform}
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
