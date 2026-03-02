import type Stripe from 'stripe'
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function isEventProcessed(eventId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('stripe_events')
    .select('event_id')
    .eq('event_id', eventId)
    .single()
  return !!data
}

async function markEventProcessed(eventId: string, eventType: string) {
  await supabaseAdmin.from('stripe_events').insert({
    event_id: eventId,
    event_type: eventType,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Idempotency: skip already-processed events
  if (await isEventProcessed(event.id)) {
    return NextResponse.json({ received: true })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.client_reference_id || session.metadata?.user_id
      if (userId) {
        await supabaseAdmin.from('profiles').update({
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          plan: session.metadata?.plan || 'base',
          subscription_status: 'active',
        }).eq('id', userId)
      }
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      // Determine plan from price lookup key (format: plan_interval e.g. "pro_monthly")
      const lookupKey = subscription.items.data[0]?.price?.lookup_key || ''
      const planFromKey = lookupKey.split('_')[0] || 'base'
      const validPlans = ['base', 'starter', 'pro', 'elite']
      const plan = validPlans.includes(planFromKey) ? planFromKey : 'base'

      await supabaseAdmin.from('profiles').update({
        subscription_status: subscription.status,
        plan,
      }).eq('stripe_customer_id', customerId)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      await supabaseAdmin.from('profiles').update({
        subscription_status: 'inactive',
        plan: 'base',
      }).eq('stripe_customer_id', customerId)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      await supabaseAdmin.from('profiles').update({
        subscription_status: 'past_due',
      }).eq('stripe_customer_id', customerId)
      break
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      // Clear past_due status on successful payment
      await supabaseAdmin.from('profiles').update({
        subscription_status: 'active',
      }).eq('stripe_customer_id', customerId)
      break
    }
  }

  // Mark event as processed for idempotency
  await markEventProcessed(event.id, event.type)

  return NextResponse.json({ received: true })
}
