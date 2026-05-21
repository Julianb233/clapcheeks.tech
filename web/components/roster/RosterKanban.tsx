'use client'

import { useMemo, useState } from 'react'
import { useConvex } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
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

export default function RosterKanban({ initialMatches, lastMessages }: Props) {
  const [matches, setMatches] = useState<ClapcheeksMatchRow[]>(initialMatches)
  const [dragTarget, setDragTarget] = useState<RosterStage | null>(null)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [atRiskOnly, setAtRiskOnly] = useState(false)
  const convex = useConvex()

  const filteredMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return matches.filter((match) => {
      const haystack = [
        match.name,
        match.platform,
        match.status,
        match.stage,
        match.bio,
        match.instagram_handle,
      ].filter(Boolean).join(' ').toLowerCase()
      const isFavorite = Boolean((match as any).is_favorite || (match as any).favorite || (match as any).match_intel?.favorite)
      const health = typeof match.health_score === 'number' ? match.health_score : 100
      if (q && !haystack.includes(q)) return false
      if (favoritesOnly && !isFavorite) return false
      if (atRiskOnly && health > 45) return false
      return true
    })
  }, [matches, search, favoritesOnly, atRiskOnly])

  const grouped = useMemo(() => {
    const by: Record<RosterStage, ClapcheeksMatchRow[]> = {} as never
    for (const s of ROSTER_STAGES) by[s.key] = []
    const stageKeys = new Set(ROSTER_STAGES.map((s) => s.key))
    for (const m of filteredMatches) {
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
        return bp - ap
      })
    }
    return by
  }, [filteredMatches])

  async function moveMatch(matchId: string, nextStage: RosterStage) {
    setPersistError(null)
    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, stage: nextStage } : m)),
    )
    try {
      // AI-9534 — matchId may be a Convex _id or a legacy Supabase UUID.
      // resolveByAnyId returns the doc; we then patch by the Convex _id.
      const resolved = (await convex.query(api.matches.resolveByAnyId, {
        id: matchId,
      })) as (Record<string, unknown> & { _id?: Id<'matches'> }) | null
      if (!resolved?._id) {
        setPersistError('Stage save failed: match not found.')
        return
      }
      await convex.mutation(api.matches.patch, {
        id: resolved._id,
        stage: nextStage,
      })
    } catch (e) {
      setPersistError((e as Error).message)
    }
  }

  return (
    <div>
      {persistError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-xs text-amber-300 font-mono">
          {persistError}
        </div>
      )}
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <input
            aria-label="Search roster"
            placeholder="Search roster"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full md:max-w-sm rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-yellow-500/50 focus:outline-none"
          />
          {search.trim() && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-mono uppercase tracking-wide text-white/60 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((value) => !value)}
            className={`rounded-lg border px-3 py-2 text-xs font-mono uppercase tracking-wide transition-colors ${
              favoritesOnly ? 'border-yellow-500/50 bg-yellow-500/15 text-yellow-100' : 'border-white/10 bg-white/[0.04] text-white/60 hover:text-white'
            }`}
          >
            Favorites
          </button>
          <button
            type="button"
            aria-pressed={atRiskOnly}
            onClick={() => setAtRiskOnly((value) => !value)}
            className={`rounded-lg border px-3 py-2 text-xs font-mono uppercase tracking-wide transition-colors ${
              atRiskOnly ? 'border-rose-500/50 bg-rose-500/15 text-rose-100' : 'border-white/10 bg-white/[0.04] text-white/60 hover:text-white'
            }`}
          >
            At-risk health
          </button>
        </div>
      </div>
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
