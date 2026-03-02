import { createClient } from '@/lib/supabase/server'

export type PlanLevel = 'free' | 'starter' | 'pro' | 'elite'

export interface PlanLimits {
  platforms: string[]
  dailySwipesPerPlatform: number
  maxPlatforms: number
  conversationAI: boolean
  calendarBooking: boolean
  nlpPersonalization: boolean
}

export const PLAN_LIMITS: Record<PlanLevel, PlanLimits> = {
  free: {
    platforms: ['tinder'],
    dailySwipesPerPlatform: 50,
    maxPlatforms: 1,
    conversationAI: false,
    calendarBooking: false,
    nlpPersonalization: false,
  },
  starter: {
    platforms: ['tinder', 'bumble', 'hinge'],
    dailySwipesPerPlatform: 100,
    maxPlatforms: 3,
    conversationAI: true,
    calendarBooking: false,
    nlpPersonalization: false,
  },
  pro: {
    platforms: ['tinder', 'bumble', 'hinge', 'grindr', 'badoo', 'happn', 'okcupid'],
    dailySwipesPerPlatform: 150,
    maxPlatforms: 7,
    conversationAI: true,
    calendarBooking: true,
    nlpPersonalization: true,
  },
  elite: {
    platforms: ['tinder', 'bumble', 'hinge', 'grindr', 'badoo', 'happn', 'okcupid', 'pof', 'feeld', 'cmb'],
    dailySwipesPerPlatform: 300,
    maxPlatforms: 10,
    conversationAI: true,
    calendarBooking: true,
    nlpPersonalization: true,
  },
}

export interface PlanInfo {
  plan: PlanLevel
  subscriptionStatus: string
  isActive: boolean
  limits: PlanLimits
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
    .select('subscription_tier, subscription_status')
    .eq('id', uid)
    .single()

  if (!profile) return null

  const plan = (profile.subscription_tier || 'free') as PlanLevel
  return {
    plan,
    subscriptionStatus: profile.subscription_status || 'inactive',
    isActive: profile.subscription_status === 'active',
    limits: getPlanLimits(plan),
  }
}

export function getPlanLimits(plan: PlanLevel): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}
