import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_STAGES = new Set([
  'new_match',
  'chatting',
  'chatting_phone',
  'date_proposed',
  'date_booked',
  'date_attended',
  'hooked_up',
  'recurring',
  'faded',
])
const ALLOWED_STATUS = new Set([
  'new',
  'opened',
  'conversing',
  'chatting',
  'chatting_phone',
  'stalled',
  'date_proposed',
  'date_booked',
  'dated',
])

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as {
    stage?: string
    status?: string
  }

  const stage = ALLOWED_STAGES.has(body.stage ?? '') ? body.stage : 'chatting'
  const status = ALLOWED_STATUS.has(body.status ?? '')
    ? body.status
    : 'conversing'

  const { data: updated, error } = await (supabase as any)
    .from('clapcheeks_matches')
    .update({ stage, status })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name, stage, status')
    .single()

  if (error) {
    return NextResponse.json(
      { error: error.message ?? 'restore failed' },
      { status: 500 },
    )
  }
  if (!updated) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, match: updated })
}
