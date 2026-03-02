import { Router } from 'express'
import express from 'express'
export const router = Router()

// POST /stripe/webhook — Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  // TODO: handle checkout.session.completed, customer.subscription.*
  res.json({ received: true })
})

// POST /stripe/checkout — create checkout session
router.post('/checkout', async (req, res) => {
  res.json({ url: 'https://checkout.stripe.com/stub' })
})
