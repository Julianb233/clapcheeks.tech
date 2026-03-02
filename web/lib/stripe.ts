import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY is not set — Stripe calls will fail')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
