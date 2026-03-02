import { Router } from 'express'
import { supabase } from '../server.js'
import { sendWelcomeEmail, processEmailSequence } from '../email/sequence.js'

export const router = Router()

// POST /email/welcome — trigger welcome email for a new user
// Called by Supabase Database Webhook on auth.users INSERT
router.post('/welcome', async (req, res) => {
  const { email } = req.body?.record || req.body || {}
  if (!email) return res.status(400).json({ error: 'Missing email' })

  const result = await sendWelcomeEmail(email)
  res.json({ sent: true, result })
})

// POST /email/sequence — process onboarding sequence for all users
// Called by daily cron job
router.post('/sequence', async (req, res) => {
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
})
