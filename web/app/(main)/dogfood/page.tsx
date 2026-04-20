import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DogfoodDashboard from './dogfood-dashboard'

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

  const [healthRes, frictionRes, reportsRes, subscriptionRes] = await Promise.all([
    supabase
      .from('clapcheeks_dogfood_health')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', since.toISOString().split('T')[0])
      .order('date', { ascending: false }),
    supabase
      .from('clapcheeks_friction_points')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('clapcheeks_weekly_reports')
      .select('id, week_start, week_end, metrics_snapshot, created_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(4),
    supabase
      .from('clapcheeks_subscriptions')
      .select('status, plan_id')
      .eq('user_id', user.id)
      .limit(1)
      .single(),
  ])

  const health = healthRes.data || []
  const friction = frictionRes.data || []
  const reports = reportsRes.data || []
  const subscription = subscriptionRes.data

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
