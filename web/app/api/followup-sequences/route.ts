// AI-9535 — Migrated to Convex followup_sequences.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { DEFAULT_FOLLOWUP_CONFIG } from '@/lib/followup/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const config = await getConvexServerClient().mutation(
      api.drips.getOrCreateConfig,
      { user_id: user.id },
    )
    return NextResponse.json({ config })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const allowed: (keyof typeof DEFAULT_FOLLOWUP_CONFIG)[] = [
    'enabled', 'delays_hours', 'max_followups', 'app_to_text_enabled',
    'warmth_threshold', 'min_messages_before_transition',
    'optimal_send_start_hour', 'optimal_send_end_hour',
    'quiet_hours_start', 'quiet_hours_end', 'timezone',
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  if (Array.isArray(updates.delays_hours)) {
    const delays = (updates.delays_hours as unknown[])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 10)
    updates.delays_hours = delays
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  try {
    const config = await getConvexServerClient().mutation(
      api.drips.updateConfig,
      { user_id: user.id, ...updates },
    )
    return NextResponse.json({ config })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
