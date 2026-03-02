import { Router } from 'express'
import Stripe from 'stripe'
import { supabase } from '../server.js'

export const router = Router()

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || '')
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!jwt) return res.status(401).json({ error: 'Missing auth token' })
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })
  req.user = user
  next()
}

// GET /referral/code — get user's referral code + stats
router.get('/code', requireAuth, async (req, res) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('referral_code, free_months_earned')
    .eq('id', req.user.id)
    .single()

  if (error || !profile) return res.status(404).json({ error: 'Profile not found' })

  const { count: conversions } = await supabase
    .from('clapcheeks_referrals')
    .select('*', { count: 'exact', head: true })
    .eq('referral_code', profile.referral_code)
    .in('status', ['converted', 'rewarded'])

  res.json({
    code: profile.referral_code,
    referral_url: `https://clapcheeks.tech?ref=${profile.referral_code}`,
    conversions: conversions || 0,
    months_earned: profile.free_months_earned || 0,
  })
})

// POST /referral/apply — apply a referral code at signup
router.post('/apply', requireAuth, async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: 'Missing referral code' })

  // Find the referrer by code
  const { data: referrer, error: refErr } = await supabase
    .from('profiles')
    .select('id, referral_code')
    .eq('referral_code', code)
    .single()

  if (refErr || !referrer) return res.status(404).json({ error: 'Invalid referral code' })
  if (referrer.id === req.user.id) return res.status(400).json({ error: 'Cannot refer yourself' })

  // Check if user already used a referral
  const { data: existing } = await supabase
    .from('profiles')
    .select('referred_by')
    .eq('id', req.user.id)
    .single()

  if (existing?.referred_by) return res.status(400).json({ error: 'Referral already applied' })

  // Mark this user as referred
  await supabase
    .from('profiles')
    .update({ referred_by: code })
    .eq('id', req.user.id)

  // Create referral record
  const { error: insertErr } = await supabase
    .from('clapcheeks_referrals')
    .insert({
      referrer_id: referrer.id,
      referred_id: req.user.id,
      referral_code: code,
      status: 'converted',
      converted_at: new Date().toISOString(),
    })

  if (insertErr) return res.status(500).json({ error: insertErr.message })

  // Award 1 free month to referrer
  await supabase.rpc('increment_free_months', { user_id: referrer.id })
    .then(async ({ error: rpcErr }) => {
      if (rpcErr) {
        // Fallback: manual increment
        const { data: rProfile } = await supabase
          .from('profiles')
          .select('free_months_earned')
          .eq('id', referrer.id)
          .single()
        await supabase
          .from('profiles')
          .update({ free_months_earned: (rProfile?.free_months_earned || 0) + 1 })
          .eq('id', referrer.id)
      }
    })

  // Update referral status to rewarded
  await supabase
    .from('clapcheeks_referrals')
    .update({ status: 'rewarded', rewarded_at: new Date().toISOString() })
    .eq('referrer_id', referrer.id)
    .eq('referred_id', req.user.id)

  // Try to apply Stripe credit if customer exists
  try {
    const { data: referrerProfile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', referrer.id)
      .single()

    if (referrerProfile?.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
      const stripe = getStripe()
      // Apply a credit balance (negative invoice item = credit)
      await stripe.invoiceItems.create({
        customer: referrerProfile.stripe_customer_id,
        amount: -2999, // credit for ~1 month (adjust to actual price)
        currency: 'usd',
        description: 'Referral reward: 1 free month',
      })
    }
  } catch (stripeErr) {
    console.error('Stripe credit failed (non-fatal):', stripeErr.message)
  }

  res.json({ success: true, message: 'Referral applied, referrer rewarded' })
})

// GET /referral/stats — full referral list with status
router.get('/stats', requireAuth, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('referral_code, free_months_earned')
    .eq('id', req.user.id)
    .single()

  if (!profile) return res.status(404).json({ error: 'Profile not found' })

  const { data: referrals } = await supabase
    .from('clapcheeks_referrals')
    .select('id, referred_id, status, converted_at, rewarded_at, created_at')
    .eq('referral_code', profile.referral_code)
    .order('created_at', { ascending: false })

  const list = referrals || []

  res.json({
    code: profile.referral_code,
    referral_url: `https://clapcheeks.tech?ref=${profile.referral_code}`,
    total: list.length,
    converted: list.filter(r => r.status === 'converted' || r.status === 'rewarded').length,
    months_earned: profile.free_months_earned || 0,
    referrals: list,
  })
})
