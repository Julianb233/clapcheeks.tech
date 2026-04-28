'use client'

import {
  AttributeFilterOption,
  MatchListFilters,
  PLATFORM_OPTIONS,
  STATUS_OPTIONS,
} from '@/lib/matches/types'

type Props = {
  filters: MatchListFilters
  onChange: (next: MatchListFilters) => void
  total: number
  filteredCount: number
  /** AI-8814: optional attribute tag pool. When non-empty, renders the attribute filter row. */
  attributeOptions?: AttributeFilterOption[]
}

const CATEGORY_TONE: Record<AttributeFilterOption['category'], string> = {
  allergy:   'bg-red-500/15 text-red-200 border-red-500/40',
  dietary:   'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
  schedule:  'bg-blue-500/15 text-blue-200 border-blue-500/30',
  lifestyle: 'bg-purple-500/15 text-purple-200 border-purple-500/30',
  logistics: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  comms:     'bg-teal-500/15 text-teal-200 border-teal-500/30',
}

function makeKey(category: string, value: string): string {
  return `${category}:${value}`
}

function toggleAttribute(filters: MatchListFilters, key: string): MatchListFilters {
  const present = filters.attributeValues.includes(key)
  return {
    ...filters,
    attributeValues: present
      ? filters.attributeValues.filter((k) => k !== key)
      : [...filters.attributeValues, key],
  }
}

export default function FilterBar({
  filters,
  onChange,
  total,
  filteredCount,
  attributeOptions,
}: Props) {
  const hasAttrs = !!attributeOptions && attributeOptions.length > 0
  const hasActive =
    filters.platform !== 'all' ||
    filters.status !== 'all' ||
    filters.minScore > 0 ||
    filters.attributeValues.length > 0

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 mb-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider font-mono text-white/40">
              Platform
            </label>
            <div className="flex gap-1 flex-wrap">
              {PLATFORM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...filters, platform: opt.value })}
                  className={`text-xs px-2.5 py-1 rounded border transition-all ${
                    filters.platform === opt.value
                      ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-[10px] uppercase tracking-wider font-mono text-white/40">
              Status
            </label>
            <div className="flex gap-1 flex-wrap">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...filters, status: opt.value })}
                  className={`text-xs px-2.5 py-1 rounded border transition-all ${
                    filters.status === opt.value
                      ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 min-w-[200px]">
          <label className="text-[10px] uppercase tracking-wider font-mono text-white/40 flex justify-between">
            <span>Min score</span>
            <span className="text-yellow-400 font-bold">{filters.minScore}</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={filters.minScore}
            onChange={(e) =>
              onChange({ ...filters, minScore: Number(e.target.value) })
            }
            className="w-full accent-yellow-500"
          />
        </div>
      </div>

      {hasAttrs && (
        <div className="mt-4 pt-3 border-t border-white/5 flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-mono text-white/40">
            Attributes
            <span className="ml-2 text-white/25 normal-case tracking-normal">
              {filters.attributeValues.length > 0
                ? `${filters.attributeValues.length} selected · AND-match`
                : 'AI-extracted tags · AND-match'}
            </span>
          </label>
          <div
            className="flex gap-1.5 flex-wrap"
            role="group"
            aria-label="Filter by attribute"
          >
            {attributeOptions!.map((opt) => {
              const key = makeKey(opt.category, opt.value)
              const selected = filters.attributeValues.includes(key)
              const tone = CATEGORY_TONE[opt.category]
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onChange(toggleAttribute(filters, key))}
                  aria-pressed={selected}
                  data-attr-key={key}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-all inline-flex items-center gap-1 ${
                    selected
                      ? `${tone} ring-1 ring-white/30`
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <span>{opt.value}</span>
                  <span className={`text-[9px] font-mono ${selected ? 'text-white/60' : 'text-white/30'}`}>
                    {opt.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-white/40 font-mono">
        <span>
          Showing <span className="text-white/70">{filteredCount}</span> of {total}
        </span>
        {hasActive && (
          <button
            type="button"
            onClick={() =>
              onChange({ platform: 'all', status: 'all', minScore: 0, attributeValues: [] })
            }
            className="text-yellow-400/80 hover:text-yellow-300 underline underline-offset-2"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
