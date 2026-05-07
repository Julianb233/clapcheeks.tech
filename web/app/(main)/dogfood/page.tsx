import type { Metadata } from 'next'
import { ConvexHttpClient } from 'convex/browser'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DogfoodDashboard from './dogfood-dashboard'
import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_friction_points + clapcheeks_weekly_reports on Convex.

export const metadata: Metadata = {
  title: 'Dogfooding — Clapcheeks',
  description: 'Founder dogfooding dashboard — track agent health, friction, and weekly reports.',
}

export default async function DogfoodPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Fetch dogfood health data (last 14 days)
  const since = new Date()
  since.setDate(since.getDate() - 14)

  // AI-9536: friction_points + weekly_reports lives on Convex.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null

  const [healthRes, frictionRows, reportRows, subscriptionRes] = await Promise.all([
    supabase
      .from('clapcheeks_dogfood_health')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', since.toISOString().split('T')[0])
      .order('date', { ascending: false }),
    convex
      ? convex
          .query(api.telemetry.listFrictionForUser, {
            user_id: user.id,
            limit: 50,
          })
          .catch(() => [])
      : Promise.resolve([]),
    convex
      ? convex
          .query(api.reports.getWeeklyReportsForUser, {
            user_id: user.id,
            limit: 4,
          })
          .catch(() => [])
      : Promise.resolve([]),
    // AI-9537: subscriptions migrated to Convex.
    convex
      ? convex
          .query(api.billing.getByUser, { user_id: user.id })
          .catch(() => null as { status: string; plan?: string } | null)
      : Promise.resolve(null as { status: string; plan?: string } | null),
  ])

  const health = healthRes.data || []
  const friction = (frictionRows as Array<{
    _id: string
    _creationTime: number
    title: string
    description?: string
    severity: string
    category: string
    platform?: string
    auto_detected: boolean
    resolved: boolean
    resolution?: string
    resolved_at?: number
    created_at: number
  }>).map((f) => ({
    id: f._id,
    title: f.title,
    description: f.description ?? '',
    severity: f.severity,
    category: f.category,
    platform: f.platform ?? null,
    resolved: f.resolved,
    resolution: f.resolution ?? null,
    created_at: new Date(f.created_at).toISOString(),
  }))
  const reports = (reportRows as Array<{
    _id: string
    _creationTime: number
    week_start_iso: string
    week_end_ms: number
    metrics_snapshot?: unknown
  }>).map((r) => ({
    id: r._id,
    week_start: r.week_start_iso,
    week_end: new Date(r.week_end_ms).toISOString().split('T')[0],
    metrics_snapshot: (r.metrics_snapshot ?? {}) as Record<string, unknown>,
    created_at: new Date(r._creationTime).toISOString(),
  }))
  // AI-9537: subscriptionRes is now the Convex row directly (or null).
  // Map plan -> plan_id for the legacy subscription shape consumed by DogfoodDashboard.
  const subscription = subscriptionRes
    ? {
        status: (subscriptionRes as { status: string }).status,
        plan_id: (subscriptionRes as { plan?: string }).plan ?? '',
      }
    : null

  // Calculate current streak from health data
  const latestHealth = health[0]
  const currentStreak = latestHealth?.consecutive_streak ?? 0
  const totalCrashes = health.reduce((sum: number, h: { total_crashes?: number }) => sum + (h.total_crashes || 0), 0)

  // Friction summary
  const unresolvedFriction = friction.filter((f: { resolved?: boolean }) => !f.resolved)
  const blockers = unresolvedFriction.filter((f: { severity?: string }) => f.severity === 'blocker')

  // Success criteria evaluation
  const successCriteria = {
    agentStreak: {
      passed: currentStreak >= 7,
      actual: currentStreak,
      target: 7,
      label: 'Agent runs 7 consecutive days without crash',
    },
    aiConversation: {
      passed: (latestHealth?.weekly_summary?.total_ai_replies ?? 0) >= 1,
      actual: latestHealth?.weekly_summary?.total_ai_replies ?? 0,
      target: 1,
      label: 'At least 1 match conversation handled by AI',
    },
    stripeActive: {
      passed: subscription?.status === 'active',
      actual: subscription?.status || 'none',
      target: 'active',
      label: 'Stripe subscription created and active',
    },
    weeklyReport: {
      passed: reports.length > 0,
      actual: reports.length,
      target: 1,
      label: 'Weekly report generates with real data',
    },
  }

  const allPassed = Object.values(successCriteria).every(c => c.passed)

  return (
    <DogfoodDashboard
      health={health}
      friction={friction}
      reports={reports}
      subscription={subscription}
      successCriteria={successCriteria}
      currentStreak={currentStreak}
      totalCrashes={totalCrashes}
      unresolvedFriction={unresolvedFriction}
      blockers={blockers}
      allPassed={allPassed}
    />
  )
}
