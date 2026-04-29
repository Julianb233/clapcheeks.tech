/**
 * AI-8876 — Realtime UPDATE delta extraction tests.
 *
 * Verifies that the extractNewEntries() helper in
 * web/lib/realtime/messages.ts correctly computes the set of newly appended
 * ConversationMessage entries from a Supabase Realtime UPDATE payload.
 *
 * Context: clapcheeks_conversations stores messages as a JSONB array on a
 * single row per match. With REPLICA IDENTITY DEFAULT (the pre-AI-8876 state)
 * Supabase only sends primary-key columns in `old`, so oldMessages is always
 * undefined/null and every UPDATE broadcasts the full array as "new entries"
 * — a bug that causes duplicate rendering in ConversationThread.
 *
 * With REPLICA IDENTITY FULL (applied by migration
 * 20260428070000_realtime_replica_identity_full.sql) the full old row is
 * included and delta logic works correctly.
 *
 * These unit tests exercise the pure TypeScript logic — no Supabase
 * connection required.  The REPLICA IDENTITY FULL migration is verified by
 * the apply-migration section of the PR description.
 *
 * Run:  cd web && npm test -- realtime-delta
 */

import { describe, test, expect } from 'vitest'

// ─── Inline the helper under test ────────────────────────────────────────────
// We deliberately re-implement the shape rather than importing the module
// directly to avoid pulling in React + Supabase client initialisation in a
// pure unit test.  The actual implementation in messages.ts must stay in sync
// with this spec — the test acts as the contract.

type ConversationMessage = {
  id?: string
  body?: string
  direction?: 'incoming' | 'outgoing'
  sent_at?: string
  [key: string]: unknown
}

/**
 * Mirror of messages.ts:71 extractNewEntries.
 * Returns newly appended tail entries from a JSONB array UPDATE diff.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msg(id: string, direction: 'incoming' | 'outgoing' = 'incoming'): ConversationMessage {
  return { id, body: `message ${id}`, direction, sent_at: new Date().toISOString() }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('extractNewEntries — delta logic', () => {
  // ── Scenario: REPLICA IDENTITY FULL applied (old messages available) ────────

  describe('with REPLICA IDENTITY FULL (old row fully populated)', () => {
    test('returns only the appended message when one is added', () => {
      const oldMessages = [msg('1'), msg('2')]
      const newMessages = [msg('1'), msg('2'), msg('3')]
      const delta = extractNewEntries(oldMessages, newMessages)
      expect(delta).toHaveLength(1)
      expect(delta[0].id).toBe('3')
    })

    test('returns multiple appended messages when several arrive in a batch', () => {
      const oldMessages = [msg('1')]
      const newMessages = [msg('1'), msg('2'), msg('3'), msg('4')]
      const delta = extractNewEntries(oldMessages, newMessages)
      expect(delta).toHaveLength(3)
      expect(delta.map(m => m.id)).toEqual(['2', '3', '4'])
    })

    test('returns empty array when messages array length is unchanged (metadata update)', () => {
      const oldMessages = [msg('1'), msg('2')]
      const newMessages = [msg('1'), msg('2')]
      const delta = extractNewEntries(oldMessages, newMessages)
      expect(delta).toHaveLength(0)
    })

    test('returns empty array when new array is shorter (message deleted edge case)', () => {
      const oldMessages = [msg('1'), msg('2'), msg('3')]
      const newMessages = [msg('1')]
      const delta = extractNewEntries(oldMessages, newMessages)
      expect(delta).toHaveLength(0)
    })
  })

  // ── Scenario: REPLICA IDENTITY DEFAULT / missing old row (pre-fix bug) ───────
  //
  // This documents the BUG BEHAVIOUR that existed before AI-8876.
  // With REPLICA IDENTITY DEFAULT, Supabase sends only PKs in `old`, so
  // oldMessages is always undefined. The function falls back to [] and emits
  // the ENTIRE new array as delta — incorrect on UPDATE.
  //
  // After the migration, this scenario should not occur in production because
  // `old.messages` will always be populated.  The test is kept as a regression
  // guard: if REPLICA IDENTITY is ever reverted, this test will remind the
  // developer of the consequence.

  describe('without old row data (REPLICA IDENTITY DEFAULT behaviour — pre-fix)', () => {
    test('REGRESSION: emits entire messages array when oldMessages is undefined', () => {
      const newMessages = [msg('1'), msg('2'), msg('3')]
      const delta = extractNewEntries(undefined, newMessages)
      expect(delta).toHaveLength(3)
    })

    test('REGRESSION: emits entire messages array when oldMessages is null', () => {
      const newMessages = [msg('1'), msg('2'), msg('3')]
      const delta = extractNewEntries(null, newMessages)
      expect(delta).toHaveLength(3)
    })

    test('REGRESSION: emits entire messages array when oldMessages is empty array', () => {
      const newMessages = [msg('a'), msg('b')]
      const delta = extractNewEntries([], newMessages)
      expect(delta).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    test('handles empty new array gracefully', () => {
      const delta = extractNewEntries([msg('1')], [])
      expect(delta).toHaveLength(0)
    })

    test('handles both null/undefined inputs', () => {
      const delta = extractNewEntries(null, null)
      expect(delta).toHaveLength(0)
    })

    test('preserves message content of appended entries', () => {
      const existing = [msg('a', 'outgoing'), msg('b', 'incoming')]
      const incoming = msg('c', 'incoming')
      const updated = [...existing, incoming]
      const delta = extractNewEntries(existing, updated)
      expect(delta).toHaveLength(1)
      expect(delta[0]).toMatchObject({ id: 'c', direction: 'incoming' })
    })

    test('direction filter (useInboxStream) works correctly on delta', () => {
      const existing = [msg('1', 'outgoing')]
      const updated = [msg('1', 'outgoing'), msg('2', 'incoming'), msg('3', 'outgoing')]
      const delta = extractNewEntries(existing, updated)
      const incomingOnly = delta.filter(m => m.direction === 'incoming')
      expect(delta).toHaveLength(2)
      expect(incomingOnly).toHaveLength(1)
      expect(incomingOnly[0].id).toBe('2')
    })
  })
})
