'use client'
/**
 * AI-8809 — Supabase Realtime hooks for clapcheeks_conversations.
 *
 * Architecture note (AI-8812 fix):
 *   clapcheeks_conversations stores messages as a JSONB array on a SINGLE ROW
 *   per match — NOT individual message rows.  The previous implementation
 *   targeted the nonexistent table clapcheeks_match_messages.
 *
 *   On INSERT: a new conversation row appeared (first message in a match).
 *   On UPDATE: the messages array on an existing row grew — we extract the
 *              delta (new tail entries) and emit only those to consumers.
 *
 * useMatchMessages(matchId)
 *   Subscribe to live message updates for a single match conversation.
 *   Fires onEvent with each new ConversationMessage entry.
 *   Designed to be used inside a ConversationThread (AI-8807).
 *
 * useInboxStream(userId)
 *   Fan-out hook: subscribes to ALL conversations for the current user
 *   and fires the callback for each new INCOMING message entry.
 *   Rendered globally in the dashboard layout so badges, toasts, and
 *   push-notification triggers all update within seconds of a new
 *   message landing in Supabase.
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ConversationMessage } from '@/lib/matches/types'

// RealtimeChannel type comes from @supabase/supabase-js; use ReturnType to avoid direct import
// in environments where the package types are not installed.
type RealtimeChannel = ReturnType<ReturnType<typeof createClient>['channel']>

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Shape of a row in clapcheeks_conversations.
 * messages is a JSONB array of ConversationMessage entries.
 */
export type ConversationRow = {
  id: string
  user_id: string
  match_id: string
  platform?: string
  messages: ConversationMessage[]
  stage?: string
  last_message_at?: string | null
  created_at: string
  [key: string]: unknown
}

export type ConversationRowEvent = {
  eventType: 'INSERT' | 'UPDATE'
  new: Partial<ConversationRow>
  old: Partial<ConversationRow>
  /** Delta: only the newly added message entries (empty on pure metadata updates) */
  newEntries: ConversationMessage[]
}

export type InboxCallback = (msg: ConversationMessage) => void

// ─── Delta extraction helper ──────────────────────────────────────────────────

/**
 * Given the old and new messages arrays from a clapcheeks_conversations UPDATE
 * event, return only the newly appended entries.
 *
 * Supabase Realtime sends the full row on UPDATE so we compare array lengths.
 */
function extractNewEntries(
  oldMessages: ConversationMessage[] | undefined | null,
  newMessages: ConversationMessage[] | undefined | null,
): ConversationMessage[] {
  const oldList = oldMessages ?? []
  const newList = newMessages ?? []
  const newCount = newList.length - oldList.length
  return newCount > 0 ? newList.slice(-newCount) : []
}

// ─── useMatchMessages ─────────────────────────────────────────────────────────

/**
 * AI-9572 — NO-OP shim. The conversation thread now subscribes to Convex
 * via useQuery(api.messages.listByConversation) which auto-updates on every
 * Convex write. Kept exported so remaining call sites compile without changes.
 *
 * @param matchId  Unused (was the Supabase match_id filter).
 * @param onEvent  Unused.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useMatchMessages(
  _matchId: string | null | undefined,
  _onEvent: (event: ConversationRowEvent) => void,
): void {
  // no-op — subscription now handled by Convex in ConversationThread (AI-9572)
}

// ─── useInboxStream ───────────────────────────────────────────────────────────

/**
 * Fan-out realtime hook for incoming messages across ALL conversations for a user.
 *
 * Call once at the layout level.  Fires onIncoming for each new INCOMING
 * ConversationMessage entry detected in any conversation row belonging to userId.
 *
 * On INSERT: all messages in the new row that have direction === 'incoming'.
 * On UPDATE: only the delta entries (newly appended) with direction === 'incoming'.
 *
 * @param userId      The authenticated user's UUID.
 * @param onIncoming  Callback fired when a new incoming message entry appears.
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

    const handleEntries = (entries: ConversationMessage[]) => {
      for (const entry of entries) {
        if (entry.direction === 'incoming') {
          onIncomingRef.current(entry)
        }
      }
    }

    const channel: RealtimeChannel = supabase
      .channel(`inbox-stream:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'clapcheeks_conversations',
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new?: Record<string, unknown> }) => {
          const newRow = (payload.new ?? {}) as Partial<ConversationRow>
          handleEntries((newRow.messages ?? []) as ConversationMessage[])
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'clapcheeks_conversations',
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          const newRow = (payload.new ?? {}) as Partial<ConversationRow>
          const oldRow = (payload.old ?? {}) as Partial<ConversationRow>
          const newEntries = extractNewEntries(
            oldRow.messages as ConversationMessage[] | undefined,
            newRow.messages as ConversationMessage[] | undefined,
          )
          handleEntries(newEntries)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
}
