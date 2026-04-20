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
                className={`text-[10px] mt-1 font-mono ${
                  isOut ? 'text-black/50' : 'text-white/40'
                }`}
              >
                {isOut ? 'You' : matchName ?? 'Her'} · {formatTimeAgo(msg.sent_at)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
