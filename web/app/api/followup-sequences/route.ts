import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_FOLLOWUP_CONFIG } from '@/lib/followup/types'

// GET /api/followup-sequences — load the user's config, creating a default row if missing.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing, error } = await supabase
    .from('clapcheeks_followup_sequences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing) return NextResponse.json({ config: existing })

  const { data: created, error: createErr } = await supabase
    .from('clapcheeks_followup_sequences')
    .insert({ user_id: user.id, ...DEFAULT_FOLLOWUP_CONFIG })
    .select()
    .single()

  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
  return NextResponse.json({ config: created })
}

// PATCH /api/followup-sequences — update the user's config.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const allowed: (keyof typeof DEFAULT_FOLLOWUP_CONFIG)[] = [
    'enabled',
    'delays_hours',
    'max_followups',
    'app_to_text_enabled',
    'warmth_threshold',
    'min_messages_before_transition',
    'optimal_send_start_hour',
    'optimal_send_end_hour',
    'quiet_hours_start',
    'quiet_hours_end',
    'timezone',
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

  const { data: existing } = await supabase
    .from('clapcheeks_followup_sequences')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    const { data: created, error: createErr } = await supabase
      .from('clapcheeks_followup_sequences')
      .insert({ user_id: user.id, ...DEFAULT_FOLLOWUP_CONFIG, ...updates })
      .select()
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    return NextResponse.json({ config: created })
  }

  const { data, error } = await supabase
    .from('clapcheeks_followup_sequences')
    .update(updates)
    .eq('user_id', user.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ config: data })
}
