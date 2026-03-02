import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, subscription_status, stripe_customer_id, stripe_subscription_id')
      .eq('id', user.id)
      .single()

    if (!profile?.stripe_customer_id || !profile?.stripe_subscription_id) {
      return NextResponse.json({
        subscribed: false,
        plan: profile?.plan || 'base',
        status: profile?.subscription_status || 'inactive',
      })
    }

    const [subscription, invoices, upcoming] = await Promise.all([
      stripe.subscriptions.retrieve(profile.stripe_subscription_id, {
        expand: ['default_payment_method'],
      }),
      stripe.invoices.list({
        customer: profile.stripe_customer_id,
        limit: 5,
      }),
      stripe.invoices.createPreview({
        customer: profile.stripe_customer_id,
      }).catch(() => null),
    ])

    const paymentMethod = subscription.default_payment_method
    let card = null
    if (paymentMethod && typeof paymentMethod === 'object' && 'card' in paymentMethod) {
      const pm = paymentMethod as { card?: { brand: string; last4: string; exp_month: number; exp_year: number } }
      if (pm.card) {
        card = {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year,
        }
      }
    }

    const sub = subscription as any
    return NextResponse.json({
      subscribed: true,
      plan: profile.plan,
      status: profile.subscription_status,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      card,
      invoices: invoices.data.map((inv: Stripe.Invoice) => ({
        id: inv.id,
        date: inv.created,
        amount: inv.amount_paid,
        status: inv.status,
        pdf: inv.invoice_pdf,
      })),
      upcomingAmount: upcoming?.amount_due,
      upcomingDate: upcoming?.next_payment_attempt,
    })
  } catch (error) {
    console.error('Billing API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch billing data' },
      { status: 500 }
    )
  }
}
