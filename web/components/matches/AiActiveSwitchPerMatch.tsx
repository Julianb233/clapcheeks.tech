'use client'
/**
 * AI-8809 — Per-match AI toggle.
 *
 * Smaller switch for the /matches/[id] page header.
 * Toggles matches.ai_active for a single match (AI-9534: now on Convex).
 * Does NOT affect the user-level setting.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { toast } from 'sonner'

type Props = {
  matchId: string
}

export default function AiActiveSwitchPerMatch({ matchId }: Props) {
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // matchId can be either a Convex `_id` or a legacy Supabase UUID; resolve
  // through resolveByAnyId so both work.
  const row = useQuery(
    api.matches.resolveByAnyId,
    matchId ? { id: matchId } : 'skip',
  ) as (Record<string, unknown> & { _id?: Id<'matches'>; ai_active?: boolean }) | null | undefined

  const patch = useMutation(api.matches.patch)

  useEffect(() => {
    if (row === undefined) return
    if (row && typeof row.ai_active === 'boolean') setActive(row.ai_active)
    else if (row) setActive(true)
    setLoaded(true)
  }, [row])

  async function toggle() {
    if (!loaded || saving || !row?._id) return
    const next = !active
    setSaving(true)
    setActive(next) // optimistic
    try {
      await patch({ id: row._id, ai_active: next })
    } catch (err) {
      setActive(!next) // rollback
      toast.error(
        `Failed to toggle AI for this match${err instanceof Error && err.message ? ': ' + err.message : '.'}`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={!loaded || saving}
      title={active ? 'AI active for this match — click to pause' : 'AI paused for this match — click to resume'}
      className={`
        flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium
        border transition-all duration-200
        ${active
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20'
          : 'bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/20'}
        ${saving || !loaded ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
      `}
    >
      <span
        className={`
          relative w-6 h-3 rounded-full transition-colors duration-200 flex-shrink-0
          ${active ? 'bg-emerald-500' : 'bg-red-500/50'}
        `}
      >
        <span
          className={`
            absolute top-0.5 w-2 h-2 rounded-full bg-white shadow transition-transform duration-200
            ${active ? 'translate-x-3' : 'translate-x-0.5'}
          `}
        />
      </span>
      {active ? 'AI on' : 'AI off'}
    </button>
  )
}
