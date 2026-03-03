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
        .select('subscription_tier')
        .eq('id', userId)
        .single()

      const userPlan = profile?.subscription_tier || 'free'
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
