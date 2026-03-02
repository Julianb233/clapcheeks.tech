import { createClient } from '@/lib/supabase/server'

export const PLAN_LIMITS = {
  base: { swipes: 500, coaching_calls: 5, ai_replies: 20 },
  elite: { swipes: 999999, coaching_calls: 999999, ai_replies: 999999 },
} as const

type ResourceField = keyof typeof PLAN_LIMITS.base

export interface UsageCheck {
  allowed: boolean
  used: number
  limit: number
}

export interface UsageSummary {
  swipes: UsageCheck
  coaching_calls: UsageCheck
  ai_replies: UsageCheck
}

async function getUserPlan(userId: string): Promise<'base' | 'elite'> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('clapcheeks_subscriptions')
    .select('plan')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .single()

  return (data?.plan as 'base' | 'elite') || 'base'
}

export async function checkLimit(
  userId: string,
  field: ResourceField
): Promise<UsageCheck> {
  const plan = await getUserPlan(userId)
  const limit = PLAN_LIMITS[plan][field]

  // Elite users are effectively unlimited
  if (limit >= 999999) {
    return { allowed: true, used: 0, limit }
  }

  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const dbField = `${field}_used`
  const { data } = await supabase
    .from('clapcheeks_usage_daily')
    .select(dbField)
    .eq('user_id', userId)
    .eq('date', today)
    .single()

  const used = (data as Record<string, number> | null)?.[dbField] ?? 0

  return {
    allowed: used < limit,
    used,
    limit,
  }
}

export async function incrementUsage(
  userId: string,
  field: ResourceField
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('increment_usage', {
    p_user_id: userId,
    p_field: `${field}_used`,
    p_amount: 1,
  })

  if (error) {
    console.error(`Failed to increment usage for ${field}:`, error)
  }
}

export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const plan = await getUserPlan(userId)
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const { data } = await supabase
    .from('clapcheeks_usage_daily')
    .select('swipes_used, coaching_calls_used, ai_replies_used')
    .eq('user_id', userId)
    .eq('date', today)
    .single()

  const fields: ResourceField[] = ['swipes', 'coaching_calls', 'ai_replies']
  const summary = {} as UsageSummary

  for (const field of fields) {
    const limit = PLAN_LIMITS[plan][field]
    const dbField = `${field}_used` as string
    const used = (data as Record<string, number> | null)?.[dbField] ?? 0
    summary[field] = {
      allowed: limit >= 999999 || used < limit,
      used,
      limit,
    }
  }

  return summary
}
