'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ClapcheeksMatchRow } from '@/lib/matches/types'
import {
  PIPELINE_COLUMNS,
  type PipelineColumn,
  bucketStage,
  applyFilters,
  sortMatches,
  DEFAULT_FILTERS,
  type Filters,
  type SortKey,
  type Rankings,
} from './types'
import PipelineCard from './PipelineCard'
import PipelineFilters from './PipelineFilters'
import Leaderboard from './Leaderboard'

type Props = {
  initialMatches: ClapcheeksMatchRow[]
  lastMessages: Record<string, string | null>
}

export default function PipelineBoard({ initialMatches, lastMessages }: Props) {
  const [matches, setMatches] = useState<ClapcheeksMatchRow[]>(initialMatches)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortKey>('close_probability')
  const [dragOver, setDragOver] = useState<PipelineColumn | null>(null)
  const [persistError, setPersistError] = useState<string | null>(null)

  // Apply filter + sort, then bucket by 6-column.
  const grouped = useMemo(() => {
    const filtered = applyFilters(matches, filters)
    const sorted = sortMatches(filtered, sort)
    const buckets: Record<PipelineColumn, ClapcheeksMatchRow[]> = {
      new: [],
      chatting: [],
      proposed: [],
      booked: [],
      dated: [],
      recurring: [],
    }
    for (const m of sorted) {
      const col = bucketStage(m.stage ?? null)
      if (col === null) {
        // Cold lane (faded / ghosted / archived) — only show if toggle is on,
        // and dump them into 'new' so they're visible somewhere. Most users
        // will not enable this.
        if (filters.showCold) buckets.new.push(m)
        continue
      }
      buckets[col].push(m)
    }
    return { buckets, total: filtered.length }
  }, [matches, filters, sort])

  const totalCount = matches.length
  const visibleCount = grouped.total

  async function moveMatch(matchId: string, toColumn: PipelineColumn) {
    const def = PIPELINE_COLUMNS.find((c) => c.key === toColumn)
    if (!def) return
    const target = def.canonicalStage

    setPersistError(null)
    setMatches((prev) =>
      prev.map((m) =>
        m.id === matchId
          ? { ...m, stage: target, updated_at: new Date().toISOString() }
          : m,
      ),
    )

    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('clapcheeks_matches')
        .update({
          stage: target,
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchId)
      if (error) {
        setPersistError(`Stage save failed: ${error.message}`)
      }
    } catch (e) {
      setPersistError((e as Error).message)
    }
  }

  function handleRankSaved(matchId: string, rankings: Rankings, overall: number | null) {
    setMatches((prev) =>
      prev.map((m) =>
        m.id === matchId
          ? {
              ...m,
              julian_rank: overall,
              match_intel: {
                ...(m.match_intel ?? {}),
                rankings,
              },
            }
          : m,
      ),
    )
  }

  return (
    <div className="space-y-4">
      {persistError && (
        <div
          role="alert"
          className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300 font-mono"
        >
          {persistError}
        </div>
      )}

      {/* Filters + leaderboard, stacked on mobile, two-up on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        <PipelineFilters
          filters={filters}
          sort={sort}
          onFilters={setFilters}
          onSort={setSort}
          totalCount={totalCount}
          visibleCount={visibleCount}
        />
        <Leaderboard matches={matches} />
      </div>

      {/* ─── Mobile-first: horizontal scroll snap kanban ──────── */}
      <div
        data-testid="pipeline-kanban"
        className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0"
        role="list"
      >
        {PIPELINE_COLUMNS.map((col) => {
          const items = grouped.buckets[col.key]
          const active = dragOver === col.key
          return (
            <div
              key={col.key}
              data-testid={`pipeline-column-${col.key}`}
              data-column={col.key}
              role="listitem"
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(col.key)
              }}
              onDragLeave={(e) => {
                // Only clear when leaving the column itself, not a child.
                if (e.currentTarget === e.target) setDragOver(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/match-id')
                if (id) moveMatch(id, col.key)
                setDragOver(null)
              }}
              className={`
                flex-shrink-0 snap-start
                w-[88vw] sm:w-[300px] md:w-[280px]
                bg-white/[0.02] border rounded-xl p-2.5
                transition-colors
                ${active ? 'border-yellow-500/60 bg-yellow-500/5' : 'border-white/10'}
              `}
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-[10px] uppercase tracking-widest font-mono px-2 py-0.5 rounded border ${col.tone}`}
                  >
                    {col.label}
                  </span>
                  <span className="text-[10px] text-white/40 font-mono">
                    {items.length}
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-white/30 italic px-1 mb-2">
                {col.hint}
              </p>

              <div
                className="space-y-2 max-h-[calc(100vh-340px)] overflow-y-auto pr-1"
                data-testid={`pipeline-column-list-${col.key}`}
              >
                {items.length === 0 ? (
                  <div className="text-[10px] text-white/25 italic text-center py-6">
                    Empty
                  </div>
                ) : (
                  items.map((m) => (
                    <PipelineCard
                      key={m.id}
                      match={m}
                      lastMessage={lastMessages[m.id] ?? null}
                      onRankSaved={handleRankSaved}
                      onDragStart={() => {}}
                      onDragEnd={() => setDragOver(null)}
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
