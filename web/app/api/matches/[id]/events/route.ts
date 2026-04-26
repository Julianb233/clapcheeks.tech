import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/matches/[id]/events — return the audit log for this match.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { data, error } = await supabase
    .from('clapcheeks_date_events')
    .select('id, event_type, original_slot, new_slot, note, created_at')
    .eq('user_id', user.id)
    .eq('match_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}
