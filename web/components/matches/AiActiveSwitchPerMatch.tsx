'use client'
/**
 * AI-8809 — Per-match AI toggle.
 *
 * Smaller switch for the /matches/[id] page header.
 * Toggles clapcheeks_matches.ai_active for a single match.
 * Does NOT affect the user-level setting.
 */

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Props = {
  matchId: string
}

export default function AiActiveSwitchPerMatch({ matchId }: Props) {
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!matchId) return
    const supabase = createClient()
    ;(async () => {
      const { data } = await supabase
        .from('clapcheeks_matches')
        .select('ai_active')
        .eq('id', matchId)
        .single()
      if (data) setActive(data.ai_active ?? true)
      setLoaded(true)
    })()
  }, [matchId])

  async function toggle() {
    if (!loaded || saving) return
    const next = !active
    setSaving(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('clapcheeks_matches')
      .update({ ai_active: next })
      .eq('id', matchId)
      .select('ai_active')
      .single()
    if (data) setActive(data.ai_active ?? next)
    setSaving(false)
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
