'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X, ArrowDownUp } from 'lucide-react'
import MatchCard from '@/components/matches/MatchCard'
import { ClapcheeksMatchRow } from '@/lib/matches/types'

// Extend the canonical row type with columns that exist in clapcheeks_matches
// but aren't in the shared type yet (distance_miles, match_name, stage,
// health_score). Kept optional so unaffected columns still type-check.
export type MatchGridRow = ClapcheeksMatchRow & {
  match_name?: string | null
  distance_miles?: number | null
  stage?: string | null
  health_score?: number | null
}

type LastMessageMap = Record<string, string | null>

type Props = {
  matches: MatchGridRow[]
  lastMessages: LastMessageMap
}

type SortKey =
  | 'julian_rank'
  | 'newest'
  | 'oldest'
  | 'health_score'
  | 'final_score'
  | 'name'
  | 'distance'
  | 'age'

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'julian_rank', label: 'Julian Rank' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'health_score', label: 'Health score' },
  { value: 'final_score', label: 'Final score' },
  { value: 'name', label: 'Name' },
  { value: 'distance', label: 'Distance' },
  { value: 'age', label: 'Age' },
]

function isArchived(m: MatchGridRow): boolean {
  const status = (m.status as unknown as string) ?? ''
  const stage = (m.stage as unknown as string) ?? ''
  return status === 'archived' || stage === 'archived' || stage === 'archived_cluster_dupe'
}

function displayName(m: MatchGridRow): string {
  return (m.match_name ?? m.name ?? '').toString()
}

// Nulls-last numeric sort comparator.
// dir='desc' => larger first; dir='asc' => smaller first.
function cmpNumNullsLast(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 'asc' | 'desc',
): number {
  const an = typeof a === 'number' && !Number.isNaN(a)
  const bn = typeof b === 'number' && !Number.isNaN(b)
  if (!an && !bn) return 0
  if (!an) return 1
  if (!bn) return -1
  if (dir === 'desc') return (b as number) - (a as number)
  return (a as number) - (b as number)
}

function cmpStringAsc(a: string, b: string): number {
  const ae = a.trim().length === 0
  const be = b.trim().length === 0
  if (ae && be) return 0
  if (ae) return 1
  if (be) return -1
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function cmpDate(a: string | null | undefined, b: string | null | undefined, dir: 'asc' | 'desc'): number {
  const at = a ? new Date(a).getTime() : NaN
  const bt = b ? new Date(b).getTime() : NaN
  const av = Number.isFinite(at)
  const bv = Number.isFinite(bt)
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  if (dir === 'desc') return bt - at
  return at - bt
}

export default function MatchesGrid({ matches, lastMessages }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set())
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('julian_rank')
  const [showArchived, setShowArchived] = useState(false)

  // Debounce search input 150ms.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 150)
    return () => clearTimeout(t)
  }, [searchInput])

  // Derive platform + stage option sets from the dataset.
  const platformOptions = useMemo(() => {
    const set = new Set<string>()
    for (const m of matches) {
      if (m.platform) set.add(String(m.platform))
    }
    return Array.from(set).sort()
  }, [matches])

  const stageOptions = useMemo(() => {
    const set = new Set<string>()
    for (const m of matches) {
      const s = (m.stage as unknown as string) ?? ''
      if (s) set.add(s)
    }
    return Array.from(set).sort()
  }, [matches])

  const total = matches.length

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()

    const filtered = matches.filter((m) => {
      if (!showArchived && isArchived(m)) return false

      if (selectedPlatforms.size > 0 && !selectedPlatforms.has(String(m.platform ?? ''))) {
        return false
      }
      if (selectedStages.size > 0) {
        const s = (m.stage as unknown as string) ?? ''
        if (!selectedStages.has(s)) return false
      }
      if (q.length > 0) {
        const haystack = [
          m.name ?? '',
          m.match_name ?? '',
          m.bio ?? '',
        ]
          .join(' \n ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    const sorted = filtered.slice()
    switch (sortKey) {
      case 'julian_rank':
        sorted.sort((a, b) => cmpNumNullsLast(a.julian_rank, b.julian_rank, 'desc'))
        break
      case 'newest':
        sorted.sort((a, b) => cmpDate(a.created_at, b.created_at, 'desc'))
        break
      case 'oldest':
        sorted.sort((a, b) => cmpDate(a.created_at, b.created_at, 'asc'))
        break
      case 'health_score':
        sorted.sort((a, b) => cmpNumNullsLast(a.health_score ?? null, b.health_score ?? null, 'desc'))
        break
      case 'final_score':
        sorted.sort((a, b) => cmpNumNullsLast(a.final_score, b.final_score, 'desc'))
        break
      case 'name':
        sorted.sort((a, b) => cmpStringAsc(displayName(a), displayName(b)))
        break
      case 'distance':
        sorted.sort((a, b) =>
          cmpNumNullsLast(a.distance_miles ?? null, b.distance_miles ?? null, 'asc'),
        )
        break
      case 'age':
        sorted.sort((a, b) => cmpNumNullsLast(a.age, b.age, 'asc'))
        break
    }
    return sorted
  }, [matches, search, selectedPlatforms, selectedStages, sortKey, showArchived])

  const filtersActive =
    search.trim().length > 0 ||
    selectedPlatforms.size > 0 ||
    selectedStages.size > 0 ||
    sortKey !== 'julian_rank' ||
    showArchived

  function togglePlatform(value: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function toggleStage(value: string) {
    setSelectedStages((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function clearAll() {
    setSearchInput('')
    setSearch('')
    setSelectedPlatforms(new Set())
    setSelectedStages(new Set())
    setSortKey('julian_rank')
    setShowArchived(false)
  }

  const pillBase =
    'text-xs px-2.5 py-1 rounded border transition-all cursor-pointer select-none'
  const pillIdle =
    'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
  const pillActive = 'bg-pink-500/20 text-pink-300 border-pink-500/40'

  return (
    <div>
      {/* Sticky controls bar */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-black/80 backdrop-blur border-b border-white/10 mb-6">
        <div className="max-w-7xl mx-auto space-y-3">
          {/* Row 1: search + sort + archived toggle + counts */}
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
                size={14}
                aria-hidden
              />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search name or bio..."
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-9 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-pink-500/40 focus:bg-white/10 transition-all"
                aria-label="Search matches"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 p-1"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-mono text-white/40">
                <ArrowDownUp size={12} />
                Sort
              </label>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white/80 focus:outline-none focus:border-pink-500/40 hover:bg-white/10 transition-all"
                aria-label="Sort matches by"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-zinc-900">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="accent-pink-500"
              />
              Show archived
            </label>

            <div className="text-[11px] font-mono text-white/40 md:ml-auto whitespace-nowrap">
              <span className="text-white/80">{visible.length}</span>
              {' of '}
              {total} matches
            </div>
          </div>

          {/* Row 2: platform pills */}
          {platformOptions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider font-mono text-white/40 mr-1">
                Platform
              </span>
              {platformOptions.map((value) => {
                const active = selectedPlatforms.has(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => togglePlatform(value)}
                    className={`${pillBase} ${active ? pillActive : pillIdle}`}
                    aria-pressed={active}
                  >
                    {value}
                  </button>
                )
              })}
              {selectedPlatforms.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedPlatforms(new Set())}
                  className="text-[11px] text-pink-400/80 hover:text-pink-300 underline underline-offset-2"
                >
                  clear
                </button>
              )}
            </div>
          )}

          {/* Row 3: stage pills */}
          {stageOptions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider font-mono text-white/40 mr-1">
                Stage
              </span>
              {stageOptions.map((value) => {
                const active = selectedStages.has(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleStage(value)}
                    className={`${pillBase} ${active ? pillActive : pillIdle}`}
                    aria-pressed={active}
                  >
                    {value.replace(/_/g, ' ')}
                  </button>
                )
              })}
              {selectedStages.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedStages(new Set())}
                  className="text-[11px] text-pink-400/80 hover:text-pink-300 underline underline-offset-2"
                >
                  clear
                </button>
              )}
            </div>
          )}

          {filtersActive && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] text-pink-400/80 hover:text-pink-300 underline underline-offset-2"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Grid / empty state */}
      {visible.length === 0 ? (
        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-10 text-center">
          <p className="text-white/70 text-sm mb-3">No matches match your filters</p>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-pink-500/20 border border-pink-500/40 text-pink-300 text-xs font-semibold hover:bg-pink-500/30 transition-all"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visible.map((m) => (
            <MatchCard key={m.id} match={m} lastMessage={lastMessages[m.id]} />
          ))}
        </div>
      )}
    </div>
  )
}
