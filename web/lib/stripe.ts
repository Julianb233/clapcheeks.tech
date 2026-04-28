import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY is not set — Stripe calls will fail')
}

// Warn about test keys in production (don't throw — breaks build)
if (process.env.NODE_ENV === 'production' && process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  console.warn('[WARN] Using Stripe test keys in production. Set a live STRIPE_SECRET_KEY before accepting real payments.')
}

// Pin apiVersion so web/ and api/ serialize identical webhook + request shapes.
// Must match api/routes/stripe.js + api/routes/referral.js. Update all together.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

export function stripeLog(message: string) {
  console.log(`[Stripe] ${new Date().toISOString()} ${message}`)
}
