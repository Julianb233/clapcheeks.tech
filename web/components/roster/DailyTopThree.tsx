'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ClapcheeksMatchRow, formatTimeAgo } from '@/lib/matches/types'

type Props = {
  matches: ClapcheeksMatchRow[]
}

/**
 * Phase J (AI-8338) daily Top-3: highest close_probability entries that
 * need outreach today (i.e. stale > 18h on a live stage).
 */
export default function DailyTopThree({ matches }: Props) {
  const top = useMemo(() => {
    const liveStages = new Set(['chatting', 'chatting_phone', 'date_proposed', 'date_booked', 'recurring', 'new_match'])
    const now = Date.now()
    return matches
      .filter((m) => liveStages.has((m.stage ?? 'new_match') as string))
      .filter((m) => {
        const last = m.last_activity_at ?? m.updated_at
        if (!last) return true
        return now - new Date(last).getTime() > 18 * 3600 * 1000
      })
      .sort((a, b) => {
        const ap = a.close_probability ?? (a.final_score ?? 0) / 100
        const bp = b.close_probability ?? (b.final_score ?? 0) / 100
        return bp - ap
      })
      .slice(0, 3)
  }, [matches])

  if (top.length === 0) {
    return (
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
        <h3 className="text-xs uppercase tracking-widest font-mono text-white/40 mb-2">
          Daily Top 3
        </h3>
        <p className="text-[11px] text-white/30 italic">
          No outreach candidates right now — all active matches replied recently.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-yellow-500/10 to-red-600/5 border border-yellow-500/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest font-mono text-yellow-300">
          Daily Top 3 — needs outreach
        </h3>
        <span className="text-[10px] text-white/40 font-mono">{top.length} queued</span>
      </div>
      <ul className="space-y-2">
        {top.map((m, i) => {
          const cp =
            typeof m.close_probability === 'number'
              ? Math.round(m.close_probability * 100)
              : null
          return (
            <li key={m.id}>
              <Link
                href={`/dashboard/matches/${m.id}`}
                className="flex items-center gap-3 bg-black/30 hover:bg-black/50 border border-white/5 rounded-lg p-2 transition-colors"
              >
                <span className="text-yellow-400 font-mono font-bold text-sm w-5">#{i + 1}</span>
                {m.photos_jsonb?.[0]?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.photos_jsonb[0].url}
                    alt={m.name ?? 'match'}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/50">
                    {(m.name ?? '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-white text-sm font-semibold truncate">{m.name ?? 'Unknown'}</span>
                    {m.age && <span className="text-white/60 text-xs">{m.age}</span>}
                  </div>
                  <div className="text-[10px] text-white/40 font-mono">
                    silent {formatTimeAgo(m.last_activity_at ?? m.updated_at)}
                  </div>
                </div>
                {cp !== null && (
                  <span className="font-mono text-xs font-bold text-yellow-400 bg-black/50 px-2 py-1 rounded border border-yellow-500/30">
                    {cp}%
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
