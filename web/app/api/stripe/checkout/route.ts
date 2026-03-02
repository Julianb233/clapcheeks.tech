import type Stripe from 'stripe'
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

const ADDON_PRICES: Record<string, { name: string; amount: number }> = {
  profile_doctor: { name: 'Profile Doctor', amount: 1500 },
  super_opener_10: { name: 'Super Opener 10-pack', amount: 2700 },
  turbo_session: { name: 'Turbo Session', amount: 900 },
  voice_calibration: { name: 'Voice Calibration', amount: 9700 },
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { plan, addons } = body as { plan: 'base' | 'elite'; addons?: string[] }

    if (!plan || !['base', 'elite'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const lookupKey = plan === 'base' ? 'base_monthly' : 'elite_monthly'

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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/home?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/pricing`,
      client_reference_id: user.id,
      metadata: { plan, user_id: user.id },
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
