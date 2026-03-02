import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  // Verify this is called internally (from webhook)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { customer_id } = await request.json()

  if (!customer_id) {
    return NextResponse.json({ error: 'Missing customer_id' }, { status: 400 })
  }

  // Find the user by stripe customer ID
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, referred_by')
    .eq('stripe_customer_id', customer_id)
    .single()

  if (!profile?.referred_by) {
    return NextResponse.json({ message: 'No referral to convert' })
  }

  // Find the referral record
  const { data: referral } = await supabaseAdmin
    .from('clapcheeks_referrals')
    .select('id, referrer_id, status')
    .eq('referred_id', profile.id)
    .eq('status', 'pending')
    .single()

  if (!referral) {
    return NextResponse.json({ message: 'No pending referral found' })
  }

  // Get referrer's stripe customer ID
  const { data: referrerProfile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', referral.referrer_id)
    .single()

  if (referrerProfile?.stripe_customer_id) {
    // Apply 1 month credit to referrer's Stripe account
    const referrerSub = await stripe.subscriptions.list({
      customer: referrerProfile.stripe_customer_id,
      limit: 1,
    })
    const monthlyAmount = referrerSub.data[0]?.items.data[0]?.price.unit_amount || 9700

    await stripe.customers.createBalanceTransaction(
      referrerProfile.stripe_customer_id,
      {
        amount: -monthlyAmount,
        currency: 'usd',
        description: 'Referral credit - 1 free month',
      }
    )
  }

  // Update referral status
  await supabaseAdmin
    .from('clapcheeks_referrals')
    .update({
      status: 'credited',
      credited_at: new Date().toISOString(),
    })
    .eq('id', referral.id)

  // Increment referrer's credit count
  await supabaseAdmin.rpc('increment_referral_credits', {
    p_user_id: referral.referrer_id,
  })

  return NextResponse.json({ success: true })
}
