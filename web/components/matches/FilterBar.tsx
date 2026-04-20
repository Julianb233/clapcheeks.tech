'use client'

import {
  MatchListFilters,
  PLATFORM_OPTIONS,
  STATUS_OPTIONS,
} from '@/lib/matches/types'

type Props = {
  filters: MatchListFilters
  onChange: (next: MatchListFilters) => void
  total: number
  filteredCount: number
}

export default function FilterBar({ filters, onChange, total, filteredCount }: Props) {
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
      <div className="mt-3 flex items-center justify-between text-[11px] text-white/40 font-mono">
        <span>
          Showing <span className="text-white/70">{filteredCount}</span> of {total}
        </span>
        {(filters.platform !== 'all' ||
          filters.status !== 'all' ||
          filters.minScore > 0) && (
          <button
            type="button"
            onClick={() =>
              onChange({ platform: 'all', status: 'all', minScore: 0 })
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
