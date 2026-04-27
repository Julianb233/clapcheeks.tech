'use client'

import { type Filters, type SortKey, type PlatformFilter } from './types'

type Props = {
  filters: Filters
  sort: SortKey
  onFilters: (next: Filters) => void
  onSort: (next: SortKey) => void
  totalCount: number
  visibleCount: number
}

const PLATFORMS: { value: PlatformFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tinder', label: 'Tinder' },
  { value: 'hinge', label: 'Hinge' },
  { value: 'bumble', label: 'Bumble' },
  { value: 'offline', label: 'Offline' },
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'close_probability', label: 'Close prob' },
  { value: 'julian_rank', label: 'Rank' },
  { value: 'health', label: 'Health' },
  { value: 'recent', label: 'Recent' },
]

export default function PipelineFilters({
  filters,
  sort,
  onFilters,
  onSort,
  totalCount,
  visibleCount,
}: Props) {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 space-y-3">
      {/* Search row */}
      <label className="block">
        <span className="sr-only">Search matches</span>
        <input
          type="search"
          inputMode="search"
          placeholder="Search name, bio, IG…"
          value={filters.search}
          onChange={(e) => onFilters({ ...filters, search: e.target.value })}
          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder-white/30 focus:outline-none focus:border-yellow-500/40"
          data-testid="pipeline-search"
        />
      </label>

      {/* Platform pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1">
        {PLATFORMS.map((p) => {
          const active = filters.platform === p.value
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onFilters({ ...filters, platform: p.value })}
              className={`
                flex-shrink-0 text-[10px] uppercase tracking-wider font-mono
                px-2.5 py-1 rounded-full border transition-colors
                ${active
                  ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
                  : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80'}
              `}
              data-testid={`platform-${p.value}`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Toggles + sort */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Toggle
            label="Photos"
            checked={filters.hasPhotos}
            onChange={(v) => onFilters({ ...filters, hasPhotos: v })}
          />
          <Toggle
            label="IG"
            checked={filters.hasInstagram}
            onChange={(v) => onFilters({ ...filters, hasInstagram: v })}
          />
          <Toggle
            label="Cold"
            checked={filters.showCold}
            onChange={(v) => onFilters({ ...filters, showCold: v })}
            hint="show ghosted/faded/archived"
          />
        </div>

        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono text-white/50">
          Sort
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white"
            data-testid="pipeline-sort"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="text-[10px] text-white/30 font-mono">
        Showing {visibleCount} of {totalCount}
      </div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label
      className={`
        inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider
        font-mono px-2 py-1 rounded border cursor-pointer transition-colors
        ${checked
          ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'
          : 'border-white/10 bg-white/[0.02] text-white/50 hover:text-white/80'}
      `}
      title={hint}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`w-2 h-2 rounded-full ${checked ? 'bg-yellow-400' : 'bg-white/20'}`}
        aria-hidden
      />
      {label}
    </label>
  )
}
