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

export function getPlanLimits(plan: PlanLevel): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}
