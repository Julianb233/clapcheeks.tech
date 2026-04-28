'use client'
/**
 * AI-8809 — Global AI Paused Banner.
 *
 * Renders a sticky viewport-wide banner when the user's AI is paused.
 * Wired into (main)/layout.tsx as a server-rendered wrapper that passes
 * the initial state down; the client component subscribes to Realtime
 * so the banner appears/disappears without a page reload.
 */

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function AiActiveBanner() {
  const [paused, setPaused] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      setUserId(user.id)

      // Initial fetch
      const { data } = await supabase
        .from('clapcheeks_user_settings')
        .select('ai_active, ai_paused_until, ai_paused_reason')
        .eq('user_id', user.id)
        .single()
      if (cancelled) return
      if (data) {
        const isActive = data.ai_active &&
          (!data.ai_paused_until || new Date(data.ai_paused_until) < new Date())
        setPaused(!isActive)
        setReason(data.ai_paused_reason ?? null)
      }

      // Subscribe to live changes
      const channel = supabase
        .channel('ai-banner-settings')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'clapcheeks_user_settings',
            filter: `user_id=eq.${user.id}`,
          },
          (payload: { new?: Record<string, unknown> }) => {
            if (cancelled) return
            const row = payload.new as {
              ai_active: boolean
              ai_paused_until: string | null
              ai_paused_reason: string | null
            }
            const isActive = row.ai_active &&
              (!row.ai_paused_until || new Date(row.ai_paused_until) < new Date())
            setPaused(!isActive)
            setReason(row.ai_paused_reason ?? null)
          },
        )
        .subscribe()

      return () => {
        cancelled = true
        supabase.removeChannel(channel)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleResume() {
    if (!userId) return
    const supabase = createClient()
    await supabase
      .from('clapcheeks_user_settings')
      .upsert(
        { user_id: userId, ai_active: true, ai_paused_until: null, ai_paused_reason: null },
        { onConflict: 'user_id' },
      )
    setPaused(false)
  }

  if (!paused) return null

  return (
    <div className="sticky top-0 z-50 w-full bg-gradient-to-r from-red-900/90 to-red-800/90 backdrop-blur-sm border-b border-red-500/30 px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
        <span className="text-red-100 font-medium">
          AI Paused — observation mode only
          {reason && (
            <span className="text-red-300/70 font-normal ml-1">({reason})</span>
          )}
        </span>
      </div>
      <button
        onClick={handleResume}
        className="text-xs text-red-200 hover:text-white underline underline-offset-2 transition-colors"
      >
        Resume AI
      </button>
    </div>
  )
}
