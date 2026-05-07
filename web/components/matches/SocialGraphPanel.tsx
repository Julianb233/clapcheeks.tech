'use client'

import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'

type MutualFriend = {
  name?: string
  handle?: string
  source?: string
  confidence?: number
}

type Props = {
  matchId: string
  mutualFriendsCount?: number | null
  mutualFriendsList?: MutualFriend[] | null
  socialRiskBand?: 'safe' | 'watch' | 'high_risk' | 'auto_flag' | null
  friendClusterId?: string | null
  clusterRank?: number | null
  socialGraphConfidence?: number | null
  socialGraphSources?: string[] | null
  initialProceedOverride?: boolean
}

const BAND_COLORS: Record<string, string> = {
  safe:      'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  watch:     'bg-amber-500/10 border-amber-500/30 text-amber-300',
  high_risk: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
  auto_flag: 'bg-red-500/10 border-red-500/30 text-red-300',
}

const BAND_LABEL: Record<string, string> = {
  safe:      'Safe',
  watch:     'Watch',
  high_risk: 'High risk',
  auto_flag: 'Auto flag',
}

const SOURCE_LABEL: Record<string, string> = {
  hinge_native:   'Hinge',
  ig_overlap:     'Instagram',
  phone_contacts: 'Contacts',
}

export default function SocialGraphPanel({
  matchId,
  mutualFriendsCount,
  mutualFriendsList,
  socialRiskBand,
  friendClusterId,
  clusterRank,
  socialGraphConfidence,
  socialGraphSources,
  initialProceedOverride = false,
}: Props) {
  const [proceed, setProceed] = useState(initialProceedOverride)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const count = mutualFriendsCount ?? 0
  const band = socialRiskBand ?? 'safe'
  const bandColors = BAND_COLORS[band] ?? BAND_COLORS.safe
  const bandLabel = BAND_LABEL[band] ?? 'Safe'
  const isSuppressed = (clusterRank ?? 1) > 1
  const isLocked = clusterRank === 99

  // AI-9534 — read the row from Convex (resolveByAnyId handles both Convex
  // _id and legacy Supabase UUIDs in the URL) and patch via Convex too.
  const row = useQuery(
    api.matches.resolveByAnyId,
    matchId ? { id: matchId } : 'skip',
  ) as (Record<string, unknown> & { _id?: Id<'matches'>; match_intel?: Record<string, unknown> | null }) | null | undefined
  const patch = useMutation(api.matches.patch)

  async function toggleProceed(next: boolean) {
    setProceed(next)
    setSaving(true)
    setSaveError(null)
    try {
      if (!row?._id) {
        setSaveError('match not loaded')
        return
      }
      const current: Record<string, unknown> =
        row.match_intel && typeof row.match_intel === 'object'
          ? { ...(row.match_intel as Record<string, unknown>) }
          : {}
      current.proceed_despite_cluster_risk = next
      current.override_logged_at = new Date().toISOString()
      await patch({ id: row._id, match_intel: current })
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest font-mono text-white/40">
          Social graph
        </h3>
        <span
          className={`text-[10px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded border ${bandColors}`}
        >
          {bandLabel}
        </span>
      </div>

      {/* Mutual friend count */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-display text-5xl text-white font-bold">
          {count}
        </span>
        <span className="text-white/40 text-sm font-mono">
          mutual {count === 1 ? 'friend' : 'friends'}
        </span>
      </div>

      {typeof socialGraphConfidence === 'number' && count > 0 && (
        <p className="text-[11px] text-white/40 font-mono mt-1 mb-3">
          confidence {Math.round(socialGraphConfidence * 100)}%
          {socialGraphSources && socialGraphSources.length > 0 && (
            <>
              {' via '}
              {socialGraphSources
                .map((s) => SOURCE_LABEL[s] ?? s)
                .join(', ')}
            </>
          )}
        </p>
      )}

      {/* Mutual list */}
      {mutualFriendsList && mutualFriendsList.length > 0 && (
        <div className="mt-3 mb-3">
          <div className="text-[10px] uppercase tracking-wider font-mono text-white/40 mb-1">
            Shared connections
          </div>
          <ul className="space-y-1">
            {mutualFriendsList.slice(0, 8).map((f, i) => (
              <li
                key={`${f.handle ?? f.name ?? 'anon'}-${i}`}
                className="flex items-baseline gap-2 text-xs"
              >
                <span className="text-white/80">
                  {f.name || f.handle || 'Anonymous connection'}
                </span>
                {f.handle && f.name && (
                  <span className="text-white/40 font-mono">@{f.handle}</span>
                )}
                {f.source && (
                  <span className="text-[10px] text-white/30 font-mono ml-auto">
                    {SOURCE_LABEL[f.source] ?? f.source}
                  </span>
                )}
              </li>
            ))}
            {mutualFriendsList.length > 8 && (
              <li className="text-[11px] text-white/30 font-mono">
                +{mutualFriendsList.length - 8} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Cluster info */}
      {friendClusterId && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-wider font-mono text-white/40 mb-1">
            Friend cluster
          </div>
          {isLocked ? (
            <p className="text-xs text-red-300 leading-snug">
              Cluster locked - the leader has attended a date with Julian.
              This match is archived.
            </p>
          ) : isSuppressed ? (
            <p className="text-xs text-amber-200 leading-snug">
              Part of a friend cluster. Another match (rank 1) is the current
              leader - this one is suppressed to avoid burning the friend
              group. Unlock only if the leader fades.
            </p>
          ) : (
            <p className="text-xs text-emerald-200 leading-snug">
              Cluster leader (rank 1). Pursuing this match will lock the
              cluster once a date is attended.
            </p>
          )}
          <p className="text-[10px] font-mono text-white/30 mt-1">
            cluster id: {friendClusterId.slice(0, 8)}...
          </p>
        </div>
      )}

      {/* Proceed override for high-risk / auto-flag */}
      {(band === 'high_risk' || band === 'auto_flag' || isSuppressed) && !isLocked && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={proceed}
              onChange={(e) => toggleProceed(e.target.checked)}
              disabled={saving}
              className="accent-red-400 mt-0.5"
            />
            <span className="text-[11px] text-white/70 leading-snug">
              Proceed despite cluster risk.{' '}
              <span className="text-white/40">
                Logs the override for future learning. Openers stay paused
                until cleared.
              </span>
            </span>
          </label>
          {saveError && (
            <p className="text-sm text-red-400 mt-2 border border-red-500/30 rounded px-2 py-1 font-mono">{saveError}</p>
          )}
        </div>
      )}

      {count === 0 && !friendClusterId && (
        <p className="text-[11px] text-white/30 italic mt-3 leading-snug">
          No social graph collisions detected. This match is safe to pursue
          without burning a friend cluster.
        </p>
      )}
    </div>
  )
}
