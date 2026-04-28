// AI-8768: Stripe webhook + checkout coverage for api/routes/stripe.js.
//
// Strategy: vi.mock the supabase client exported from server.js so DB
// writes are spy-able. Construct a real express app, mount the router,
// and POST to /webhook with a valid Stripe signature generated from a
// known test secret. Use supertest to drive HTTP.

import { describe, test, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import Stripe from 'stripe'

const STRIPE_WEBHOOK_SECRET = 'whsec_test_clapcheeks_api_8768'
process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_clapcheeks'
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'svc'
process.env.WEB_URL = 'https://clapcheeks.tech'

// ---------- Supabase spy ----------
const dbWrites = []

function makeQuery(table) {
  return {
    select() { return this },
    eq(field, value) {
      this._field = field
      this._value = value
      return this
    },
    single: async () => ({ data: null, error: null }),
    insert(payload) {
      dbWrites.push({ table, op: 'insert', payload })
      return Promise.resolve({ data: null, error: null })
    },
    update(payload) {
      return {
        eq(field, value) {
          dbWrites.push({ table, op: 'update', payload, filter: { field, value } })
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }
}

const supabaseSpy = {
  from: (table) => makeQuery(table),
  auth: {
    getUser: async (jwt) => {
      if (jwt === 'good_jwt') {
        return { data: { user: { id: 'user-checkout-123' } }, error: null }
      }
      return { data: { user: null }, error: { message: 'invalid' } }
    },
  },
}

// Mock the server.js module so the router gets our spy as `supabase`.
vi.mock('../server.js', () => ({
  supabase: supabaseSpy,
}))

// Now import the router (after the mock is registered).
const { router } = await import('../routes/stripe.js')

// Build a real express app and mount the router.
function buildApp() {
  const app = express()
  // Note: the /webhook route uses express.raw() internally, so JSON
  // middleware must be applied AFTER (or scoped) so it doesn't consume
  // the raw body. The route file already declares its own raw parser, so
  // we just add JSON for the /checkout route here.
  app.use((req, res, next) => {
    if (req.path === '/webhook') return next()
    return express.json()(req, res, next)
  })
  app.use(router)
  return app
}

// Use a Stripe instance to mint signatures the route can verify.
const stripeForSigning = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
})

function signedHeader(payload) {
  return stripeForSigning.webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET,
  })
}

function sampleEvent(type, dataObject, opts = {}) {
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
})

describe('api Stripe webhook', () => {
  test('rejects bad signature with 400', async () => {
    const app = buildApp()
    const evt = sampleEvent('checkout.session.completed', {})
    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=baadc0de')
      .send(JSON.stringify(evt))

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid signature')
    expect(dbWrites.length).toBe(0)
  })

  test('checkout.session.completed updates profile tier + customer id', async () => {
    const app = buildApp()
    const evt = sampleEvent('checkout.session.completed', {
      id: 'cs_TEST',
      customer: 'cus_NEW_456',
      metadata: { user_id: 'user-checkout-123', tier: 'pro' },
    })
    const payload = JSON.stringify(evt)
    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', signedHeader(payload))
      .send(payload)

    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    const update = dbWrites.find(w => w.table === 'profiles' && w.op === 'update')
    expect(update).toBeTruthy()
    expect(update.payload.subscription_tier).toBe('pro')
    expect(update.payload.stripe_customer_id).toBe('cus_NEW_456')
    expect(update.filter.field).toBe('id')
    expect(update.filter.value).toBe('user-checkout-123')
  })

  test('checkout.session.completed defaults to starter tier when metadata.tier missing', async () => {
    const app = buildApp()
    const evt = sampleEvent('checkout.session.completed', {
      id: 'cs_TEST_2',
      customer: 'cus_default',
      metadata: { user_id: 'user-default-321' },
    })
    const payload = JSON.stringify(evt)
    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', signedHeader(payload))
      .send(payload)

    expect(res.status).toBe(200)
    const update = dbWrites.find(w => w.table === 'profiles' && w.op === 'update')
    expect(update.payload.subscription_tier).toBe('starter')
  })

  test('checkout.session.completed without user_id metadata is a noop', async () => {
    const app = buildApp()
    const evt = sampleEvent('checkout.session.completed', {
      id: 'cs_NO_META',
      customer: 'cus_orphan',
      metadata: {},
    })
    const payload = JSON.stringify(evt)
    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', signedHeader(payload))
      .send(payload)

    expect(res.status).toBe(200)
    expect(dbWrites.length).toBe(0)
  })

  test('customer.subscription.deleted sets profile to free by stripe_customer_id', async () => {
    const app = buildApp()
    const evt = sampleEvent('customer.subscription.deleted', {
      id: 'sub_X',
      customer: 'cus_CANCELLED',
    })
    const payload = JSON.stringify(evt)
    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', signedHeader(payload))
      .send(payload)

    expect(res.status).toBe(200)
    const update = dbWrites.find(w => w.table === 'profiles' && w.op === 'update')
    expect(update).toBeTruthy()
    expect(update.payload.subscription_tier).toBe('free')
    expect(update.filter.field).toBe('stripe_customer_id')
    expect(update.filter.value).toBe('cus_CANCELLED')
  })

  test('unknown event type returns 200 noop without DB writes', async () => {
    const app = buildApp()
    const evt = sampleEvent('charge.refunded', { id: 'ch_x', customer: 'cus_x' })
    const payload = JSON.stringify(evt)
    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', signedHeader(payload))
      .send(payload)

    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    expect(dbWrites.length).toBe(0)
  })

  test('webhook with no STRIPE_WEBHOOK_SECRET set returns 200 (dev mode)', async () => {
    const orig = process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_WEBHOOK_SECRET
    try {
      const app = buildApp()
      const evt = sampleEvent('checkout.session.completed', {})
      const res = await request(app)
        .post('/webhook')
        .set('content-type', 'application/json')
        // no signature header at all
        .send(JSON.stringify(evt))

      expect(res.status).toBe(200)
      expect(res.body.received).toBe(true)
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = orig
    }
  })
})

describe('api Stripe checkout', () => {
  test('rejects missing auth with 401', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/checkout')
      .send({ tier: 'pro' })
    expect(res.status).toBe(401)
  })

  test('rejects bad jwt with 401', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/checkout')
      .set('authorization', 'Bearer bad_jwt')
      .send({ tier: 'pro' })
    expect(res.status).toBe(401)
  })

  test('rejects unknown tier with 400', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/checkout')
      .set('authorization', 'Bearer good_jwt')
      .send({ tier: 'enterprise' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid tier/i)
  })

  test('rejects valid tier when STRIPE_PRICE_* not configured', async () => {
    // No STRIPE_PRICE_PRO env var set in this test process
    const app = buildApp()
    const res = await request(app)
      .post('/checkout')
      .set('authorization', 'Bearer good_jwt')
      .send({ tier: 'pro' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/price not configured/i)
  })
})
