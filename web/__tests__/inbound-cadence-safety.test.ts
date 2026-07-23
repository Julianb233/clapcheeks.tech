import { afterEach, describe, expect, test, vi } from 'vitest'

import type { Id } from '@/convex/_generated/dataModel'
import {
  _enqueueCadenceJob,
  interpretInboundForOne,
} from '@/convex/inbound'

const NOW = 1_800_000_000_000
const PERSON_ID = 'person-fixture' as Id<'people'>
const CONVERSATION_ID = 'conversation-fixture' as Id<'conversations'>

type ConvexFunction = {
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('inbound cadence safety', () => {
  test('historical inbound replay enriches context but cannot trigger a send evaluation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const runMutation = vi.fn(async (_reference: unknown, _args: unknown) => true)
    const ctx = {
      runQuery: vi.fn(async () => ({
        _id: PERSON_ID,
        user_id: 'fleet-julian',
        courtship_last_analyzed: 0,
      })),
      runMutation,
    }

    const result = await (interpretInboundForOne as unknown as ConvexFunction)._handler(ctx, {
      person_id: PERSON_ID,
      conversation_id: CONVERSATION_ID,
      message_external_guid: 'message-old',
      message_sent_at: NOW - 60 * 60 * 1000,
    })

    expect(result).toEqual({ enqueued: 1 })
    expect(runMutation).toHaveBeenCalledOnce()
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      person_id: PERSON_ID,
      conversation_id: CONVERSATION_ID,
    })
  })

  test('live inbound triggers one coalesced cadence evaluation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const runMutation = vi.fn(async (_reference: unknown, _args: unknown) => true)
    const ctx = {
      runQuery: vi.fn(async () => ({
        _id: PERSON_ID,
        user_id: 'fleet-julian',
        courtship_last_analyzed: NOW,
      })),
      runMutation,
    }

    const result = await (interpretInboundForOne as unknown as ConvexFunction)._handler(ctx, {
      person_id: PERSON_ID,
      conversation_id: CONVERSATION_ID,
      message_external_guid: 'message-live',
      message_sent_at: NOW - 30_000,
    })

    expect(result).toEqual({ enqueued: 1 })
    expect(runMutation).toHaveBeenCalledOnce()
  })

  test('cadence enqueue coalesces an existing queued or running job for the person', async () => {
    const first = vi.fn()
      .mockResolvedValueOnce({ _id: 'existing-job' })
    const filter = vi.fn(() => ({ first }))
    const withIndex = vi.fn(() => ({ filter }))
    const query = vi.fn(() => ({ withIndex }))
    const insert = vi.fn()
    const ctx = { db: { query, insert } }

    const result = await (_enqueueCadenceJob as unknown as ConvexFunction)._handler(ctx, {
      user_id: 'fleet-julian',
      person_id: PERSON_ID,
    })

    expect(result).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })

  test('cadence enqueue inserts exactly once when no active job exists', async () => {
    const first = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const filter = vi.fn(() => ({ first }))
    const withIndex = vi.fn(() => ({ filter }))
    const query = vi.fn(() => ({ withIndex }))
    const insert = vi.fn(async () => 'new-job')
    const ctx = { db: { query, insert } }

    const result = await (_enqueueCadenceJob as unknown as ConvexFunction)._handler(ctx, {
      user_id: 'fleet-julian',
      person_id: PERSON_ID,
    })

    expect(result).toBe(true)
    expect(insert).toHaveBeenCalledOnce()
  })
})
