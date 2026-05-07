// AI-9535 — Migrated to Convex outbound_scheduled_messages.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { getFleetUserId } from '@/lib/fleet-user'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { status, rejection_reason, message_text, scheduled_at } = body

  if (status && !['approved', 'rejected', 'pending'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  let scheduledMs: number | undefined
  if (scheduled_at !== undefined) {
    scheduledMs = typeof scheduled_at === 'number'
      ? scheduled_at : new Date(scheduled_at).getTime()
    if (!Number.isFinite(scheduledMs)) {
      return NextResponse.json({ error: 'scheduled_at is not a valid date' }, { status: 400 })
    }
  }

  try {
    const updated = await getConvexServerClient().mutation(
      api.outbound.updateScheduled,
      {
        id: id as Id<'outbound_scheduled_messages'>,
        user_id: getFleetUserId(),
        status: status as 'pending' | 'approved' | 'rejected' | 'sent' | 'failed' | undefined,
        rejection_reason: rejection_reason ?? undefined,
        message_text: message_text ?? undefined,
        scheduled_at: scheduledMs,
      },
    )
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ message: updated })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Not found') return NextResponse.json({ error: msg }, { status: 404 })
    if (msg === 'Forbidden') return NextResponse.json({ error: msg }, { status: 403 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await getConvexServerClient().mutation(api.outbound.cancelScheduled, {
      id: id as Id<'outbound_scheduled_messages'>,
      user_id: getFleetUserId(),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Not found') return NextResponse.json({ error: msg }, { status: 404 })
    if (msg === 'Forbidden') return NextResponse.json({ error: msg }, { status: 403 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
