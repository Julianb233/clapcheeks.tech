'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ClapcheeksMatchRow,
  ConversationMessage,
  MatchStatus,
  PLATFORM_COLORS,
  STATUS_COLORS,
  formatTimeAgo,
} from '@/lib/matches/types'
import PhotoGallery from './PhotoGallery'
import ScoringPanel from './ScoringPanel'
import SocialGraphPanel from './SocialGraphPanel'
import ConversationThread from './ConversationThread'

type Props = {
  match: ClapcheeksMatchRow
  messages: ConversationMessage[]
  clusterRisk?: boolean
}

const ACTIONABLE_STATUSES: Array<{ key: MatchStatus; label: string }> = [
  { key: 'date_booked', label: 'Schedule date' },
  { key: 'dated', label: 'Mark dated' },
  { key: 'stalled', label: 'Send re-engage' },
  { key: 'ghosted', label: 'Archive' },
]

export default function MatchDetail({ match, messages, clusterRisk }: Props) {
  const [current, setCurrent] = useState(match)
  const [rank, setRank] = useState<number>(match.julian_rank ?? 5)
  const [rankSaving, setRankSaving] = useState(false)
  const [rankError, setRankError] = useState<string | null>(null)
  const [proceedRisk, setProceedRisk] = useState(false)
  const [statusBusy, setStatusBusy] = useState<MatchStatus | null>(null)

  const visionSummary = match.vision_summary ?? null
  const instagramSummary = match.instagram_intel?.summary ?? null

  async function updateStatus(next: MatchStatus) {
    setStatusBusy(next)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('clapcheeks_matches')
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq('id', current.id)
      if (!error) {
        setCurrent((prev) => ({ ...prev, status: next }))
      } else {
        console.warn('[MatchDetail] status update failed:', error.message)
      }
    } finally {
      setStatusBusy(null)
    }
  }

  async function saveRank(newRank: number) {
    setRankSaving(true)
    setRankError(null)
    try {
      const supabase = createClient()
      // julian_rank column may not exist yet — handle gracefully.
      const { error } = await supabase
        .from('clapcheeks_matches')
        .update({ julian_rank: newRank })
        .eq('id', current.id)
      if (error) {
        setRankError('julian_rank column not yet deployed — Phase A will add it.')
      }
    } catch (e) {
      setRankError('Network error saving rank.')
    } finally {
      setRankSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 md:px-6 py-6 md:py-8">
      <div className="max-w-6xl mx-auto">
        {/* Back link */}
        <div className="mb-4">
          <Link
            href="/matches"
            className="inline-flex items-center gap-2 text-xs text-white/50 hover:text-white font-mono"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to matches
          </Link>
        </div>

        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span
                className={`text-[10px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded border ${PLATFORM_COLORS[current.platform]}`}
              >
                {current.platform}
              </span>
              <span
                className={`text-[10px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded border ${STATUS_COLORS[current.status] ?? STATUS_COLORS.new}`}
              >
                {current.status.replace('_', ' ')}
              </span>
              <span className="text-[10px] font-mono text-white/40">
                Last activity {formatTimeAgo(current.last_activity_at ?? current.updated_at)}
              </span>
            </div>
            <h1 className="font-display text-4xl md:text-5xl uppercase leading-none">
              {current.name ?? 'Unknown'}
              {current.age && (
                <span className="text-white/60 font-body text-2xl md:text-3xl ml-3">{current.age}</span>
              )}
            </h1>
            <div className="mt-2 text-sm text-white/50 flex gap-3 flex-wrap font-mono">
              {current.job && <span>{current.job}</span>}
              {current.school && <span>· {current.school}</span>}
              {current.zodiac && <span>· {current.zodiac}</span>}
            </div>
          </div>

          {/* Action bar */}
          <div className="flex gap-2 flex-wrap">
            {ACTIONABLE_STATUSES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => updateStatus(s.key)}
                disabled={statusBusy !== null}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  current.status === s.key
                    ? 'bg-yellow-500/25 text-yellow-200 border-yellow-500/50'
                    : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                } disabled:opacity-50`}
              >
                {statusBusy === s.key ? '...' : s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6">
          {/* Left col: photos + scoring */}
          <div className="space-y-6">
            <PhotoGallery photos={current.photos_jsonb ?? []} name={current.name} />
            <ScoringPanel match={current} />
            <SocialGraphPanel
              matchId={current.id}
              mutualFriendsCount={current.mutual_friends_count}
              mutualFriendsList={current.mutual_friends_list}
              socialRiskBand={current.social_risk_band}
              friendClusterId={current.friend_cluster_id}
              clusterRank={current.cluster_rank}
              socialGraphConfidence={current.social_graph_confidence}
              socialGraphSources={current.social_graph_sources}
            />

            {/* AI rank */}
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
              <div className="flex justify-between items-baseline mb-2">
                <h3 className="text-xs uppercase tracking-widest font-mono text-white/40">
                  AI rank
                </h3>
                <span className="font-mono text-2xl text-yellow-400 font-bold">{rank}</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={rank}
                onChange={(e) => setRank(Number(e.target.value))}
                onMouseUp={(e) => saveRank(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => saveRank(Number((e.target as HTMLInputElement).value))}
                className="w-full accent-yellow-500"
              />
              <div className="flex justify-between text-[10px] text-white/30 font-mono mt-1">
                <span>1</span>
                <span>10</span>
              </div>
              {rankSaving && <p className="text-[10px] text-white/40 mt-2">Saving...</p>}
              {rankError && <p className="text-[10px] text-amber-400 mt-2">{rankError}</p>}
            </div>

            {/* Cluster risk toggle */}
            {clusterRisk && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400 mt-0.5">
                    <path d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0l-7.1 12.25A2 2 0 005 19z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div>
                    <p className="text-xs text-red-300 font-semibold mb-1">Cluster risk detected</p>
                    <p className="text-[11px] text-red-200/70 leading-snug">
                      This match shares signals with profiles that previously stalled. Proceed with caution.
                    </p>
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={proceedRisk}
                        onChange={(e) => setProceedRisk(e.target.checked)}
                        className="accent-red-400"
                      />
                      <span className="text-[11px] text-red-200">Proceed despite cluster risk</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right col: bio, prompts, AI insights, convo */}
          <div className="space-y-6 min-w-0">
            {/* Bio */}
            {current.bio && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                <h3 className="text-xs uppercase tracking-widest font-mono text-white/40 mb-2">Bio</h3>
                <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">
                  {current.bio}
                </p>
              </div>
            )}

            {/* Prompts (Hinge) */}
            {current.prompts_jsonb && current.prompts_jsonb.length > 0 && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                <h3 className="text-xs uppercase tracking-widest font-mono text-white/40 mb-3">
                  Prompts
                </h3>
                <div className="space-y-3">
                  {current.prompts_jsonb.map((p, i) => (
                    <div key={i}>
                      <p className="text-[11px] text-white/40 uppercase tracking-wide font-mono">
                        {p.question}
                      </p>
                      <p className="text-white/80 text-sm mt-0.5">{p.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Spotify + IG */}
            {(current.spotify_artists && current.spotify_artists.length > 0) || current.instagram_handle ? (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                <h3 className="text-xs uppercase tracking-widest font-mono text-white/40 mb-3">Signals</h3>
                {current.instagram_handle && (
                  <div className="mb-3">
                    <p className="text-[11px] text-white/40 font-mono">Instagram</p>
                    <p className="text-white/80 text-sm">@{current.instagram_handle}</p>
                  </div>
                )}
                {current.spotify_artists && current.spotify_artists.length > 0 && (
                  <div>
                    <p className="text-[11px] text-white/40 font-mono mb-1">Spotify top artists</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {current.spotify_artists.map((a) => (
                        <span
                          key={a}
                          className="text-[11px] bg-white/5 border border-white/10 rounded px-2 py-0.5 text-white/70"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* AI insights */}
            <div>
              <h3 className="text-xs uppercase tracking-widest font-mono text-white/40 mb-3 px-1">
                AI Insights
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-purple-400">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                    </svg>
                    <span className="text-xs uppercase tracking-wider text-purple-300 font-mono font-semibold">
                      Vision
                    </span>
                  </div>
                  {visionSummary ? (
                    <p className="text-sm text-white/80 leading-relaxed">{visionSummary}</p>
                  ) : (
                    <p className="text-xs text-white/30 italic">
                      Pending analysis. The vision model analyzes photos and returns a summary once images have been processed.
                    </p>
                  )}
                </div>
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-pink-400">
                      <rect x="3" y="3" width="18" height="18" rx="4" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17" cy="7" r="1" fill="currentColor" />
                    </svg>
                    <span className="text-xs uppercase tracking-wider text-pink-300 font-mono font-semibold">
                      Instagram
                    </span>
                  </div>
                  {instagramSummary ? (
                    <p className="text-sm text-white/80 leading-relaxed">{instagramSummary}</p>
                  ) : (
                    <p className="text-xs text-white/30 italic">
                      Pending analysis. Instagram intel runs after the handle is linked and the agent pulls recent posts.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Match intel badges */}
            {current.match_intel && (current.match_intel.green_flags?.length || current.match_intel.red_flags?.length) ? (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                <h3 className="text-xs uppercase tracking-widest font-mono text-white/40 mb-3">
                  Flags
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] text-emerald-400 font-mono uppercase tracking-wide mb-1">
                      Green flags
                    </p>
                    {current.match_intel.green_flags?.length ? (
                      <ul className="text-sm text-white/80 space-y-1">
                        {current.match_intel.green_flags.map((f, i) => (
                          <li key={i}>· {f}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-white/30 italic">None noted.</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] text-amber-400 font-mono uppercase tracking-wide mb-1">
                      Red flags
                    </p>
                    {current.match_intel.red_flags?.length ? (
                      <ul className="text-sm text-white/80 space-y-1">
                        {current.match_intel.red_flags.map((f, i) => (
                          <li key={i}>· {f}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-white/30 italic">None noted.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Conversation */}
            <div>
              <h3 className="text-xs uppercase tracking-widest font-mono text-white/40 mb-3 px-1">
                Conversation
              </h3>
              <ConversationThread messages={messages} matchName={current.name} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
