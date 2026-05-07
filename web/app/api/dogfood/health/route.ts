import { createClient } from '@/lib/supabase/server'
import { ConvexHttpClient } from 'convex/browser'
import { NextResponse } from 'next/server'

import { api } from '@/convex/_generated/api'

// AI-9536 — clapcheeks_friction_points migrated to Convex friction_points;
// clapcheeks_dogfood_health stays on Supabase for now (out of scope).

/**
 * GET /api/dogfood/health — fetch dogfood health summary for the current user.
 * Used by the dogfooding dashboard to show real-time agent health.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since = new Date()
  since.setDate(since.getDate() - 14)
  const sinceIso = since.toISOString().split('T')[0]

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL
  const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null

  const [healthRes, frictionRows, streakRes] = await Promise.all([
    supabase
      .from('clapcheeks_dogfood_health')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', sinceIso)
      .order('date', { ascending: false })
      .limit(14),
    convex
      ? convex
          .query(api.telemetry.listFrictionForUser, {
            user_id: user.id,
            only_unresolved: true,
            limit: 200,
          })
          .catch(() => [])
      : Promise.resolve([]),
    supabase
      .from('clapcheeks_dogfood_health')
      .select('consecutive_streak')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(1)
      .single(),
  ])

  const health = healthRes.data || []
  const unresolved =
    (frictionRows as Array<{ severity: string; resolved: boolean }> | null) || []
  const currentStreak = streakRes.data?.consecutive_streak || 0

  return NextResponse.json({
    currentStreak,
    health,
    friction: {
      unresolved: unresolved.length,
      blockers: unresolved.filter((f) => f.severity === 'blocker').length,
    },
    criteria: {
      agentStreak: currentStreak >= 7,
      noBlockers:
        unresolved.filter((f) => f.severity === 'blocker').length === 0,
    },
  })
}
