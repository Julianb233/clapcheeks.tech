'use client'

import Link from 'next/link'
import {
  ClapcheeksMatchRow,
  PLATFORM_COLORS,
  STATUS_COLORS,
  formatTimeAgo,
} from '@/lib/matches/types'

type Props = {
  match: ClapcheeksMatchRow
  lastMessage?: string | null
}

export default function MatchCard({ match, lastMessage }: Props) {
  const primaryPhoto = match.photos_jsonb?.[0]?.url ?? null
  const initials = (match.name ?? '?').slice(0, 1).toUpperCase()
  const score = typeof match.final_score === 'number' ? Math.round(match.final_score) : null

  return (
    <Link
      href={`/matches/${match.id}`}
      className="group block bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden hover:border-yellow-500/40 hover:bg-white/[0.05] transition-all"
    >
      <div className="relative aspect-[3/4] w-full bg-gradient-to-br from-zinc-800 to-zinc-900 overflow-hidden">
        {primaryPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primaryPhoto}
            alt={match.name ?? 'Match'}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/30 text-5xl font-bold">
            {initials}
          </div>
        )}
        {score !== null && (
          <div className="absolute top-2 left-2 bg-black/70 backdrop-blur border border-yellow-500/40 rounded-md px-2 py-0.5 text-[11px] font-mono font-bold text-yellow-400">
            {score}
          </div>
        )}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <span
            className={`text-[10px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded border ${PLATFORM_COLORS[match.platform]}`}
          >
            {match.platform}
          </span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-white font-semibold text-sm truncate">
              {match.name ?? 'Unknown'}
            </span>
            {match.age && <span className="text-white/70 text-sm">{match.age}</span>}
          </div>
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span
            className={`text-[10px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded border ${STATUS_COLORS[match.status] ?? STATUS_COLORS.new}`}
          >
            {match.status.replace('_', ' ')}
          </span>
          <span className="text-[10px] text-white/40 font-mono">
            {formatTimeAgo(match.last_activity_at ?? match.updated_at)}
          </span>
        </div>
        {lastMessage ? (
          <p className="text-xs text-white/50 line-clamp-2 leading-snug">{lastMessage}</p>
        ) : (
          <p className="text-xs text-white/25 italic">No conversation yet</p>
        )}
      </div>
    </Link>
  )
}
