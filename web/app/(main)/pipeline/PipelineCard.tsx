'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { ClapcheeksMatchRow } from '@/lib/matches/types'
import { PLATFORM_COLORS, formatTimeAgo } from '@/lib/matches/types'
import {
  RANK_DIMENSIONS,
  type Rankings,
  computeOverallRank,
  readRankings,
} from './types'
import RankingSliders from './RankingSliders'

type Props = {
  match: ClapcheeksMatchRow
  lastMessage?: string | null
  onRankSaved: (matchId: string, rankings: Rankings, overall: number | null) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
}

/**
 * Pipeline card. Compact summary by default; click to expand inline showing
 * full match data + multi-dim ranking sliders. Designed for iPhone 14/15
 * (390-430px viewport).
 */
export default function PipelineCard({
  match,
  lastMessage,
  onRankSaved,
  onDragStart,
  onDragEnd,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const photo = match.photos_jsonb?.[0]?.url ?? null
  const initials = (match.name ?? '?').slice(0, 1).toUpperCase()
  const rankings = readRankings(match.match_intel)
  const overall = computeOverallRank(rankings) ?? match.julian_rank ?? null
  const health = typeof match.health_score === 'number' ? match.health_score : null
  const closeProb =
    typeof match.close_probability === 'number'
      ? Math.round(match.close_probability * 100)
      : null

  const healthTone =
    health === null ? 'bg-white/20' :
    health >= 75 ? 'bg-emerald-400' :
    health >= 50 ? 'bg-yellow-400' :
    health >= 25 ? 'bg-amber-500' :
                    'bg-rose-500'

  return (
    <div
      data-testid="pipeline-card"
      data-match-id={match.id}
      draggable={!expanded}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/match-id', match.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(match.id)
      }}
      onDragEnd={onDragEnd}
      className={`
        bg-white/[0.04] border border-white/10 rounded-lg overflow-hidden
        hover:border-yellow-500/40 transition-all
        ${expanded ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
      `}
    >
      {/* ─── Compact header — always visible ─────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${match.name ?? 'match'} card`}
      >
        <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-zinc-800 to-zinc-900 overflow-hidden">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={match.name ?? 'Match'}
              className="w-full h-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30 text-3xl font-bold">
              {initials}
            </div>
          )}
          <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
            <span
              className={`text-[9px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded border ${PLATFORM_COLORS[match.platform]}`}
            >
              {match.platform}
            </span>
            {closeProb !== null && (
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/70 border border-yellow-500/40 text-yellow-400">
                {closeProb}%
              </span>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-white font-semibold text-sm truncate">
                {match.name ?? 'Unknown'}
              </span>
              {match.age && <span className="text-white/70 text-xs">{match.age}</span>}
            </div>
          </div>
        </div>

        {/* Health bar */}
        <div className="px-2.5 pt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] uppercase tracking-wider text-white/40 font-mono">
              Health
            </span>
            <span className="text-[10px] font-mono text-white/70">{health ?? '—'}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full ${healthTone} transition-all`}
              style={{ width: `${health ?? 0}%` }}
              aria-label={`Health score ${health ?? 'unknown'}`}
            />
          </div>
        </div>

        {/* Star row + meta */}
        <div className="px-2.5 pt-2 flex items-center justify-between">
          <StarRow rank={overall} />
          <span className="text-[9px] text-white/40 font-mono">
            {formatTimeAgo(match.last_activity_at ?? match.updated_at)}
          </span>
        </div>

        <div className="px-2.5 pt-1.5 pb-2.5">
          {lastMessage ? (
            <p className="text-[11px] text-white/50 line-clamp-2 leading-snug">
              {lastMessage}
            </p>
          ) : (
            <p className="text-[11px] text-white/25 italic">No conversation yet</p>
          )}
        </div>
      </button>

      {/* ─── Expanded panel — full data + sliders ─────────────── */}
      {expanded && (
        <div className="border-t border-white/10 bg-black/20 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
              Profile
            </div>
            <Link
              href={`/matches/${match.id}`}
              className="text-[10px] uppercase tracking-widest text-yellow-400 hover:text-yellow-300 font-mono"
            >
              Full chart →
            </Link>
          </div>

          <ProfileRow label="Zodiac" value={match.zodiac} />
          <ProfileRow label="Job" value={match.job} />
          <ProfileRow label="School" value={match.school} />
          {match.instagram_handle && (
            <ProfileRow
              label="Instagram"
              value={`@${match.instagram_handle.replace(/^@/, '')}`}
            />
          )}
          {match.bio && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-white/40 font-mono mb-1">
                Bio
              </div>
              <p className="text-[12px] text-white/70 leading-snug">{match.bio}</p>
            </div>
          )}

          {/* Multi-dimension scores */}
          <div className="pt-2 border-t border-white/10">
            <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono mb-2">
              Ranking
            </div>
            <RankingSliders
              matchId={match.id}
              initial={rankings}
              onSaved={(r, overallScore) => onRankSaved(match.id, r, overallScore)}
            />
          </div>

          {/* Quick metrics */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/10">
            <Metric label="Close" value={closeProb !== null ? `${closeProb}%` : '—'} />
            <Metric
              label="Msgs"
              value={String(match.messages_total ?? 0)}
              hint={
                match.messages_7d !== null && match.messages_7d !== undefined
                  ? `${match.messages_7d} this week`
                  : undefined
              }
            />
            <Metric
              label="Flakes"
              value={String(match.flake_count ?? 0)}
              tone={(match.flake_count ?? 0) > 0 ? 'warn' : undefined}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function StarRow({ rank }: { rank: number | null }) {
  // 5 stars, each 0-2 (half/full). Range: 0-10.
  const r = rank ?? 0
  return (
    <div
      className="flex items-center gap-0.5"
      aria-label={`Overall rank ${rank ?? 'unset'} of 10`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const filled = r >= (i + 1) * 2
        const half = !filled && r >= i * 2 + 1
        return (
          <span
            key={i}
            className={`text-[10px] leading-none ${
              filled ? 'text-yellow-400' : half ? 'text-yellow-400/60' : 'text-white/20'
            }`}
          >
            ★
          </span>
        )
      })}
      {rank !== null && (
        <span className="ml-1 text-[9px] font-mono text-white/40">{rank}/10</span>
      )}
    </div>
  )
}

function ProfileRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="text-[9px] uppercase tracking-wider text-white/40 font-mono w-16 flex-shrink-0">
        {label}
      </span>
      <span className="text-white/80 truncate">{value}</span>
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'warn'
}) {
  const valueClass =
    tone === 'warn' ? 'text-amber-400' : 'text-white'
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded p-2">
      <div className="text-[9px] uppercase tracking-wider text-white/40 font-mono mb-0.5">
        {label}
      </div>
      <div className={`text-sm font-mono font-bold ${valueClass}`}>{value}</div>
      {hint && <div className="text-[9px] text-white/40 mt-0.5">{hint}</div>}
    </div>
  )
}

// re-export RankingSliders props for callers (kept inline for type clarity)
export type { Rankings }
