'use client'

import Link from 'next/link'
import {
  ClapcheeksMatchRow,
  PLATFORM_COLORS,
  formatTimeAgo,
} from '@/lib/matches/types'

type Props = {
  match: ClapcheeksMatchRow
  lastMessage?: string | null
  onDragStart?: (id: string) => void
  draggable?: boolean
}

/**
 * Phase J (AI-8338) roster kanban card. Tighter than MatchCard — shows
 * photo, name+age, health bar, Julian rank stars, close-prob %, last-msg.
 */
export default function RosterCard({ match, lastMessage, onDragStart, draggable = true }: Props) {
  const primaryPhoto = match.photos_jsonb?.[0]?.url ?? null
  const initials = (match.name ?? '?').slice(0, 1).toUpperCase()
  const health = typeof match.health_score === 'number' ? match.health_score : null
  const rank = typeof match.julian_rank === 'number' ? match.julian_rank : null
  const closeProb =
    typeof match.close_probability === 'number'
      ? Math.round(match.close_probability * 100)
      : null

  const healthTone =
    health === null ? 'bg-white/20' :
    health >= 75   ? 'bg-emerald-400' :
    health >= 50   ? 'bg-yellow-400' :
    health >= 25   ? 'bg-amber-500' :
                     'bg-rose-500'

  return (
    <div
      data-testid="roster-card"
      data-match-id={match.id}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/match-id', match.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.(match.id)
      }}
      className="group bg-white/[0.04] border border-white/10 rounded-lg overflow-hidden hover:border-yellow-500/40 hover:bg-white/[0.06] transition-all cursor-grab active:cursor-grabbing"
    >
      <Link href={`/dashboard/matches/${match.id}`} className="block">
        <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-zinc-800 to-zinc-900 overflow-hidden">
          {primaryPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={primaryPhoto}
              alt={match.name ?? 'Match'}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30 text-3xl font-bold">
              {initials}
            </div>
          )}
          <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
            <span
              className={`text-[9px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded border ${PLATFORM_COLORS[match.platform]}`}
            >
              {match.platform}
            </span>
            {closeProb !== null && (
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/70 border border-yellow-500/40 text-yellow-400">
                {closeProb}%
              </span>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-white font-semibold text-sm truncate">
                {match.name ?? 'Unknown'}
              </span>
              {match.age && <span className="text-white/70 text-xs">{match.age}</span>}
            </div>
          </div>
        </div>

        {/* Health bar */}
        <div className="px-2.5 pt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] uppercase tracking-wider text-white/40 font-mono">
              Health
            </span>
            <span className="text-[10px] font-mono text-white/70">
              {health ?? '—'}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full ${healthTone} transition-all`}
              style={{ width: `${health ?? 0}%` }}
              aria-label={`Health score ${health ?? 'unknown'}`}
            />
          </div>
        </div>

        {/* Rank stars */}
        <div className="px-2.5 pt-2 flex items-center justify-between">
          <div className="flex items-center gap-0.5" aria-label={`AI rank ${rank ?? 'unset'}`}>
            {[...Array(5)].map((_, i) => {
              const filled = rank !== null && rank >= (i + 1) * 2
              const half = rank !== null && rank >= i * 2 + 1 && rank < (i + 1) * 2
              return (
                <span
                  key={i}
                  className={`text-[10px] ${filled ? 'text-yellow-400' : half ? 'text-yellow-400/50' : 'text-white/20'}`}
                >
                  {'*'}
                </span>
              )
            })}
          </div>
          <span className="text-[9px] text-white/40 font-mono">
            {formatTimeAgo(match.last_activity_at ?? match.updated_at)}
          </span>
        </div>

        <div className="px-2.5 pt-1.5 pb-2.5">
          {lastMessage ? (
            <p className="text-[11px] text-white/50 line-clamp-2 leading-snug">{lastMessage}</p>
          ) : (
            <p className="text-[11px] text-white/25 italic">No conversation yet</p>
          )}
        </div>
      </Link>
    </div>
  )
}
