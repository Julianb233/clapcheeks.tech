'use client'

import Link from 'next/link'
import type { ClapcheeksMatchRow } from '@/lib/matches/types'
import { computeOverallRank, readRankings, RANK_DIMENSIONS } from './types'

type Props = {
  matches: ClapcheeksMatchRow[]
}

type Row = {
  match: ClapcheeksMatchRow
  overall: number
  dims: ReturnType<typeof readRankings>
}

/**
 * Top-10 leaderboard by overall multi-dimension score. Falls back to
 * julian_rank for rows that haven't been multi-dim ranked yet.
 */
export default function Leaderboard({ matches }: Props) {
  const ranked: Row[] = matches
    .map((m) => {
      const dims = readRankings(m.match_intel)
      const computed = computeOverallRank(dims)
      const overall = computed ?? m.julian_rank ?? 0
      return overall > 0 ? { match: m, overall, dims } : null
    })
    .filter((x): x is Row => x !== null)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 10)

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-widest font-mono text-white/60">
          Leaderboard
        </h2>
        <span className="text-[10px] text-white/30 font-mono">top 10</span>
      </div>

      {ranked.length === 0 ? (
        <p className="text-[11px] text-white/30 italic text-center py-4">
          No rankings yet — expand a card and use the sliders.
        </p>
      ) : (
        <ol className="space-y-1.5" data-testid="leaderboard">
          {ranked.map((row, idx) => {
            const photo = row.match.photos_jsonb?.[0]?.url ?? null
            const initials = (row.match.name ?? '?').slice(0, 1).toUpperCase()
            const dimChips = RANK_DIMENSIONS.map((d) => row.dims[d.key])
              .filter((v): v is number => typeof v === 'number')
              .slice(0, 3)
            return (
              <li
                key={row.match.id}
                data-testid="leaderboard-row"
                className="flex items-center gap-2 group"
              >
                <span className="text-[10px] font-mono w-4 text-right text-white/40 group-hover:text-yellow-400">
                  {idx + 1}
                </span>
                <div className="w-7 h-7 rounded-md overflow-hidden bg-zinc-800 flex-shrink-0">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo}
                      alt={row.match.name ?? 'Match'}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-white/40 font-bold">
                      {initials}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/matches/${row.match.id}`}
                    className="text-xs text-white/90 hover:text-yellow-300 truncate block"
                  >
                    {row.match.name ?? 'Unknown'}
                    {row.match.age && (
                      <span className="text-white/40"> {row.match.age}</span>
                    )}
                  </Link>
                  <div className="text-[9px] text-white/30 font-mono uppercase">
                    {row.match.platform}
                    {row.match.zodiac ? ` · ${row.match.zodiac}` : ''}
                  </div>
                </div>
                {dimChips.length > 0 && (
                  <div className="hidden md:flex items-center gap-0.5">
                    {dimChips.map((v, i) => (
                      <span
                        key={i}
                        className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/50"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                )}
                <span className="text-sm font-mono font-bold text-yellow-400 w-7 text-right">
                  {row.overall}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
