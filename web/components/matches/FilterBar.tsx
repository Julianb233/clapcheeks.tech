'use client'

import {
  AttributeFilterOption,
  MatchListFilters,
  PLATFORM_OPTIONS,
  STATUS_OPTIONS,
} from '@/lib/matches/types'

export type FilterBarAccent = 'yellow' | 'pink'

type Props = {
  filters: MatchListFilters
  onChange: (next: MatchListFilters) => void
  total: number
  filteredCount: number
  /** AI-8814: optional attribute tag pool. When non-empty, renders the attribute filter row. */
  attributeOptions?: AttributeFilterOption[]
  /** AI-8873: visual accent. `yellow` = legacy /dashboard-demo. `pink` = canonical /matches. */
  accent?: FilterBarAccent
  /** Optional sticky positioning offset (px) when used inside a scrolling layout. */
  sticky?: boolean
}

const ACCENT: Record<
  FilterBarAccent,
  {
    activeBtn: string
    sliderAccent: string
    sliderValue: string
    resetText: string
    activeRing: string
    selectedDot: string
  }
> = {
  yellow: {
    activeBtn: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
    sliderAccent: 'accent-yellow-500',
    sliderValue: 'text-yellow-400',
    resetText: 'text-yellow-400/80 hover:text-yellow-300',
    activeRing: 'ring-yellow-500/40',
    selectedDot: 'bg-yellow-400',
  },
  pink: {
    activeBtn: 'bg-pink-500/20 text-pink-200 border-pink-500/40',
    sliderAccent: 'accent-pink-500',
    sliderValue: 'text-pink-300',
    resetText: 'text-pink-300/80 hover:text-pink-200',
    activeRing: 'ring-pink-500/40',
    selectedDot: 'bg-pink-400',
  },
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

function activeCount(filters: MatchListFilters): number {
  return (
    (filters.platform !== 'all' ? 1 : 0) +
    (filters.status !== 'all' ? 1 : 0) +
    (filters.minScore > 0 ? 1 : 0) +
    filters.attributeValues.length
  )
}

export default function FilterBar({
  filters,
  onChange,
  total,
  filteredCount,
  attributeOptions,
  accent = 'yellow',
  sticky = false,
}: Props) {
  const tone = ACCENT[accent]
  const hasAttrs = !!attributeOptions && attributeOptions.length > 0
  const nActive = activeCount(filters)
  const hasActive = nActive > 0

  return (
    <div
      className={`bg-black/40 backdrop-blur border border-white/10 rounded-xl p-3 sm:p-4 mb-6 ${
        sticky ? 'sticky top-2 z-20 shadow-xl shadow-black/40' : ''
      }`}
    >
      {/* Top row — pill groups. Each group horizontally scrolls on mobile. */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-5 flex-1 min-w-0">
          <FilterGroup
            label="Platform"
            options={PLATFORM_OPTIONS}
            selected={filters.platform}
            onSelect={(v) => onChange({ ...filters, platform: v as MatchListFilters['platform'] })}
            accent={tone}
          />
          <FilterGroup
            label="Status"
            options={STATUS_OPTIONS}
            selected={filters.status}
            onSelect={(v) => onChange({ ...filters, status: v as MatchListFilters['status'] })}
            accent={tone}
          />
        </div>

        <div className="flex flex-col gap-1 md:min-w-[200px] md:max-w-[260px]">
          <label className="text-[10px] uppercase tracking-wider font-mono text-white/40 flex justify-between">
            <span>Min score</span>
            <span className={`${tone.sliderValue} font-bold`}>{filters.minScore}</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={filters.minScore}
            onChange={(e) => onChange({ ...filters, minScore: Number(e.target.value) })}
            className={`w-full ${tone.sliderAccent}`}
            aria-label="Minimum match score"
          />
        </div>
      </div>

      {/* Attribute chips — only when extracted attributes exist. */}
      {hasAttrs && (
        <div className="mt-4 pt-3 border-t border-white/5 flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-mono text-white/40 flex items-center flex-wrap gap-x-2">
            <span>Attributes</span>
            <span className="text-white/25 normal-case tracking-normal">
              {filters.attributeValues.length > 0
                ? `${filters.attributeValues.length} selected · AND-match`
                : 'AI-extracted tags · click to filter'}
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
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onChange(toggleAttribute(filters, key))}
                  aria-pressed={selected}
                  data-attr-key={key}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-all inline-flex items-center gap-1 ${
                    selected
                      ? `${CATEGORY_TONE[opt.category]} ring-1 ${tone.activeRing}`
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <span>{opt.value}</span>
                  <span
                    className={`text-[9px] font-mono ${
                      selected ? 'text-white/60' : 'text-white/30'
                    }`}
                  >
                    {opt.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Footer — count + active badge + reset. aria-live for screen readers. */}
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-white/40 font-mono">
        <span aria-live="polite">
          Showing <span className="text-white/80 font-semibold">{filteredCount}</span> of {total}
          {hasActive && (
            <span
              className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 ${tone.sliderValue} normal-case tracking-normal`}
            >
              <span className={`w-1 h-1 rounded-full ${tone.selectedDot}`} aria-hidden="true" />
              {nActive} active
            </span>
          )}
        </span>
        {hasActive && (
          <button
            type="button"
            onClick={() =>
              onChange({ platform: 'all', status: 'all', minScore: 0, attributeValues: [] })
            }
            className={`${tone.resetText} underline underline-offset-2`}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

// --- Subcomponent: a single filter pill group with mobile horizontal scroll ---

type FilterGroupProps = {
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  selected: string
  onSelect: (value: string) => void
  accent: (typeof ACCENT)[FilterBarAccent]
}

function FilterGroup({ label, options, selected, onSelect, accent }: FilterGroupProps) {
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <label className="text-[10px] uppercase tracking-wider font-mono text-white/40">
        {label}
      </label>
      <div
        className="flex gap-1 overflow-x-auto md:flex-wrap pb-1 -mb-1 scrollbar-thin"
        role="radiogroup"
        aria-label={label}
      >
        {options.map((opt) => {
          const isActive = selected === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              role="radio"
              aria-checked={isActive}
              className={`shrink-0 text-xs px-2.5 py-1 rounded-md border transition-all whitespace-nowrap ${
                isActive
                  ? accent.activeBtn
                  : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
