import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: 'No billing account found' }, { status: 404 })
    }

    // Get latest unpaid invoice and retry
    const invoices = await stripe.invoices.list({
      customer: profile.stripe_customer_id,
      status: 'open',
      limit: 1,
    })

    if (invoices.data.length === 0) {
      return NextResponse.json({ error: 'No open invoices found' }, { status: 404 })
    }

    await stripe.invoices.pay(invoices.data[0].id)

    return NextResponse.json({ ok: true, message: 'Payment retry initiated' })
  } catch (error) {
    console.error('[BILLING] Retry payment error:', error)
    return NextResponse.json(
      { error: 'Payment retry failed. Please update your payment method.' },
      { status: 500 }
    )
  }
}
