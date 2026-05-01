import { Router } from 'express'
import express from 'express'
import Stripe from 'stripe'
import { supabase } from '../server.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const router = Router()

function getStripe() {
  // Pin apiVersion so api/ and web/ serialize identical webhook + request shapes.
  // Must match web/lib/stripe.ts. Update both at the same time.
  return new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2026-02-25.clover',
  })
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!jwt) return res.status(401).json({ error: 'Missing auth token' })
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })
  req.user = user
  next()
}

// POST /stripe/webhook — Stripe sends events here
router.post('/webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification in dev')
    return res.json({ received: true })
  }

  let event
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret)
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message)
    return res.status(400).json({ error: 'Invalid signature' })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const userId = session.metadata?.user_id
    const tier = session.metadata?.tier || 'starter'
    if (userId) {
      await supabase.from('profiles').update({
        subscription_tier: tier,
        stripe_customer_id: session.customer,
      }).eq('id', userId)
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer
    await supabase.from('profiles').update({ subscription_tier: 'free' }).eq('stripe_customer_id', customerId)
  }

  res.json({ received: true })
}))

// POST /stripe/checkout — create checkout session
router.post('/checkout', requireAuth, asyncHandler(async (req, res) => {
  const { tier } = req.body
  const priceIds = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    elite: process.env.STRIPE_PRICE_ELITE,
  }
  const priceId = priceIds[tier]
  if (!priceId) return res.status(400).json({ error: 'Invalid tier or price not configured' })

  const session = await getStripe().checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.WEB_URL}/dashboard?upgraded=true`,
    cancel_url: `${process.env.WEB_URL}/pricing`,
    metadata: { user_id: req.user.id, tier },
  })

  res.json({ url: session.url })
}))
