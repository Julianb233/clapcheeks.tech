import { supabase } from '../server.js'

const PLAN_HIERARCHY = { free: 0, starter: 1, pro: 2, elite: 3 }

export function requirePlan(minPlan) {
  return async (req, res, next) => {
    try {
      // Support both JWT-authenticated (req.user.id) and agent-token (req.userId)
      const userId = req.user?.id || req.userId
      if (!userId) return res.status(401).json({ error: 'Unauthorized' })

      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier, subscription_status, access_expires_at, trial_end')
        .eq('id', userId)
        .single()

      const userPlan = profile?.subscription_tier || 'free'
      const now = new Date()

      // Check if grace period has expired for past_due accounts
      if (profile?.subscription_status === 'past_due' && profile?.access_expires_at) {
        if (new Date(profile.access_expires_at) < now) {
          return res.status(402).json({
            error: 'Payment required',
            message: 'Your payment failed and the grace period has expired. Please update your payment method at clapcheeks.tech/billing',
          })
        }
      }

      // Check if trial has expired
      if (profile?.subscription_status === 'trialing' && profile?.trial_end) {
        if (new Date(profile.trial_end) < now) {
          return res.status(402).json({
            error: 'Trial expired',
            message: 'Your trial has expired. Please subscribe to continue at clapcheeks.tech/billing',
          })
        }
      }

      if ((PLAN_HIERARCHY[userPlan] ?? 0) < (PLAN_HIERARCHY[minPlan] ?? 1)) {
        return res.status(403).json({
          error: 'Plan required',
          message: `This feature requires ${minPlan} plan or higher. Upgrade at clapcheeks.tech/billing`,
          required_plan: minPlan,
          current_plan: userPlan,
        })
      }

      next()
    } catch (err) {
      console.error('[requirePlan] Error:', err)
      return res.status(500).json({ error: 'Failed to verify subscription' })
    }
  }
}
