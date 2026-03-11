import { Router } from 'express'
import { supabase } from '../server.js'
import { sendWelcomeEmail, processEmailSequence } from '../email/sequence.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const router = Router()

// POST /email/welcome — trigger welcome email for a new user
// Called by Supabase Database Webhook on auth.users INSERT
router.post('/welcome', asyncHandler(async (req, res) => {
  const { email, id } = req.body?.record || req.body || {}
  if (!email) return res.status(400).json({ error: 'Missing email' })

  // Try to resolve userId for dedup tracking
  let userId = id
  if (!userId) {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single()
    userId = data?.id
  }

  const result = await sendWelcomeEmail(email, userId)
  res.json({ sent: true, result })
}))

// POST /email/sequence — process onboarding sequence for all users
// Called by daily cron job
router.post('/sequence', asyncHandler(async (req, res) => {
  // Fetch all users with their profile and agent activity
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, created_at, subscription_tier')

  if (error) return res.status(500).json({ error: error.message })

  const results = []
  for (const profile of profiles) {
    // Check for agent activity (any token usage = agent connected)
    const { count } = await supabase
      .from('clapcheeks_agent_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id)

    const hasAgentActivity = count > 0
    const result = await processEmailSequence(
      profile.id,
      profile.email,
      profile.created_at,
      hasAgentActivity,
      profile.subscription_tier || 'free',
    )

    if (result) results.push({ email: profile.email, result })
  }

  res.json({ processed: profiles.length, sent: results.length, results })
}))

// GET /email/unsubscribe — one-click unsubscribe from onboarding emails
router.get('/unsubscribe', asyncHandler(async (req, res) => {
  const { email } = req.query
  if (!email) return res.status(400).send('Missing email parameter')

  // Look up user by email
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()

  if (profile) {
    await supabase
      .from('email_unsubscribes')
      .upsert({ user_id: profile.id })
  }

  // Always show success page (don't leak whether email exists)
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title></head>
<body style="margin:0;padding:60px 20px;background:#0f0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e4e4e7;text-align:center;">
  <h1 style="color:#8b5cf6;font-size:28px;">Clap Cheeks</h1>
  <p style="font-size:18px;margin:24px 0;">You've been unsubscribed.</p>
  <p style="color:#a1a1aa;font-size:14px;">You won't receive any more onboarding emails from us.</p>
  <a href="https://clapcheeks.tech" style="display:inline-block;margin-top:24px;color:#8b5cf6;text-decoration:underline;">Back to clapcheeks.tech</a>
</body></html>`)
}))
