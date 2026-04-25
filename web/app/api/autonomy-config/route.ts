import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_LEVELS = ['supervised', 'semi_auto', 'full_auto'] as const

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await (supabase as any)
    .from('clapcheeks_autonomy_config')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ config: data })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const update: Record<string, unknown> = {}
  // The dashboard sends `global_level` but the column is `autonomy_level`.
  const incoming =
    (body.global_level as string | undefined) ||
    (body.autonomy_level as string | undefined)
  if (incoming) {
    if (!(ALLOWED_LEVELS as readonly string[]).includes(incoming)) {
      return NextResponse.json(
        {
          error: `autonomy_level must be one of: ${ALLOWED_LEVELS.join(', ')}`,
        },
        { status: 400 },
      )
    }
    update.autonomy_level = incoming
  }
  const boolKeys = [
    'auto_swipe_enabled',
    'auto_respond_enabled',
    'auto_reengage_enabled',
    'notify_on_auto_action',
    'require_approval_for_first_message',
  ] as const
  for (const k of boolKeys) {
    if (typeof body[k] === 'boolean') update[k] = body[k]
  }
  const numKeys = [
    'auto_swipe_confidence_min',
    'auto_respond_confidence_min',
    'max_auto_swipes_per_hour',
    'max_auto_replies_per_hour',
    'stale_hours_threshold',
  ] as const
  for (const k of numKeys) {
    if (typeof body[k] === 'number') update[k] = body[k]
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'no updatable fields provided' },
      { status: 400 },
    )
  }

  const { data, error } = await (supabase as any)
    .from('clapcheeks_autonomy_config')
    .upsert(
      {
        user_id: user.id,
        ...update,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, config: data })
}
