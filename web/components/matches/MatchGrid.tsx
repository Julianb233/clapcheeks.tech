'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import MatchCard from './MatchCard'
import FilterBar from './FilterBar'
import {
  MatchListFilters,
} from '@/lib/matches/types'
import {
  aggregateAttributes,
  matchHasAllAttributes,
  type MatchWithAttributes,
} from '@/lib/matches/attribute-filter'

type LastMessageMap = Record<string, string | null>

type Props = {
  initialMatches: MatchWithAttributes[]
  initialHasMore: boolean
  initialLastMessages: LastMessageMap
  pageSize: number
}

const DEFAULT_FILTERS: MatchListFilters = {
  platform: 'all',
  status: 'all',
  minScore: 0,
  attributeValues: [],
}

export default function MatchGrid({
  initialMatches,
  initialHasMore,
  initialLastMessages,
  pageSize,
}: Props) {
  const [matches, setMatches] = useState<MatchWithAttributes[]>(initialMatches)
  const [lastMessages] = useState<LastMessageMap>(initialLastMessages)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<MatchListFilters>(DEFAULT_FILTERS)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const attributeOptions = useMemo(() => aggregateAttributes(matches), [matches])

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (filters.platform !== 'all' && m.platform !== filters.platform) return false
      if (filters.status !== 'all' && m.status !== filters.status) return false
      if (filters.minScore > 0) {
        const s = typeof m.final_score === 'number' ? m.final_score : 0
        if (s < filters.minScore) return false
      }
      if (!matchHasAllAttributes(m, filters.attributeValues)) return false
      return true
    })
  }, [matches, filters])

  const fetchMore = useCallback(async () => {
    if (!hasMore || loading) return
    setLoading(true)
    try {
      const supabase = createClient()
      const from = matches.length
      const to = from + pageSize - 1
      const { data, error } = await supabase
        .from('clapcheeks_matches')
        .select('*')
        .order('final_score', { ascending: false, nullsFirst: false })
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .range(from, to)
      if (error) {
        console.warn('[MatchGrid] fetchMore error:', error.message)
        setHasMore(false)
      } else if (data && data.length > 0) {
        setMatches((prev) => [...prev, ...(data as unknown as MatchWithAttributes[])])
        if (data.length < pageSize) setHasMore(false)
      } else {
        setHasMore(false)
      }
    } finally {
      setLoading(false)
    }
  }, [hasMore, loading, matches.length, pageSize])

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return
    const el = sentinelRef.current
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchMore()
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [fetchMore, hasMore])

  async function triggerSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/agent/sync-matches', { method: 'POST' })
      if (res.ok) {
        setSyncMsg('Sync requested. Check back in a minute.')
      } else {
        setSyncMsg('Sync failed. Make sure the agent is installed.')
      }
    } catch {
      setSyncMsg('Network error. Try again.')
    } finally {
      setSyncing(false)
    }
  }

  if (matches.length === 0) {
    return (
      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 mx-auto mb-4 flex items-center justify-center">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-yellow-400"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <h3 className="text-white font-semibold text-lg mb-2">No matches yet</h3>
        <p className="text-white/40 text-sm max-w-md mx-auto mb-4">
          Match intake is running — the Clapcheeks agent pulls your matches every 10 minutes. Check
          back soon, or kick off a manual sync now.
        </p>
        <button
          type="button"
          onClick={triggerSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-500 to-red-600 text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {syncing ? 'Requesting...' : 'Run sync now'}
        </button>
        {syncMsg && (
          <p className="mt-3 text-xs font-mono text-yellow-400/80">{syncMsg}</p>
        )}
      </div>
    )
  }

  return (
    <div>
      <FilterBar
        filters={filters}
        onChange={setFilters}
        total={matches.length}
        filteredCount={filtered.length}
        attributeOptions={attributeOptions}
      />
      {filtered.length === 0 ? (
        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-10 text-center">
          <p className="text-white/50 text-sm">
            No matches match these filters. Adjust the platform, status, score, or attribute tags.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((m) => (
            <MatchCard key={m.id} match={m} lastMessage={lastMessages[m.id]} />
          ))}
        </div>
      )}
      {hasMore && (
        <div ref={sentinelRef} className="h-20 flex items-center justify-center">
          {loading ? (
            <div className="text-white/40 text-xs font-mono">Loading more...</div>
          ) : (
            <div className="text-white/20 text-xs font-mono">Scroll for more</div>
          )}
        </div>
      )}
      {!hasMore && matches.length > 0 && (
        <div className="h-20 flex items-center justify-center text-white/20 text-xs font-mono">
          End of matches
        </div>
      )}
    </div>
  )
}

