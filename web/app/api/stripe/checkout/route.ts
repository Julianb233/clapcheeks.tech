import type Stripe from 'stripe'
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

const ADDON_PRICES: Record<string, { name: string; amount: number }> = {
  'profile-doctor': { name: 'Profile Doctor', amount: 1500 },
  'super-opener': { name: 'Super Opener 10-pack', amount: 2700 },
  'turbo-session': { name: 'Turbo Session', amount: 900 },
  'voice-calibration': { name: 'Voice Calibration', amount: 9700 },
  // Legacy underscore keys for backwards compat
  profile_doctor: { name: 'Profile Doctor', amount: 1500 },
  super_opener_10: { name: 'Super Opener 10-pack', amount: 2700 },
  turbo_session: { name: 'Turbo Session', amount: 900 },
  voice_calibration: { name: 'Voice Calibration', amount: 9700 },
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { plan, addons, annual } = body as {
      plan: 'base' | 'starter' | 'pro' | 'elite'
      addons?: string[]
      annual?: boolean
    }

    const validPlans = ['base', 'starter', 'pro', 'elite']
    if (!plan || !validPlans.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    // Check for existing Stripe customer
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    const interval = annual ? 'annual' : 'monthly'
    const lookupKey = `${plan}_${interval}`

    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })
    if (!prices.data.length) {
      return NextResponse.json({ error: 'Price not found' }, { status: 404 })
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price: prices.data[0].id,
        quantity: 1,
      },
    ]

    if (addons && addons.length > 0) {
      for (const addonKey of addons) {
        const addon = ADDON_PRICES[addonKey]
        if (addon) {
          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: { name: addon.name },
              unit_amount: addon.amount,
            },
            quantity: 1,
          })
        }
      }
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/home?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/pricing`,
      metadata: { plan, user_id: user.id },
      subscription_data: {
        trial_period_days: 7,
      },
    }

    // Reuse existing Stripe customer or pre-fill email for new ones
    if (profile?.stripe_customer_id) {
      sessionParams.customer = profile.stripe_customer_id
    } else {
      sessionParams.client_reference_id = user.id
      sessionParams.customer_email = user.email!
    }

    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `checkout_${user.id}_${plan}_${randomUUID()}`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
