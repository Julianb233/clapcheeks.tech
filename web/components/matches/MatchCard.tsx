'use client'

import Link from 'next/link'
import {
  ClapcheeksMatchRow,
  PLATFORM_COLORS,
  STATUS_COLORS,
  formatTimeAgo,
} from '@/lib/matches/types'
import { getCoverPhoto } from '@/lib/matches/photos'
import MatchPhotoImage from './MatchPhotoImage'

type Props = {
  match: ClapcheeksMatchRow
  lastMessage?: string | null
}

export default function MatchCard({ match, lastMessage }: Props) {
  const matchAny = match as ClapcheeksMatchRow & { _id?: string; match_name?: string | null; photos?: Array<{ url?: string | null }> }
  const matchId = matchAny.id || matchAny._id
  const displayName = matchAny.name || matchAny.match_name || 'Unknown'
  const primaryPhoto = getCoverPhoto(matchAny.photos_jsonb) ?? getCoverPhoto(matchAny.photos) ?? null
  const initials = displayName.slice(0, 1).toUpperCase()
  const score = typeof match.final_score === 'number' ? Math.round(match.final_score) : null
  const intel = match.match_intel ?? {}
  const appOriginRoster =
    typeof intel.app_origin_roster === 'object' &&
    intel.app_origin_roster !== null &&
    !Array.isArray(intel.app_origin_roster)
      ? (intel.app_origin_roster as Record<string, unknown>)
      : {}
  const sourcePlatformRaw = appOriginRoster.source_platform ?? intel.source_platform
  const sourcePlatform =
    typeof sourcePlatformRaw === 'string' ? sourcePlatformRaw.trim().toLowerCase() : ''
  const verifiedFromApp = Boolean(
    intel.verified_from_app ||
      appOriginRoster.verified_from_app ||
      appOriginRoster.status === 'verified_from_app',
  )
  const needsReview = Boolean(intel.needs_review || appOriginRoster.needs_review)
  const rosterChips = [
    verifiedFromApp
      ? {
          key: 'verified-from-app',
          label: 'verified from app',
          className: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200',
        }
      : null,
    sourcePlatform
      ? {
          key: 'source-platform',
          label: `source: ${sourcePlatform}`,
          className: 'border-violet-400/25 bg-violet-400/10 text-violet-200',
        }
      : null,
    needsReview
      ? {
          key: 'needs-review',
          label: 'needs review',
          className: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
        }
      : null,
  ].filter((chip): chip is { key: string; label: string; className: string } => chip !== null)
  const intelSignals = [
    ...((Array.isArray(intel.interests) ? intel.interests : []) as string[]),
    ...((Array.isArray(intel.prompt_themes) ? intel.prompt_themes : []) as string[]),
    ...((Array.isArray(intel.tags) ? intel.tags : []) as string[]),
    ...((Array.isArray(intel.green_flags) ? intel.green_flags : []) as string[]),
  ]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, 3)
  const intelCount =
    intelSignals.length +
    (Array.isArray(intel.profile_prompts_observed) ? intel.profile_prompts_observed.length : 0) +
    (typeof intel.prompt_text === 'string' && intel.prompt_text.trim() ? 1 : 0)

  return (
    <Link
      href={matchId ? `/matches/${matchId}` : '/dashboard/matches'}
      className="group block bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden hover:border-yellow-500/40 hover:bg-white/[0.05] transition-all"
    >
      <div className="relative aspect-[3/4] w-full bg-gradient-to-br from-zinc-800 to-zinc-900 overflow-hidden">
        <MatchPhotoImage
          src={primaryPhoto}
          alt={displayName}
          initials={initials}
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
          fallbackClassName="w-full h-full flex items-center justify-center text-white/30 text-5xl font-bold"
        />
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
              {displayName}
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
        {rosterChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {rosterChips.map((chip) => (
              <span
                key={chip.key}
                className={`max-w-full truncate rounded border px-1.5 py-0.5 text-[10px] ${chip.className}`}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}
        {(intelSignals.length > 0 || intelCount > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {intelSignals.map((signal) => (
              <span
                key={signal}
                className="max-w-full truncate rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200"
              >
                {signal}
              </span>
            ))}
            {intelCount > intelSignals.length && (
              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/45">
                +{intelCount - intelSignals.length} intel
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}
