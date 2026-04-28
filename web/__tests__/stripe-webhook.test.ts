// AI-8768: Stripe webhook coverage for web/app/api/stripe/webhook/route.ts.
//
// Uses vitest with vi.mock() to swap @supabase/supabase-js and @/lib/stripe
// so we can assert which DB writes happen and inject a controllable Stripe
// instance. The route handler is invoked directly with a real Web-API
// Request whose body is signed with Stripe's generateTestHeaderString.
//
// Run with:  npm test -- stripe-webhook
// Or all:    npm test

import { describe, test, expect, beforeEach, vi } from 'vitest'
import Stripe from 'stripe'

const STRIPE_WEBHOOK_SECRET = 'whsec_test_clapcheeks_8768'

// Set env BEFORE imports of code that reads them at module-load time
process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_clapcheeks'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'

// ---------- Spy state (reset per test) ----------
type DbWrite = { table: string; op: 'insert' | 'update'; payload: any; filter?: { field: string; value: any } }
const dbWrites: DbWrite[] = []
let processedEventIds = new Set<string>()

function makeQuery(table: string) {
  let _filterField: string | null = null
  let _filterValue: any = null
  return {
    select(_cols: string) {
      return {
        eq(field: string, value: any) {
          _filterField = field
          _filterValue = value
          return {
            single: async () => {
              if (table === 'stripe_events' && _filterField === 'event_id') {
                if (processedEventIds.has(_filterValue)) {
                  return { data: { event_id: _filterValue }, error: null }
                }
                return { data: null, error: null }
              }
              if (table === 'profiles') {
                return {
                  data: { id: 'user-from-customer', email: 'test@clapcheeks.tech' },
                  error: null,
                }
              }
              return { data: null, error: null }
            },
            limit: async (_n: number) => ({ data: [], error: null }),
          }
        },
      }
    },
    insert(payload: any) {
      dbWrites.push({ table, op: 'insert', payload })
      if (table === 'stripe_events' && payload?.event_id) {
        processedEventIds.add(payload.event_id)
      }
      return Promise.resolve({ data: null, error: null })
    },
    update(payload: any) {
      return {
        eq(field: string, value: any) {
          dbWrites.push({ table, op: 'update', payload, filter: { field, value } })
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }
}

// Real Stripe instance — used both as the mock for @/lib/stripe and to
// generate signed payloads that the route can verify.
const realStripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQuery(table),
  }),
}))

vi.mock('@/lib/stripe', () => ({
  stripe: realStripe,
  stripeLog: () => {},
}))

// Now import the route — bindings above must be in place first.
const { POST } = await import('../app/api/stripe/webhook/route')

// ---------- Helpers ----------
function buildSignedRequest(eventBody: any) {
  const payload = typeof eventBody === 'string' ? eventBody : JSON.stringify(eventBody)
  const header = realStripe.webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET,
  })
  return new Request('https://clapcheeks.tech/api/stripe/webhook', {
    method: 'POST',
    body: payload,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': header,
    },
  }) as any
}

function sampleEvent(type: string, dataObject: any, opts: { id?: string } = {}) {
  return {
    id: opts.id || `evt_test_${type}_${Math.random().toString(36).slice(2, 8)}`,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    type,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object: dataObject },
  }
}

beforeEach(() => {
  dbWrites.length = 0
  processedEventIds = new Set()
})

describe('web Stripe webhook', () => {
  test('rejects bad signature with 400', async () => {
    const payload = JSON.stringify(sampleEvent('invoice.paid', {}))
    const req = new Request('https://clapcheeks.tech/api/stripe/webhook', {
      method: 'POST',
      body: payload,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=deadbeef',
      },
    }) as any
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(dbWrites.length).toBe(0)
  })

  test('invoice.paid clears past_due and sets active', async () => {
    const evt = sampleEvent('invoice.paid', { id: 'in_123', customer: 'cus_active' })
    const res = await POST(buildSignedRequest(evt))
    expect(res.status).toBe(200)

    const update = dbWrites.find(w => w.table === 'profiles' && w.op === 'update')
    expect(update).toBeTruthy()
    expect(update!.payload.subscription_status).toBe('active')
    expect(update!.payload.access_expires_at).toBe(null)
    expect(update!.filter!.field).toBe('stripe_customer_id')
    expect(update!.filter!.value).toBe('cus_active')

    expect(dbWrites.some(w => w.table === 'stripe_events' && w.op === 'insert')).toBe(true)
  })

  test('customer.subscription.deleted marks profile canceled + free', async () => {
    const evt = sampleEvent('customer.subscription.deleted', {
      id: 'sub_X', customer: 'cus_cancelled', items: { data: [] },
    })
    const res = await POST(buildSignedRequest(evt))
    expect(res.status).toBe(200)

    const update = dbWrites.find(w => w.table === 'profiles' && w.op === 'update')
    expect(update).toBeTruthy()
    expect(update!.payload.subscription_status).toBe('canceled')
    expect(update!.payload.subscription_tier).toBe('free')
    expect(update!.payload.access_expires_at).toBe(null)
    expect(update!.filter!.value).toBe('cus_cancelled')
  })

  test('customer.subscription.updated downgrade applies plan from lookup_key', async () => {
    const evt = sampleEvent('customer.subscription.updated', {
      id: 'sub_DOWN',
      customer: 'cus_downgrade',
      status: 'active',
      trial_end: null,
      items: { data: [{ price: { lookup_key: 'starter_monthly' } }] },
    })
    const res = await POST(buildSignedRequest(evt))
    expect(res.status).toBe(200)

    const update = dbWrites.find(w => w.table === 'profiles' && w.op === 'update')
    expect(update).toBeTruthy()
    expect(update!.payload.subscription_tier).toBe('starter')
    expect(update!.payload.subscription_status).toBe('active')
  })

  test('customer.subscription.updated trialing grants pro tier regardless of lookup_key', async () => {
    const evt = sampleEvent('customer.subscription.updated', {
      id: 'sub_TRIAL',
      customer: 'cus_trial',
      status: 'trialing',
      trial_end: 9999999999,
      items: { data: [{ price: { lookup_key: 'base_monthly' } }] },
    })
    const res = await POST(buildSignedRequest(evt))
    expect(res.status).toBe(200)

    const update = dbWrites.find(w => w.table === 'profiles' && w.op === 'update')
    expect(update).toBeTruthy()
    expect(update!.payload.subscription_tier).toBe('pro')
    expect(update!.payload.subscription_status).toBe('trialing')
    expect(update!.payload.trial_end).toBeTruthy()
  })

  test('invoice.payment_failed sets past_due with 7-day grace', async () => {
    const evt = sampleEvent('invoice.payment_failed', { id: 'in_FAIL', customer: 'cus_pastdue' })
    const res = await POST(buildSignedRequest(evt))
    expect(res.status).toBe(200)

    const update = dbWrites.find(
      w => w.table === 'profiles' && w.op === 'update' && w.filter!.field === 'id',
    )
    expect(update).toBeTruthy()
    expect(update!.payload.subscription_status).toBe('past_due')
    expect(update!.payload.access_expires_at).toBeTruthy()

    const expiry = new Date(update!.payload.access_expires_at).getTime()
    const expected = Date.now() + 7 * 24 * 60 * 60 * 1000
    expect(Math.abs(expiry - expected)).toBeLessThan(60_000)
  })

  test('checkout.session.completed sets tier from metadata.plan', async () => {
    const evt = sampleEvent('checkout.session.completed', {
      id: 'cs_TEST',
      customer: 'cus_new',
      subscription: 'sub_new',
      client_reference_id: 'user-abc',
      metadata: { plan: 'pro' },
    })
    const res = await POST(buildSignedRequest(evt))
    expect(res.status).toBe(200)

    const update = dbWrites.find(w => w.table === 'profiles' && w.op === 'update')
    expect(update).toBeTruthy()
    expect(update!.payload.subscription_tier).toBe('pro')
    expect(update!.payload.subscription_status).toBe('active')
    expect(update!.payload.stripe_customer_id).toBe('cus_new')
    expect(update!.payload.stripe_subscription_id).toBe('sub_new')
    expect(update!.filter!.value).toBe('user-abc')
  })

  test('unknown event type returns 200 noop', async () => {
    const evt = sampleEvent('charge.dispute.funds_withdrawn', { id: 'dp_X', customer: 'cus_x' })
    const res = await POST(buildSignedRequest(evt))
    expect(res.status).toBe(200)

    expect(
      dbWrites.filter(w => w.table === 'profiles' && w.op === 'update').length,
    ).toBe(0)
    expect(dbWrites.some(w => w.table === 'stripe_events' && w.op === 'insert')).toBe(true)
  })

  test('idempotency: redelivered event_id is skipped', async () => {
    const evt = sampleEvent('invoice.paid', {
      id: 'in_DUP', customer: 'cus_dup',
    }, { id: 'evt_redelivered_xyz' })

    const res1 = await POST(buildSignedRequest(evt))
    expect(res1.status).toBe(200)
    const updatesAfterFirst = dbWrites.filter(
      w => w.table === 'profiles' && w.op === 'update',
    ).length
    expect(updatesAfterFirst).toBe(1)

    const res2 = await POST(buildSignedRequest(evt))
    expect(res2.status).toBe(200)
    const updatesAfterSecond = dbWrites.filter(
      w => w.table === 'profiles' && w.op === 'update',
    ).length
    expect(updatesAfterSecond).toBe(1)
  })

  test('customer.subscription.trial_will_end logs but does not write profile', async () => {
    const evt = sampleEvent('customer.subscription.trial_will_end', {
      id: 'sub_TWE',
      customer: 'cus_twe',
      trial_end: 9999999999,
    })
    const res = await POST(buildSignedRequest(evt))
    expect(res.status).toBe(200)

    const updates = dbWrites.filter(w => w.table === 'profiles' && w.op === 'update')
    expect(updates.length).toBe(0)
  })
})
