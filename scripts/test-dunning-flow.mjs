#!/usr/bin/env node
/**
 * Stripe Test Clock — Dunning Flow Simulation
 *
 * Creates a Stripe test clock and simulates the full dunning flow:
 *   1. Create customer with a card that will fail
 *   2. Create subscription
 *   3. Advance clock to trigger payment failure at day 3, 5, 7
 *   4. Verify webhook events are received
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/test-dunning-flow.mjs
 *
 * Prerequisites:
 *   - Stripe CLI for webhook forwarding: stripe listen --forward-to localhost:3000/api/stripe/webhook
 *   - A test price with lookup_key "base_monthly" in your Stripe account
 */

import Stripe from 'stripe'

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY
if (!STRIPE_KEY) {
  console.error('Set STRIPE_SECRET_KEY environment variable (use a test key)')
  process.exit(1)
}

const stripe = new Stripe(STRIPE_KEY)

// Stripe test card tokens that simulate failures
// See: https://docs.stripe.com/testing#declined-payments
const DECLINE_CARD_TOKEN = 'tok_chargeCustomerFail' // Generic decline

async function run() {
  console.log('\n=== Dunning Flow Test (Stripe Test Clock) ===\n')

  // 1. Create test clock
  const now = Math.floor(Date.now() / 1000)
  const testClock = await stripe.testHelpers.testClocks.create({
    frozen_time: now,
    name: `Dunning test ${new Date().toISOString()}`,
  })
  console.log(`Test clock created: ${testClock.id}`)

  // 2. Create customer attached to test clock
  const customer = await stripe.customers.create({
    email: 'dunning-test@clapcheeks.tech',
    name: 'Dunning Test User',
    test_clock: testClock.id,
  })
  console.log(`Customer created: ${customer.id}`)

  // 3. Attach a card that will decline
  // Use a token that always declines charges
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: DECLINE_CARD_TOKEN },
  })
  await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id })
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  })
  console.log(`Payment method attached: ${paymentMethod.id} (will decline)`)

  // 4. Create subscription
  // Find or create a test price
  let priceId
  const prices = await stripe.prices.list({ lookup_keys: ['base_monthly'], limit: 1 })
  if (prices.data.length > 0) {
    priceId = prices.data[0].id
  } else {
    console.log('No price with lookup_key "base_monthly" found. Creating test product + price...')
    const product = await stripe.products.create({ name: 'Base Plan (Test)' })
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 9700, // $97
      currency: 'usd',
      recurring: { interval: 'month' },
      lookup_key: 'base_monthly',
    })
    priceId = price.id
  }

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: {
      payment_method_types: ['card'],
      save_default_payment_method: 'on_subscription',
    },
    metadata: { plan: 'base', test_clock: 'true' },
  })
  console.log(`Subscription created: ${subscription.id} (status: ${subscription.status})`)

  // 5. Advance test clock to trigger retries
  const DAY = 86400 // seconds in a day

  console.log('\n--- Advancing to Day 3 (first retry) ---')
  await stripe.testHelpers.testClocks.advance(testClock.id, {
    frozen_time: now + (3 * DAY),
  })
  await waitForClockReady(testClock.id)
  console.log('Clock advanced to day 3. Check webhook logs for invoice.payment_failed event.')

  console.log('\n--- Advancing to Day 5 (second retry) ---')
  await stripe.testHelpers.testClocks.advance(testClock.id, {
    frozen_time: now + (5 * DAY),
  })
  await waitForClockReady(testClock.id)
  console.log('Clock advanced to day 5. Check webhook logs for invoice.payment_failed event.')

  console.log('\n--- Advancing to Day 7 (final retry) ---')
  await stripe.testHelpers.testClocks.advance(testClock.id, {
    frozen_time: now + (7 * DAY),
  })
  await waitForClockReady(testClock.id)
  console.log('Clock advanced to day 7. Check webhook logs for invoice.payment_failed event.')

  console.log('\n--- Advancing to Day 10 (subscription should be canceled) ---')
  await stripe.testHelpers.testClocks.advance(testClock.id, {
    frozen_time: now + (10 * DAY),
  })
  await waitForClockReady(testClock.id)

  // Check final subscription status
  const finalSub = await stripe.subscriptions.retrieve(subscription.id)
  console.log(`Final subscription status: ${finalSub.status}`)

  // List events for verification
  const events = await stripe.events.list({
    limit: 20,
    types: ['invoice.payment_failed', 'customer.subscription.deleted', 'invoice.paid'],
  })
  console.log('\n--- Recent Stripe Events ---')
  for (const event of events.data) {
    const invoice = event.data.object
    if (invoice.customer === customer.id) {
      console.log(`  ${event.type} — ${new Date(event.created * 1000).toISOString()} — attempt: ${invoice.attempt_count ?? 'n/a'}`)
    }
  }

  console.log('\n--- Cleanup ---')
  console.log(`Test clock ID: ${testClock.id}`)
  console.log(`Customer ID: ${customer.id}`)
  console.log('To clean up: stripe test_helpers test_clocks delete ' + testClock.id)
  console.log('\nDone! Verify:')
  console.log('  1. Dunning emails were sent (check Resend dashboard)')
  console.log('  2. Database shows past_due → canceled transition')
  console.log('  3. /billing page shows canceled state with re-subscribe CTA')
}

async function waitForClockReady(clockId) {
  for (let i = 0; i < 30; i++) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId)
    if (clock.status === 'ready') return
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  console.warn('Warning: Test clock did not reach ready status within 60s')
}

run().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
