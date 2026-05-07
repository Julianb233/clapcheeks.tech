import type Stripe from 'stripe'
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

export const runtime = 'nodejs'

// AI-9537: subscriptions parallel-write to Supabase (profiles) + Convex
// (subscriptions). Reads continue from Supabase profiles for now; Convex
// reads come online once parity is verified.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ConvexPlan = 'starter' | 'pro' | 'elite'

function normalizePlanForConvex(tier: string | undefined | null): ConvexPlan | null {
  if (!tier) return null
  if (tier === 'starter' || tier === 'pro' || tier === 'elite') return tier
  return null
}

async function mirrorSubscriptionToConvex(args: {
  user_id: string
  stripe_subscription_id?: string | null
  plan: string | null | undefined
  status: string
  current_period_start?: number | null
  current_period_end?: number | null
}): Promise<void> {
  const plan = normalizePlanForConvex(args.plan)
  if (!plan) return
  try {
    const convex = getConvexServerClient()
    await convex.mutation(api.billing.upsertSubscription, {
      user_id: args.user_id,
      stripe_subscription_id: args.stripe_subscription_id ?? undefined,
      plan,
      status: args.status,
      current_period_start: args.current_period_start ?? undefined,
      current_period_end: args.current_period_end ?? undefined,
    })
  } catch (err) {
    console.error('[AI-9537] convex subscription mirror failed:', err)
  }
}

async function mirrorSubscriptionStatusByStripeId(
  stripeSubscriptionId: string,
  status: string,
): Promise<void> {
  try {
    const convex = getConvexServerClient()
    await convex.mutation(api.billing.updateStatusByStripeId, {
      stripe_subscription_id: stripeSubscriptionId,
      status,
    })
  } catch (err) {
    console.error('[AI-9537] convex subscription status mirror failed:', err)
  }
}

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

  if (await isEventProcessed(event.id)) {
    return NextResponse.json({ received: true })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.client_reference_id || session.metadata?.user_id
      if (userId) {
        const tierValue = session.metadata?.plan || 'base'
        await supabaseAdmin.from('profiles').update({
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          subscription_tier: tierValue,
          subscription_status: 'active',
        }).eq('id', userId)
        // AI-9537: parallel-write to Convex subscriptions.
        await mirrorSubscriptionToConvex({
          user_id: userId,
          stripe_subscription_id: (session.subscription as string) || null,
          plan: tierValue,
          status: 'active',
        })
      }
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      const lookupKey = subscription.items.data[0]?.price?.lookup_key || ''
      const planFromKey = lookupKey.split('_')[0] || 'base'
      const validPlans = ['base', 'starter', 'pro', 'elite']
      const tier = validPlans.includes(planFromKey) ? planFromKey : 'base'

      const effectiveTier = subscription.status === 'trialing' ? 'pro' : tier

      await supabaseAdmin.from('profiles').update({
        subscription_status: subscription.status,
        subscription_tier: effectiveTier,
        trial_end: subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null,
      }).eq('stripe_customer_id', customerId)

      // AI-9537: parallel-write to Convex subscriptions.
      try {
        const { data: linkedProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()
        if (linkedProfile?.id) {
          const cps = (subscription as any).current_period_start as number | null | undefined
          const cpe = (subscription as any).current_period_end as number | null | undefined
          await mirrorSubscriptionToConvex({
            user_id: linkedProfile.id,
            stripe_subscription_id: subscription.id,
            plan: effectiveTier,
            status: subscription.status,
            current_period_start: cps ? cps * 1000 : null,
            current_period_end: cpe ? cpe * 1000 : null,
          })
        } else {
          await mirrorSubscriptionStatusByStripeId(subscription.id, subscription.status)
        }
      } catch (err) {
        console.error('[AI-9537] subscription.updated convex mirror error:', err)
      }
      break
    }

    case 'customer.subscription.trial_will_end': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      const { data: trialProfile } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('stripe_customer_id', customerId)
        .single()

      console.log(`[BILLING] Trial ending soon for ${trialProfile?.email || customerId} — ends ${subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : 'unknown'}`)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      await supabaseAdmin.from('profiles').update({
        subscription_status: 'canceled',
        subscription_tier: 'free',
        access_expires_at: null,
        trial_end: null,
      }).eq('stripe_customer_id', customerId)
      // AI-9537: mirror status flip into Convex.
      await mirrorSubscriptionStatusByStripeId(subscription.id, 'canceled')
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      const graceExpiry = new Date()
      graceExpiry.setDate(graceExpiry.getDate() + 7)

      const { data: failedProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, email')
        .eq('stripe_customer_id', customerId)
        .single()

      if (failedProfile) {
        await supabaseAdmin.from('profiles').update({
          subscription_status: 'past_due',
          access_expires_at: graceExpiry.toISOString(),
        }).eq('id', failedProfile.id)

        console.log(`[BILLING] Payment failed for ${failedProfile.email} — access expires ${graceExpiry.toISOString()}`)
      }
      break
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      await supabaseAdmin.from('profiles').update({
        subscription_status: 'active',
        access_expires_at: null,
      }).eq('stripe_customer_id', customerId)
      break
    }
  }

  await markEventProcessed(event.id, event.type)

  return NextResponse.json({ received: true })
}
