import { NextResponse } from 'next/server'
import { api } from '@/convex/_generated/api'
import { getConvexServerClient } from '@/lib/convex/server'
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

  // AI-9534 — matches now on Convex; listForUserOrdered already sorts by
  // close_probability DESC, then final_score DESC, then last_activity DESC.
  let data: Array<Record<string, unknown> & { _id?: unknown }> = []
  try {
    const convex = getConvexServerClient()
    const rows = (await convex.query(api.matches.listForUserOrdered, {
      user_id: user.id,
      limit: 50,
    })) as Array<Record<string, unknown> & { _id?: unknown }>
    data = rows ?? []
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'list failed' },
      { status: 500 },
    )
  }

  const top = data
    .filter((m) => LIVE_STAGES.has((m.stage as string) ?? ''))
    .slice(0, 3)
    .map((m) => ({
      // Mirror the legacy response shape exactly so the widget keeps working.
      id:
        (m.supabase_match_id as string | undefined) ??
        (m._id as string | undefined) ??
        null,
      name: m.name ?? null,
      age: m.age ?? null,
      photos_jsonb: m.photos ?? null,
      close_probability: m.close_probability ?? null,
      health_score: m.health_score ?? null,
      stage: m.stage ?? null,
      last_activity_at:
        typeof m.last_activity_at === 'number'
          ? new Date(m.last_activity_at as number).toISOString()
          : null,
      final_score: m.final_score ?? null,
    }))

  return NextResponse.json({ top3: top })
}
