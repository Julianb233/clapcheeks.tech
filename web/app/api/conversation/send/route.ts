// AI-9535 — Migrated to Convex queued_replies.
// AI-9526 Q4 — Compose-and-send now writes to outbound_scheduled_messages
// with status="approved" so the Mac outbound drainer picks it up within 60s.
// Also dual-writes to queued_replies so the legacy queue_poller can still
// pick it up if the operator hasn't migrated their Mac daemon yet.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { getFleetUserId } from '@/lib/fleet-user'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { text, matchName, platform, handle } = body

    if (!text || !matchName || !platform) {
      return NextResponse.json(
        { error: 'Missing required fields: text, matchName, platform' },
        { status: 400 }
      )
    }

    const userId = getFleetUserId()
    const convex = getConvexServerClient()
    const now = Date.now()
    const recipientHandle = typeof handle === 'string' && handle ? handle : undefined
    const phone =
      recipientHandle && recipientHandle.startsWith('+') ? recipientHandle : undefined

    // AI-9526 Q4 — Primary write: outbound_scheduled_messages with
    // status="approved" + scheduled_at=now so the outbound drainer fires
    // within ~60s.
    const scheduled = await convex.mutation(api.outbound.enqueueScheduledMessage, {
      user_id: userId,
      match_name: matchName,
      platform: typeof platform === 'string' ? platform : 'iMessage',
      phone,
      message_text: text,
      scheduled_at: now,
      sequence_type: 'manual',
      immediate_approved: true,
    })

    // Dual-write to queued_replies for the legacy queue_poller (pre-9526
    // daemons). Best-effort — failure doesn't fail the send.
    try {
      await convex.mutation(api.queues.enqueueReply, {
        user_id: userId,
        match_name: matchName,
        platform,
        text,
        recipient_handle: recipientHandle,
        status: 'queued',
      })
    } catch (e) {
      console.warn('queued_replies dual-write failed (non-fatal):', e)
    }

    return NextResponse.json({
      success: true,
      scheduled_id:
        scheduled && typeof scheduled === 'object' && '_id' in scheduled
          ? (scheduled as { _id: string })._id
          : null,
    })
  } catch (error) {
    console.error('Send reply error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: msg || 'Failed to send reply' }, { status: 500 }
    )
  }
}
