// AI-9535 — Migrated to Convex outbound_scheduled_messages.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { getFleetUserId } from '@/lib/fleet-user'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') ?? '50')

  try {
    const rows = await getConvexServerClient().query(
      api.outbound.listForUser,
      { user_id: getFleetUserId(), status: status ?? undefined, limit },
    )
    // AI-9582: transform Convex shape (_id, unix-ms timestamps) → UI shape
    // (id string, ISO timestamps). The /scheduled UI renders id as React key
    // and scheduled_at via new Date() — wrong shape causes duplicate keys +
    // "Invalid Date".
    const messages = (rows ?? []).map((r: any) => ({
      id: r._id,
      match_id: r.match_id ?? null,
      match_name: r.match_name,
      platform: r.platform,
      phone: r.phone ?? null,
      message_text: r.message_text,
      scheduled_at: new Date(r.scheduled_at).toISOString(),
      status: r.status,
      sequence_type: r.sequence_type,
      sequence_step: r.sequence_step ?? null,
      delay_hours: r.delay_hours ?? null,
      rejection_reason: r.rejection_reason ?? null,
      sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
      god_draft_id: r.god_draft_id ?? null,
      created_at: new Date(r.created_at).toISOString(),
    }))
    return NextResponse.json({ messages })
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
        user_id: getFleetUserId(),
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
    // AI-9582: transform created row to UI shape
    const message = created ? {
      id: (created as any)._id ?? created,
      match_id: (created as any).match_id ?? null,
      match_name: (created as any).match_name ?? match_name,
      platform: (created as any).platform ?? platform ?? 'iMessage',
      phone: (created as any).phone ?? null,
      message_text: (created as any).message_text ?? message_text,
      scheduled_at: typeof (created as any).scheduled_at === 'number'
        ? new Date((created as any).scheduled_at).toISOString()
        : new Date(scheduledMs).toISOString(),
      status: (created as any).status ?? 'pending',
      sequence_type: (created as any).sequence_type ?? sequence_type ?? 'manual',
      sequence_step: (created as any).sequence_step ?? null,
      delay_hours: (created as any).delay_hours ?? null,
      rejection_reason: null,
      sent_at: null,
      god_draft_id: null,
      created_at: new Date().toISOString(),
    } : created
    return NextResponse.json({ message }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
