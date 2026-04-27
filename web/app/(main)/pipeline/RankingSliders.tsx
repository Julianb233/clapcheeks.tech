'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  RANK_DIMENSIONS,
  type RankDimension,
  type Rankings,
  computeOverallRank,
} from './types'

type Props = {
  matchId: string
  initial: Rankings
  onSaved: (rankings: Rankings, overall: number | null) => void
}

/**
 * Multi-dimension ranking sliders. Saves into match_intel.rankings as JSONB
 * and writes the computed overall score back to julian_rank so existing
 * sort/filter UIs (RosterCard star bar, /matches grid) keep working.
 */
export default function RankingSliders({ matchId, initial, onSaved }: Props) {
  const [vals, setVals] = useState<Rankings>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const overall = computeOverallRank(vals)

  function update(dim: RankDimension, v: number) {
    setVals((prev) => ({ ...prev, [dim]: v }))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      // Pull current intel so we don't blow away other fields.
      const { data: row } = await supabase
        .from('clapcheeks_matches')
        .select('match_intel')
        .eq('id', matchId)
        .single()

      const prevIntel =
        row && typeof row.match_intel === 'object' && row.match_intel !== null
          ? (row.match_intel as Record<string, unknown>)
          : {}
      const nextIntel = { ...prevIntel, rankings: vals }

      const overallScore = computeOverallRank(vals)
      const { error: updErr } = await supabase
        .from('clapcheeks_matches')
        .update({
          match_intel: nextIntel,
          julian_rank: overallScore,
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchId)

      if (updErr) {
        setError(updErr.message)
      } else {
        setDirty(false)
        onSaved(vals, overallScore)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {RANK_DIMENSIONS.map((dim) => {
        const v = vals[dim.key] ?? 0
        return (
          <div key={dim.key} className="flex items-center gap-2">
            <label
              htmlFor={`rank-${matchId}-${dim.key}`}
              className="text-[10px] uppercase tracking-wider text-white/60 font-mono w-20 flex-shrink-0"
            >
              {dim.label}
            </label>
            <input
              id={`rank-${matchId}-${dim.key}`}
              type="range"
              min={0}
              max={10}
              step={1}
              value={v}
              onChange={(e) => update(dim.key, Number(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 h-1 accent-yellow-400 cursor-pointer"
              aria-label={`${dim.label} rating`}
              data-testid={`slider-${dim.key}`}
            />
            <span className="text-[11px] font-mono w-8 text-right text-yellow-400">
              {v}
            </span>
          </div>
        )
      })}

      <div className="flex items-center justify-between pt-2 border-t border-white/10">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-white/40 font-mono">
            Overall
          </span>
          <span className="text-base font-mono font-bold text-yellow-400">
            {overall ?? '—'}
            <span className="text-[10px] text-white/40">/10</span>
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            save()
          }}
          disabled={!dirty || saving}
          className={`
            text-[10px] uppercase tracking-wider font-mono px-2.5 py-1 rounded
            transition-colors
            ${dirty && !saving
              ? 'bg-yellow-500 text-black hover:bg-yellow-400'
              : 'bg-white/10 text-white/40 cursor-not-allowed'}
          `}
          data-testid="save-rankings"
        >
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      {error && (
        <div className="text-[10px] text-rose-400 font-mono" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
