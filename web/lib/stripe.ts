import Stripe from 'stripe'

let stripeClient: Stripe | null = null

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  if (process.env.NODE_ENV === 'production' && key.startsWith('sk_test_')) {
    console.warn('[WARN] Using Stripe test keys in production. Set a live STRIPE_SECRET_KEY before accepting real payments.')
  }
  stripeClient ??= new Stripe(key)
  return stripeClient
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, property, receiver) {
    return Reflect.get(getStripeClient() as any, property, receiver)
  },
})

export function stripeLog(message: string) {
  console.log(`[Stripe] ${new Date().toISOString()} ${message}`)
}
