import { ConvexHttpClient } from 'convex/browser'

import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_usage_daily migrated to Convex usage_daily.
// AI-9537 — clapcheeks_subscriptions migrated to Convex subscriptions.

export const PLAN_LIMITS = {
  base: { swipes: 500, coaching_calls: 5, ai_replies: 20 },
  elite: { swipes: 999999, coaching_calls: 999999, ai_replies: 999999 },
} as const

type ResourceField = keyof typeof PLAN_LIMITS.base

type UsageDbField =
  | 'swipes_used'
  | 'coaching_calls_used'
  | 'ai_replies_used'

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

function getConvex(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  return url ? new ConvexHttpClient(url) : null
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}

async function getUserPlan(userId: string): Promise<'base' | 'elite'> {
  // AI-9537: read subscription from Convex.
  const convex = getConvex()
  if (!convex) return 'base'
  try {
    const sub = await convex.query(api.billing.getByUser, { user_id: userId })
    if (sub?.status === 'active' && sub.plan === 'elite') return 'elite'
    return 'base'
  } catch {
    return 'base'
  }
}

async function getUsageRow(
  userId: string,
  dayIso: string,
): Promise<Record<UsageDbField, number> | null> {
  const convex = getConvex()
  if (!convex) return null
  try {
    const row = await convex.query(api.telemetry.getUsageForDay, {
      user_id: userId,
      day_iso: dayIso,
    })
    if (!row) return null
    return {
      swipes_used: row.swipes_used,
      coaching_calls_used: row.coaching_calls_used,
      ai_replies_used: row.ai_replies_used,
    }
  } catch {
    return null
  }
}

export async function checkLimit(
  userId: string,
  field: ResourceField,
): Promise<UsageCheck> {
  const plan = await getUserPlan(userId)
  const limit = PLAN_LIMITS[plan][field]

  // Elite users are effectively unlimited
  if (limit >= 999999) {
    return { allowed: true, used: 0, limit }
  }

  const dbField: UsageDbField = `${field}_used`
  const row = await getUsageRow(userId, todayIso())
  const used = row?.[dbField] ?? 0

  return {
    allowed: used < limit,
    used,
    limit,
  }
}

export async function incrementUsage(
  userId: string,
  field: ResourceField,
): Promise<void> {
  const convex = getConvex()
  if (!convex) {
    console.error(`Failed to increment usage for ${field}: CONVEX_URL not set`)
    return
  }
  try {
    await convex.mutation(api.telemetry.incrementUsage, {
      user_id: userId,
      day_iso: todayIso(),
      field: `${field}_used` as UsageDbField,
      amount: 1,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Failed to increment usage for ${field}: ${msg}`)
  }
}

export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const plan = await getUserPlan(userId)
  const row = await getUsageRow(userId, todayIso())

  const fields: ResourceField[] = ['swipes', 'coaching_calls', 'ai_replies']
  const summary = {} as UsageSummary

  for (const field of fields) {
    const limit = PLAN_LIMITS[plan][field]
    const dbField: UsageDbField = `${field}_used`
    const used = row?.[dbField] ?? 0
    summary[field] = {
      allowed: limit >= 999999 || used < limit,
      used,
      limit,
    }
  }

  return summary
}
