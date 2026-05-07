// AI-9535 — Migrated to Convex outbound_scheduled_messages.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') ?? '50')

  try {
    const messages = await getConvexServerClient().query(
      api.outbound.listForUser,
      { user_id: user.id, status: status ?? undefined, limit },
    )
    return NextResponse.json({ messages: messages ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { match_name, match_id, platform, phone, message_text, scheduled_at,
          sequence_type, sequence_step, delay_hours } = body

  if (!match_name || !message_text || !scheduled_at) {
    return NextResponse.json(
      { error: 'match_name, message_text, and scheduled_at are required' },
      { status: 400 }
    )
  }

  const scheduledMs = typeof scheduled_at === 'number'
    ? scheduled_at
    : new Date(scheduled_at).getTime()

  if (!Number.isFinite(scheduledMs)) {
    return NextResponse.json(
      { error: 'scheduled_at is not a valid date' },
      { status: 400 }
    )
  }

  try {
    const created = await getConvexServerClient().mutation(
      api.outbound.enqueueScheduledMessage,
      {
        user_id: user.id,
        match_id: match_id ?? undefined,
        match_name,
        platform: platform ?? 'iMessage',
        phone: phone ?? undefined,
        message_text,
        scheduled_at: scheduledMs,
        sequence_type: sequence_type ?? 'manual',
        sequence_step: sequence_step ?? 0,
        delay_hours: delay_hours ?? undefined,
      },
    )
    return NextResponse.json({ message: created }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
