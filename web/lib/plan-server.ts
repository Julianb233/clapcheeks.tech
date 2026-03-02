import { createClient } from '@/lib/supabase/server'
import { type PlanLevel, type PlanInfo, getPlanLimits } from '@/lib/plan'

export async function getPlanInfo(userId?: string): Promise<PlanInfo | null> {
  const supabase = await createClient()

  let uid = userId
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    uid = user.id
  }

  const { data: profile } = await supabase
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
