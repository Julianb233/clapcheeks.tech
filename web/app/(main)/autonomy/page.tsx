import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AutonomyDashboard from './components/autonomy-dashboard'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

export const metadata: Metadata = {
  title: 'Autonomy Engine — Clapcheeks',
  description: 'Auto-swipe, auto-respond, and approval gates for your dating co-pilot.',
}

export default async function AutonomyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // AI-9535 — approval_queue is now Convex; everything else stays on Supabase.
  const convex = getConvexServerClient()
  const [configRes, queueData, actionsRes, modelRes, swipesCountRes] = await Promise.all([
    supabase
      .from('clapcheeks_autonomy_config')
      .select('*')
      .eq('user_id', user.id)
      .single(),
    convex.query(api.queues.listApprovalsForUser, {
      user_id: user.id,
      status: 'pending',
      limit: 20,
    }),
    supabase
      .from('clapcheeks_auto_actions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('clapcheeks_preference_model')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('clapcheeks_swipe_decisions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  const config = configRes.data ?? {
    global_level: 'supervised',
    auto_swipe_enabled: false,
    auto_swipe_confidence_min: 70,
    auto_respond_enabled: false,
    auto_respond_confidence_min: 80,
    auto_reengage_enabled: false,
    max_auto_swipes_per_hour: 20,
    max_auto_replies_per_hour: 10,
    stale_hours_threshold: 48,
    stale_recovery_enabled: false,
    notify_on_auto_send: true,
    notify_on_low_confidence: true,
    notify_on_queue_item: true,
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-500 to-red-600 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8" />
            </svg>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold">Autonomy Engine</h1>
        </div>
        <p className="text-sm text-white/50 mb-8 ml-11">
          Auto-swipe, auto-respond, and approval gates — your AI dating co-pilot on autopilot.
        </p>

        <AutonomyDashboard
          initialConfig={config}
          initialQueue={((queueData ?? []) as Array<{
            _id: string
            action_type: string
            match_name?: string
            platform?: string
            proposed_text?: string
            proposed_data?: unknown
            confidence?: number
            ai_reasoning?: string
            status: string
            created_at: number
            expires_at: number
          }>).map((q) => ({
            id: String(q._id),
            action_type: q.action_type,
            match_name: q.match_name ?? '',
            platform: q.platform ?? null,
            proposed_text: q.proposed_text ?? null,
            proposed_data: (q.proposed_data ?? {}) as Record<string, unknown>,
            confidence: q.confidence ?? null,
            ai_reasoning: q.ai_reasoning ?? null,
            status: q.status,
            created_at: new Date(q.created_at).toISOString(),
            expires_at: new Date(q.expires_at).toISOString(),
          }))}
          initialActions={actionsRes.data ?? []}
          initialModel={modelRes.data ?? { version: 0, training_size: 0, accuracy: null, weights: {} }}
          totalSwipeDecisions={swipesCountRes.count ?? 0}
          userId={user.id}
        />
      </div>
    </div>
  )
}
