'use client'

import { useMemo, useState } from 'react'
import { Search, Star, X } from 'lucide-react'
import { createClient } from '@/lib/convex/client'
import {
  ClapcheeksMatchRow,
  ROSTER_STAGES,
  RosterStage,
} from '@/lib/matches/types'
import RosterCard from './RosterCard'

type LastMessageMap = Record<string, string | null>

type Props = {
  initialMatches: ClapcheeksMatchRow[]
  lastMessages: LastMessageMap
}

const COLUMN_LIMIT = 20

// Heuristic map from legacy `status` values to new `stage` values so rows
// written pre-Phase-J still show up in a sensible column.
function deriveStage(m: ClapcheeksMatchRow): RosterStage {
  if (m.stage) return m.stage
  switch (m.status) {
    case 'new':
    case 'opened':      return 'new_match'
    case 'conversing':  return 'chatting'
    case 'date_proposed': return 'date_proposed'
    case 'date_booked': return 'date_booked'
    case 'dated':       return 'date_attended'
    case 'stalled':     return 'faded'
    case 'ghosted':     return 'ghosted'
    default:            return 'new_match'
  }
}

function matchSearchText(match: ClapcheeksMatchRow, lastMessage: string | null | undefined) {
  const values = [
    match.name,
    match.bio,
    match.job,
    match.school,
    match.instagram_handle,
    match.platform,
    match.status,
    match.stage,
    match.vision_summary,
    lastMessage,
  ]

  const intel = match.match_intel
  if (intel && typeof intel === 'object') {
    for (const [key, value] of Object.entries(intel)) {
      const lower = key.toLowerCase()
      if (lower.includes('token') || lower.includes('auth')) continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        values.push(String(value))
      } else if (Array.isArray(value)) {
        values.push(value.filter((item) => typeof item === 'string' || typeof item === 'number').join(' '))
      }
    }
  }

  return values.filter(Boolean).join(' ').toLowerCase()
}

function isFavorite(match: ClapcheeksMatchRow) {
  return typeof match.julian_rank === 'number' && match.julian_rank >= 10
}

export default function RosterKanban({ initialMatches, lastMessages }: Props) {
  const [matches, setMatches] = useState<ClapcheeksMatchRow[]>(initialMatches)
  const [dragTarget, setDragTarget] = useState<RosterStage | null>(null)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [atRiskOnly, setAtRiskOnly] = useState(false)

  const visibleMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return matches.filter((match) => {
      if (favoritesOnly && !isFavorite(match)) return false
      if (atRiskOnly && !((match.health_score ?? 100) < 50)) return false
      if (q && !matchSearchText(match, lastMessages[match.id]).includes(q)) return false
      return true
    })
  }, [atRiskOnly, favoritesOnly, lastMessages, matches, query])

  const grouped = useMemo(() => {
    const by: Record<RosterStage, ClapcheeksMatchRow[]> = {} as never
    for (const s of ROSTER_STAGES) by[s.key] = []
    const stageKeys = new Set(ROSTER_STAGES.map((s) => s.key))
    for (const m of visibleMatches) {
      const stage = deriveStage(m)
      // Don't surface archived/cluster-dupe rows in the kanban columns.
      if (!stageKeys.has(stage)) continue
      const col = by[stage]
      if (col && col.length < COLUMN_LIMIT) col.push(m)
    }
    // Sort each column by close_probability desc (fallback final_score).
    for (const s of ROSTER_STAGES) {
      by[s.key].sort((a, b) => {
        const ap = a.close_probability ?? (a.final_score ?? 0) / 100
        const bp = b.close_probability ?? (b.final_score ?? 0) / 100
        if (isFavorite(a) !== isFavorite(b)) return isFavorite(a) ? -1 : 1
        return bp - ap
      })
    }
    return by
  }, [visibleMatches])

  const favoriteCount = useMemo(() => matches.filter(isFavorite).length, [matches])
  const atRiskCount = useMemo(() => matches.filter((m) => (m.health_score ?? 100) < 50).length, [matches])
  const filtersActive = query.trim().length > 0 || favoritesOnly || atRiskOnly

  async function moveMatch(matchId: string, nextStage: RosterStage) {
    setPersistError(null)
    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, stage: nextStage } : m)),
    )
    try {
      const convex = createClient()
      // stage column may not exist if migration hasn't shipped — catch and
      // revert in that case.
      const { error } = await (convex as any)
        .from('clapcheeks_matches')
        .update({ stage: nextStage, updated_at: new Date().toISOString() })
        .eq('id', matchId)
      if (error) {
        setPersistError(`Stage save failed: ${error.message}`)
      }
    } catch (e) {
      setPersistError((e as Error).message)
    }
  }

  async function toggleFavorite(matchId: string) {
    setPersistError(null)
    const current = matches.find((m) => m.id === matchId)
    const nextRank = current && isFavorite(current) ? null : 10
    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, julian_rank: nextRank } : m)),
    )
    try {
      const convex = createClient()
      const { error } = await (convex as any)
        .from('clapcheeks_matches')
        .update({ julian_rank: nextRank, updated_at: new Date().toISOString() })
        .eq('id', matchId)
      if (error) {
        setPersistError(`Favorite save failed: ${error.message}`)
        setMatches((prev) =>
          prev.map((m) => (m.id === matchId ? { ...m, julian_rank: current?.julian_rank ?? null } : m)),
        )
      }
    } catch (e) {
      setPersistError((e as Error).message)
      setMatches((prev) =>
        prev.map((m) => (m.id === matchId ? { ...m, julian_rank: current?.julian_rank ?? null } : m)),
      )
    }
  }

  function clearFilters() {
    setQuery('')
    setFavoritesOnly(false)
    setAtRiskOnly(false)
  }

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-white/10 bg-black/85 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search roster by name, app, bio, intel, or last message"
              className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-9 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-yellow-500/40 focus:bg-white/[0.06]"
              aria-label="Search roster"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Clear roster search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFavoritesOnly((value) => !value)}
              className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                favoritesOnly
                  ? 'border-yellow-400/45 bg-yellow-500/15 text-yellow-200'
                  : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
              }`}
              aria-pressed={favoritesOnly}
            >
              <Star className={`h-3.5 w-3.5 ${favoritesOnly ? 'fill-current' : ''}`} />
              Favorites
              <span className="font-mono text-white/35">{favoriteCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setAtRiskOnly((value) => !value)}
              className={`h-10 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                atRiskOnly
                  ? 'border-amber-400/45 bg-amber-500/15 text-amber-100'
                  : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
              }`}
              aria-pressed={atRiskOnly}
            >
              At-risk health
              <span className="ml-1.5 font-mono text-white/35">{atRiskCount}</span>
            </button>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                Clear
              </button>
            )}
            <span className="text-[10px] uppercase tracking-widest text-white/30 font-mono">
              {visibleMatches.length}/{matches.length}
            </span>
          </div>
        </div>
      </div>
      {persistError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-xs text-amber-300 font-mono">
          {persistError}
        </div>
      )}
      {visibleMatches.length === 0 && filtersActive && (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-sm text-white/45">No roster matches fit those filters.</p>
        </div>
      )}
      <div
        data-testid="roster-kanban"
        className="flex gap-3 overflow-x-auto pb-4 snap-x"
        role="list"
      >
        {ROSTER_STAGES.map((s) => {
          const items = grouped[s.key]
          const active = dragTarget === s.key
          return (
            <div
              key={s.key}
              data-testid={`roster-column-${s.key}`}
              data-stage={s.key}
              role="listitem"
              onDragOver={(e) => {
                e.preventDefault()
                setDragTarget(s.key)
              }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/match-id')
                if (id) moveMatch(id, s.key)
                setDragTarget(null)
              }}
              className={`
                flex-shrink-0 w-[260px] md:w-[280px] snap-start
                bg-white/[0.02] border rounded-xl p-2.5
                ${active ? 'border-yellow-500/60 bg-yellow-500/5' : 'border-white/10'}
              `}
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase tracking-widest font-mono px-2 py-0.5 rounded border ${s.tone}`}>
                    {s.label}
                  </span>
                  <span className="text-[10px] text-white/40 font-mono">
                    {items.length}
                  </span>
                </div>
              </div>

              <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
                {items.length === 0 ? (
                  <div className="text-[10px] text-white/25 italic text-center py-6">
                    Empty
                  </div>
                ) : (
                  items.map((m) => (
                    <RosterCard
                      key={m.id}
                      match={m}
                      lastMessage={lastMessages[m.id]}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
