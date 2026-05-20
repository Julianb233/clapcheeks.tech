'use client'

import Link from 'next/link'
import { Star } from 'lucide-react'
import {
  ClapcheeksMatchRow,
  PLATFORM_COLORS,
  formatTimeAgo,
} from '@/lib/matches/types'
import { getCoverPhoto } from '@/lib/matches/photos'
import { getMatchIdentityStatus } from '@/lib/matches/identity'
import MatchPhotoImage from '@/components/matches/MatchPhotoImage'

type Props = {
  match: ClapcheeksMatchRow
  lastMessage?: string | null
  onDragStart?: (id: string) => void
  onToggleFavorite?: (id: string) => void
  draggable?: boolean
}

/**
 * Phase J (AI-8338) roster kanban card. Tighter than MatchCard — shows
 * photo, name+age, health bar, Julian rank stars, close-prob %, last-msg.
 */
export default function RosterCard({ match, lastMessage, onDragStart, onToggleFavorite, draggable = true }: Props) {
  const identity = getMatchIdentityStatus(match)
  const displayName = identity.displayName
  const primaryPhoto = getCoverPhoto(match.photos_jsonb) ?? getCoverPhoto(match.photos)
  const initials = displayName.slice(0, 1).toUpperCase()
  const health = typeof match.health_score === 'number' ? match.health_score : null
  const rank = typeof match.julian_rank === 'number' ? match.julian_rank : null
  const favorite = rank !== null && rank >= 10
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
      className={`group bg-white/[0.04] border rounded-lg overflow-hidden hover:border-yellow-500/40 hover:bg-white/[0.06] transition-all cursor-grab active:cursor-grabbing ${
        favorite ? 'border-yellow-400/45' : 'border-white/10'
      }`}
    >
      <Link href={`/matches/${match.id}`} className="block">
        <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-zinc-800 to-zinc-900 overflow-hidden">
          <MatchPhotoImage
            src={primaryPhoto}
            alt={displayName}
            initials={initials}
            loading="eager"
            className="w-full h-full object-cover"
            fallbackClassName="w-full h-full flex items-center justify-center text-white/30 text-3xl font-bold"
          />
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
                {displayName}
              </span>
              {match.age && <span className="text-white/70 text-xs">{match.age}</span>}
            </div>
            {identity.needsReview && identity.label && (
              <div className="mt-1 max-w-full truncate rounded border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-100">
                {identity.label}
              </div>
            )}
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
          <div className="flex items-center gap-0.5" aria-label={`Julian rank ${rank ?? 'unset'}`}>
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
      <div className="border-t border-white/10 px-2.5 py-2">
        <button
          type="button"
          onClick={() => onToggleFavorite?.(match.id)}
          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] font-semibold transition-colors ${
            favorite
              ? 'border-yellow-400/45 bg-yellow-500/15 text-yellow-200 hover:bg-yellow-500/25'
              : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/80'
          }`}
          aria-pressed={favorite}
          aria-label={favorite ? `Remove ${displayName} from favorites` : `Favorite ${displayName}`}
        >
          <Star className={`h-3.5 w-3.5 ${favorite ? 'fill-current' : ''}`} />
          {favorite ? 'Favorited' : 'Favorite'}
        </button>
      </div>
    </div>
  )
}
