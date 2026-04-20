import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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

  const [healthRes, frictionRes, streakRes] = await Promise.all([
    supabase
      .from('clapcheeks_dogfood_health')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', since.toISOString().split('T')[0])
      .order('date', { ascending: false })
      .limit(14),
    supabase
      .from('clapcheeks_friction_points')
      .select('id, severity, resolved')
      .eq('user_id', user.id)
      .eq('resolved', false),
    supabase
      .from('clapcheeks_dogfood_health')
      .select('consecutive_streak')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(1)
      .single(),
  ])

  const health = healthRes.data || []
  const unresolved = frictionRes.data || []
  const currentStreak = streakRes.data?.consecutive_streak || 0

  return NextResponse.json({
    currentStreak,
    health,
    friction: {
      unresolved: unresolved.length,
      blockers: unresolved.filter(f => f.severity === 'blocker').length,
    },
    criteria: {
      agentStreak: currentStreak >= 7,
      noBlockers: unresolved.filter(f => f.severity === 'blocker').length === 0,
    },
  })
}
