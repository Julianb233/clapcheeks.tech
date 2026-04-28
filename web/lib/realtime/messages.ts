'use client'
/**
 * AI-8809 — Supabase Realtime hooks for clapcheeks_match_messages.
 *
 * useMatchMessages(matchId)
 *   Subscribe to live message updates for a single match.
 *   Emits on INSERT / UPDATE / DELETE of rows with match_id = matchId.
 *   Designed to be used inside a ConversationThread (AI-8807) once that
 *   worker's PR lands — DO NOT modify ConversationThread.tsx until then.
 *
 * useInboxStream(userId)
 *   Fan-out hook: subscribes to ALL incoming messages for the current user
 *   and fires registered callbacks. Rendered globally in the dashboard
 *   layout so badges, toasts, and push-notification triggers all update
 *   within seconds of a new message landing in Supabase.
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
// RealtimeChannel type comes from @supabase/supabase-js; use ReturnType to avoid direct import
// in environments where the package types are not installed.
type RealtimeChannel = ReturnType<ReturnType<typeof createClient>['channel']>

// ─── Types ───────────────────────────────────────────────────────────────────

export type MatchMessage = {
  id: string
  match_id: string
  user_id: string
  direction: 'incoming' | 'outgoing'
  body: string
  created_at: string
  platform?: string
  [key: string]: unknown
}

export type MatchMessageEvent = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Partial<MatchMessage>
  old: Partial<MatchMessage>
}

export type InboxCallback = (msg: MatchMessage) => void

// ─── useMatchMessages ─────────────────────────────────────────────────────────

/**
 * Subscribe to live changes on clapcheeks_match_messages for a given match.
 *
 * @param matchId  The match UUID to filter by.
 * @param onEvent  Callback fired on each change event.
 */
export function useMatchMessages(
  matchId: string | null | undefined,
  onEvent: (event: MatchMessageEvent) => void,
) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!matchId) return

    const supabase = createClient()
    const channel: RealtimeChannel = supabase
      .channel(`match-messages:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'clapcheeks_match_messages',
          filter: `match_id=eq.${matchId}`,
        },
        (payload: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          onEventRef.current({
            eventType: payload.eventType as MatchMessageEvent['eventType'],
            new: (payload.new ?? {}) as Partial<MatchMessage>,
            old: (payload.old ?? {}) as Partial<MatchMessage>,
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [matchId])
}

// ─── useInboxStream ───────────────────────────────────────────────────────────

type InboxStreamState = {
  callbacks: Set<InboxCallback>
  channel: RealtimeChannel | null
  supabase: ReturnType<typeof createClient> | null
}

/**
 * Fan-out realtime hook for incoming messages across ALL matches for a user.
 *
 * Call once at the layout level. Each subscriber (badges, toasts, push
 * triggers) calls useInboxStreamSubscribe(callback) to receive events.
 *
 * @param userId   The authenticated user's UUID.
 * @param onIncoming  Callback fired when a new incoming message lands.
 */
export function useInboxStream(
  userId: string | null | undefined,
  onIncoming: InboxCallback,
) {
  const onIncomingRef = useRef(onIncoming)
  onIncomingRef.current = onIncoming

  useEffect(() => {
    if (!userId) return

    const supabase = createClient()

    // Subscribe to all INSERT events on clapcheeks_match_messages for this user
    // where direction = 'incoming'. Supabase Realtime filters are equality-only,
    // so we filter on user_id and check direction in the callback.
    const channel: RealtimeChannel = supabase
      .channel(`inbox-stream:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'clapcheeks_match_messages',
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new?: Record<string, unknown> }) => {
          const msg = payload.new as MatchMessage
          if (msg?.direction === 'incoming') {
            onIncomingRef.current(msg)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
}
