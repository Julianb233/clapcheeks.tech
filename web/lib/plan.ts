import { createClient } from '@/lib/supabase/server'

export type PlanLevel = 'base' | 'elite'

export interface PlanInfo {
  plan: PlanLevel
  subscriptionStatus: string
  isActive: boolean
  isElite: boolean
}

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
    .select('plan, subscription_status')
    .eq('id', uid)
    .single()

  if (!profile) return null

  return {
    plan: (profile.plan || 'base') as PlanLevel,
    subscriptionStatus: profile.subscription_status || 'inactive',
    isActive: profile.subscription_status === 'active',
    isElite: profile.plan === 'elite' && profile.subscription_status === 'active',
  }
}

export async function isElite(userId?: string): Promise<boolean> {
  const info = await getPlanInfo(userId)
  return info?.isElite ?? false
}

export async function requireElite(): Promise<Response | null> {
  const info = await getPlanInfo()
  if (!info || !info.isActive) {
    return new Response(JSON.stringify({ error: 'Subscription required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!info.isElite) {
    return new Response(JSON.stringify({ error: 'Elite plan required', upgrade: true }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}
