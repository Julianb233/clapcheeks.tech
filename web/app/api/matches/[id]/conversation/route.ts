import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: Request,
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

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, match_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!match) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  const { data: conv } = await (supabase as any)
    .from('clapcheeks_conversations')
    .select('messages, stage, last_message_at')
    .eq('user_id', user.id)
    .eq('match_id', match.match_id)
    .maybeSingle()

  return NextResponse.json({
    messages: conv?.messages ?? [],
    stage: conv?.stage ?? null,
    last_message_at: conv?.last_message_at ?? null,
  })
}
