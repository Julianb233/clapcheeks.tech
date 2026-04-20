'use client'

import { ClapcheeksMatchRow } from '@/lib/matches/types'

type Props = {
  match: ClapcheeksMatchRow
}

function ScoreBar({
  label,
  value,
  color,
}: {
  label: string
  value: number | null
  color: string
}) {
  if (value === null || value === undefined) {
    return (
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-xs text-white/60 uppercase tracking-wider font-mono">{label}</span>
          <span className="text-xs text-white/30 font-mono">pending</span>
        </div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-white/10 w-0" />
        </div>
      </div>
    )
  }
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-white/60 uppercase tracking-wider font-mono">{label}</span>
        <span className="text-xs text-white font-mono font-bold">{Math.round(pct)}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function ScoringPanel({ match }: Props) {
  const hasScore = typeof match.final_score === 'number' && !Number.isNaN(match.final_score)
  const score = hasScore ? Math.round(match.final_score!) : null

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
      <h3 className="text-xs uppercase tracking-widest font-mono text-white/40 mb-4">Scoring</h3>
      <div className="flex items-baseline gap-2 mb-1">
        {score !== null ? (
          <>
            <span className="font-display text-5xl gold-text font-bold">{score}</span>
            <span className="text-white/40 text-sm font-mono">/ 100</span>
          </>
        ) : (
          <>
            <span className="font-display text-5xl text-white/20 font-bold">--</span>
            <span className="text-white/30 text-xs font-mono">scoring pending</span>
          </>
        )}
      </div>
      {match.scoring_reason ? (
        <p className="text-sm text-white/70 mt-2 mb-4 leading-relaxed">
          {match.scoring_reason}
        </p>
      ) : (
        <p className="text-xs text-white/30 italic mt-2 mb-4">
          Scoring explanation will appear here once Phase A + the scoring engine populate it.
        </p>
      )}
      <div className="space-y-3">
        <ScoreBar label="Location" value={match.location_score} color="bg-blue-400" />
        <ScoreBar label="Criteria" value={match.criteria_score} color="bg-emerald-400" />
      </div>
    </div>
  )
}
