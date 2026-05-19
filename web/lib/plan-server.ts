import { createClient } from '@/lib/convex/server'
import { type PlanLevel, type PlanInfo, getPlanLimits } from '@/lib/plan'

export async function getPlanInfo(userId?: string): Promise<PlanInfo | null> {
  const convex = await createClient()

  let uid = userId
  if (!uid) {
    const { data: { user } } = await convex.auth.getUser()
    if (!user) return null
    uid = user.id
  }

  const { data: profile } = await convex
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', uid)
    .single()

  if (!profile) return null

  const plan = (profile.subscription_tier || 'free') as PlanLevel
  return {
    plan,
    subscriptionStatus: profile.subscription_status || 'inactive',
    isActive: profile.subscription_status === 'active' || profile.subscription_status === 'trialing',
    limits: getPlanLimits(plan),
  }
}
