import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY is not set — Stripe calls will fail')
}

// Guard against test keys in production
if (process.env.NODE_ENV === 'production' && process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('[FATAL] Using Stripe test keys in production is not allowed. Set a live STRIPE_SECRET_KEY.')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
