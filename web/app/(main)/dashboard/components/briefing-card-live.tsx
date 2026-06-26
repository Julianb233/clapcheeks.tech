'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'

/**
 * AI-10022 — realtime briefing tiles.
 *
 * The parent `BriefingCard` is a server component that fetches an initial
 * snapshot so the first paint is instant (no loading flash). This client
 * child then subscribes to the SAME Convex queries via `useQuery`, so the
 * counts update live the moment a draft is approved, a match goes stale, or
 * a date is booked — without a page reload. That realtime behaviour is the
 * whole reason the product moved to Convex; the old server-only card froze
 * at navigation and showed stale "no drafts to approve" counts.
 *
 * While the live subscription is resolving (`useQuery` returns `undefined`),
 * we fall back to the server-provided initial values. Each query also
 * degrades gracefully: an undefined/empty result never crashes the tile.
 */

// Keep in sync with the server component. The roster pipeline treats these as
// "still warm" stages — anything else (ghosted, archived, hooked_up, etc.) is
// intentionally excluded so we only surface stale convos worth salvaging.
const ACTIVE_STAGES = new Set([
  'opened',
  'replying',
  'chatting',
  'chatting_phone',
  'conversing',
  'date_proposed',
  'new',
])

interface BriefingCardLiveProps {
  fleetUserId: string
  initialApprovals: number
  initialStale: number
  initialDates: number
}

export default function BriefingCardLive({
  fleetUserId,
  initialApprovals,
  initialStale,
  initialDates,
}: BriefingCardLiveProps) {
  // Reactive Convex subscriptions. `useQuery` returns `undefined` until the
  // first server response, then re-renders on every subsequent change.
  const liveApprovals = useQuery(api.queues.countPendingApprovalsForUser, {
    user_id: fleetUserId,
  })
  const liveMatches = useQuery(api.matches.listForUser, { user_id: fleetUserId })

  const fortyEightHoursAgoMs = Date.now() - 48 * 60 * 60 * 1000

  const approvals =
    typeof liveApprovals === 'number' ? liveApprovals : initialApprovals

  let stale = initialStale
  let dates = initialDates
  if (Array.isArray(liveMatches)) {
    const matchRows = liveMatches as Array<Record<string, unknown>>
    stale = matchRows.filter((m) => {
      const stage =
        (m.stage as string | undefined) ?? (m.status as string | undefined) ?? ''
      const last =
        (m.last_activity_at as number | undefined) ??
        (m.updated_at as number | undefined) ??
        0
      return ACTIVE_STAGES.has(stage) && last > 0 && last < fortyEightHoursAgoMs
    }).length
    dates = matchRows.filter((m) => {
      const stage =
        (m.stage as string | undefined) ?? (m.status as string | undefined) ?? ''
      return stage === 'date_proposed' || stage === 'date_booked'
    }).length
  }

  // True once both live subscriptions have produced at least one response.
  const isLive = typeof liveApprovals === 'number' && Array.isArray(liveMatches)

  const cards: Array<{
    label: string
    count: number
    href: string
    redAt?: number
  }> = [
    { label: 'Drafts to Approve', count: approvals, href: '/autonomy', redAt: 5 },
    { label: 'Stale Convos', count: stale, href: '/matches?filter=stale', redAt: 5 },
    { label: 'Dates This Week', count: dates, href: '/scheduled' },
  ]

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white/60 text-xs uppercase tracking-widest font-mono">
          Today&apos;s Briefing
        </h2>
        <span className="text-white/30 text-[10px] font-mono flex items-center gap-1.5">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              isLive ? 'bg-green-400 animate-pulse' : 'bg-white/30'
            }`}
            title={isLive ? 'Realtime — synced with Convex' : 'Connecting…'}
          />
          {isLive ? 'live' : 'syncing'}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => (
          <BriefingTile
            key={c.label}
            label={c.label}
            count={c.count}
            href={c.href}
            redAt={c.redAt}
          />
        ))}
      </div>
    </div>
  )
}

function BriefingTile({
  label,
  count,
  href,
  redAt,
}: {
  label: string
  count: number
  href: string
  redAt?: number
}) {
  // Tone matches sidebar badge urgency model so visual language is consistent.
  let tone = 'border-white/10 hover:border-white/20'
  let valueTone = 'text-white/40'
  if (count > 0) {
    if (redAt !== undefined && count > redAt) {
      tone = 'border-red-500/40 hover:border-red-500/70 bg-red-500/[0.04]'
      valueTone = 'text-red-300'
    } else {
      tone = 'border-amber-400/40 hover:border-amber-400/70 bg-amber-400/[0.04]'
      valueTone = 'text-amber-200'
    }
  }

  return (
    <Link
      href={href}
      className={`group bg-white/5 border ${tone} rounded-xl p-4 transition-all flex flex-col gap-1 relative`}
    >
      <div className="flex items-baseline justify-between">
        <div className={`text-3xl font-bold tabular-nums ${valueTone}`}>{count}</div>
        <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-white/70 transition-colors" />
      </div>
      <div className="text-white/60 text-xs leading-tight">{label}</div>
    </Link>
  )
}
