'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import FilterBar from './FilterBar'
import AttributeChipMini from './AttributeChipMini'
import OfflineContactForm from './OfflineContactForm'
import { MatchListFilters } from '@/lib/matches/types'
import {
  aggregateAttributes,
  matchHasAllAttributes,
  type MatchWithAttributes,
} from '@/lib/matches/attribute-filter'

const DEFAULT_FILTERS: MatchListFilters = {
  platform: 'all',
  status: 'all',
  minScore: 0,
  attributeValues: [],
}

type Props = {
  matches: MatchWithAttributes[]
  errorMessage?: string | null
}

type PhotoJson = { url: string; supabase_path?: string | null; width?: number; height?: number }

function coverPhoto(photos: unknown): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null
  const p = photos[0] as PhotoJson
  return (p && typeof p === 'object' && p.url) || null
}

function intelInterests(intel: unknown): string[] {
  if (!intel || typeof intel !== 'object') return []
  const v = (intel as Record<string, unknown>).interests
  return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : []
}

export default function MatchesPageClient({ matches, errorMessage }: Props) {
  const [filters, setFilters] = useState<MatchListFilters>(DEFAULT_FILTERS)

  const attributeOptions = useMemo(() => aggregateAttributes(matches), [matches])

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (filters.platform !== 'all' && m.platform !== filters.platform) return false
      if (filters.status !== 'all' && m.status !== filters.status) return false
      if (filters.minScore > 0) {
        const s = typeof m.final_score === 'number' ? m.final_score : 0
        if (s < filters.minScore) return false
      }
      if (!matchHasAllAttributes(m, filters.attributeValues)) return false
      return true
    })
  }, [matches, filters])

  const hasMatches = matches.length > 0
  const hasFilteredOut = hasMatches && filtered.length === 0

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header — count reflects filtered/total when filters active, total otherwise. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-sm shadow-lg shadow-pink-500/20">
                🔮
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold">Matches</h1>
              <span className="text-xs text-white/50 bg-white/5 px-2 py-0.5 rounded-full font-mono border border-white/10">
                {filtered.length === matches.length
                  ? matches.length
                  : `${filtered.length} / ${matches.length}`}
              </span>
            </div>
            <p className="text-sm text-white/50 ml-11">
              Every match across every platform, ranked by score and recency. Click a card to drill in.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <OfflineContactForm />
            <Link
              href="/matches/add"
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-sm font-medium transition-all whitespace-nowrap shadow-lg shadow-pink-500/20"
            >
              + Add Match
            </Link>
          </div>
        </div>

        {errorMessage && (
          <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
            Could not load matches: {errorMessage}
          </div>
        )}

        {/* Empty state — never been any matches */}
        {!hasMatches ? (
          <div className="text-center py-16 sm:py-20 border border-white/10 bg-white/[0.02] rounded-2xl">
            <div className="text-5xl mb-4">🔮</div>
            <h2 className="text-xl font-medium mb-2">No matches yet</h2>
            <p className="text-white/50 mb-6 max-w-md mx-auto">
              Connect a dating platform or add a match manually. Photos, bios, and AI-tagged attributes
              show up here.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/matches/add"
                className="inline-block px-6 py-3 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 font-medium transition-all shadow-lg shadow-pink-500/20"
              >
                Add Your First Match
              </Link>
              <Link
                href="/account-health"
                className="inline-block px-6 py-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 hover:text-white text-sm transition-all"
              >
                Connect a platform
              </Link>
            </div>
          </div>
        ) : (
          <>
            <FilterBar
              filters={filters}
              onChange={setFilters}
              total={matches.length}
              filteredCount={filtered.length}
              attributeOptions={attributeOptions}
              accent="pink"
            />

            {hasFilteredOut ? (
              <div className="text-center py-12 border border-white/10 bg-white/[0.02] rounded-2xl">
                <div className="text-3xl mb-2">🤷</div>
                <h2 className="text-base font-medium mb-1 text-white/80">No matches match these filters</h2>
                <p className="text-white/50 text-sm mb-4">
                  Try removing a tag or lowering the minimum score.
                </p>
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="text-sm px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 hover:text-white transition-all"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {filtered.map((m) => (
                  <MatchTile key={m.id} match={m} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// --- Card —- preserves the rich /matches design + adds AttributeChipMini below the photo. ---

type TileMatch = MatchWithAttributes & {
  match_name?: string | null
  bio?: string | null
  job?: string | null
  school?: string | null
}

function MatchTile({ match }: { match: TileMatch }) {
  const displayName = match.name || match.match_name || 'Unknown'
  const photo = coverPhoto(match.photos_jsonb)
  const nPhotos = Array.isArray(match.photos_jsonb)
    ? (match.photos_jsonb as PhotoJson[]).length
    : 0
  const interests = intelInterests(match.match_intel).slice(0, 5)

  return (
    <Link
      href={`/matches/${match.id}`}
      className="group flex flex-col rounded-2xl border border-white/10 bg-white/5 overflow-hidden hover:border-pink-500/40 hover:bg-white/[0.07] hover:-translate-y-0.5 transition-all duration-200"
    >
      <div className="relative aspect-[4/5] bg-gradient-to-br from-pink-900/40 to-purple-900/40">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={displayName}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-white/30">
            {displayName[0]?.toUpperCase() || '?'}
          </div>
        )}

        {nPhotos > 1 && (
          <span className="absolute top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm">
            {nPhotos} pics
          </span>
        )}

        {typeof match.julian_rank === 'number' && (
          <span className="absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-pink-500/90 shadow-lg shadow-pink-500/30">
            #{match.julian_rank}
          </span>
        )}

        {typeof match.final_score === 'number' && match.julian_rank == null && (
          <span className="absolute top-2 left-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-black/70 backdrop-blur border border-pink-500/40 text-pink-300">
            {Math.round(match.final_score)}
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
          <div className="font-semibold text-lg leading-tight">
            {displayName}
            {match.age ? <span className="font-normal text-white/70">, {match.age}</span> : null}
          </div>
          <div className="text-[11px] text-white/60 uppercase tracking-wide">
            {match.platform ?? 'unknown'}
            {match.zodiac ? <> · {match.zodiac}</> : null}
            {match.stage ? <> · {match.stage}</> : null}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* AI-8814 attribute chips — visible badge that this match has tags */}
        {match.attributes && <AttributeChipMini attributes={match.attributes} />}

        {match.bio && (
          <p className="text-xs text-white/70 leading-relaxed line-clamp-3">{match.bio}</p>
        )}

        {(match.job || match.school) && (
          <div className="text-[11px] text-white/50 space-y-0.5">
            {match.job && <div>💼 {match.job}</div>}
            {match.school && <div>🎓 {match.school}</div>}
          </div>
        )}

        {interests.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {interests.map((t, i) => (
              <span
                key={i}
                className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-200 border border-pink-500/20"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {match.instagram_handle && (
          <div className="text-[11px] text-white/50">
            📸 @{match.instagram_handle.replace(/^@/, '')}
          </div>
        )}
      </div>
    </Link>
  )
}
