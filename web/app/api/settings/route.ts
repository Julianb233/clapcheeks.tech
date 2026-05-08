import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const NO_STORE = { headers: { 'Cache-Control': 'no-store, max-age=0' } }

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, ...NO_STORE })
  }
  const { data, error } = await supabase
    .from('clapcheeks_user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, ...NO_STORE })
  }
  return NextResponse.json({ settings: data ?? null }, NO_STORE)
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, ...NO_STORE })
  }
  let patch: Record<string, unknown>
  try {
    patch = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, ...NO_STORE })
  }
  const ALLOWED = new Set([
    'persona', 'drip_rules_yaml', 'style_text',
    'date_calendar_email', 'date_slots', 'date_slot_days_ahead',
    'date_slot_duration_hours', 'date_timezone',
    'approve_openers', 'approve_replies', 'approve_date_asks', 'approve_bookings',
    'ai_active', 'ai_paused_until', 'ai_paused_reason',
    'humor_flavor', 'date_proposal_style',
  ])
  const safe: Record<string, unknown> = { user_id: user.id }
  for (const [k, v] of Object.entries(patch)) {
    if (ALLOWED.has(k)) safe[k] = v
  }
  const { data, error } = await supabase
    .from('clapcheeks_user_settings')
    .upsert(safe, { onConflict: 'user_id' })
    .select('*')
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, ...NO_STORE })
  }
  return NextResponse.json({ settings: data }, NO_STORE)
}
