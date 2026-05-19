import type { Metadata } from 'next'
import { createClient } from '@/lib/convex/server'
import { redirect } from 'next/navigation'
import AutonomyDashboard from './components/autonomy-dashboard'
import { getClapCheeksUserSettings } from '@/lib/clapcheeks/user-settings'

export const metadata: Metadata = {
  title: 'Autonomy Engine — Clapcheeks',
  description: 'Auto-swipe, auto-respond, and approval gates for your dating co-pilot.',
}

export default async function AutonomyPage() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) redirect('/auth')

  const [{ row: settingsRow }, queueRes] = await Promise.all([
    getClapCheeksUserSettings(),
    convex
      .from('clapcheeks_approval_queue')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const approveOpeners = Boolean(settingsRow?.approve_openers)
  const approveReplies = settingsRow?.approve_replies !== undefined ? Boolean(settingsRow.approve_replies) : true
  const approveDateAsks = settingsRow?.approve_date_asks !== undefined ? Boolean(settingsRow.approve_date_asks) : true
  const approveBookings = settingsRow?.approve_bookings !== undefined ? Boolean(settingsRow.approve_bookings) : true
  let globalLevel: 'supervised' | 'semi_auto' | 'full_auto' | 'custom' = 'custom'
  if (approveOpeners && approveReplies && approveDateAsks && approveBookings) globalLevel = 'supervised'
  if (approveOpeners && !approveReplies && approveDateAsks && approveBookings) globalLevel = 'semi_auto'
  if (!approveOpeners && !approveReplies && !approveDateAsks && approveBookings) globalLevel = 'full_auto'

  const config = {
    source: 'clapcheeks_user_settings',
    global_level: globalLevel,
    approve_openers: approveOpeners,
    approve_replies: approveReplies,
    approve_date_asks: approveDateAsks,
    approve_bookings: approveBookings,
    auto_respond_enabled: !approveReplies,
    require_approval_for_first_message: approveOpeners,
    ai_active: settingsRow?.ai_active ?? null,
    ai_paused_until: settingsRow?.ai_paused_until ?? null,
    ai_paused_reason: settingsRow?.ai_paused_reason ?? null,
    updated_at: settingsRow?.updated_at ?? null,
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
          initialQueue={queueRes.data ?? []}
          initialActions={[]}
          initialModel={{ version: 0, training_size: 0, accuracy: null, weights: {} }}
          totalSwipeDecisions={0}
          userId={user.id}
        />
      </div>
    </div>
  )
}
