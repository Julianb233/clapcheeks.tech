import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Phase J (AI-8338) bonus factor: calendar_overlap.
// When Julian is free tonight, surface the top-3 matches most worth
// messaging now (highest close_probability on a live stage).
//
// This is an MVP — it does NOT read Google Calendar. A future phase can
// gate on actual free/busy. For now we always return the top-3 because
// the surface is only hit when Julian opens the widget.

const LIVE_STAGES = new Set([
  'chatting',
  'chatting_phone',
  'date_proposed',
  'date_booked',
  'recurring',
])

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, name, age, photos_jsonb, close_probability, health_score, stage, last_activity_at, final_score')
    .eq('user_id', user.id)
    .order('close_probability', { ascending: false, nullsFirst: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const top = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((m) => LIVE_STAGES.has((m.stage as string) ?? ''))
    .slice(0, 3)

  return NextResponse.json({ top3: top })
}
