// AI-9535 — Migrated to Convex queued_replies.
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
    const { text, matchName, platform } = body

    if (!text || !matchName || !platform) {
      return NextResponse.json(
        { error: 'Missing required fields: text, matchName, platform' },
        { status: 400 }
      )
    }

    await getConvexServerClient().mutation(api.queues.enqueueReply, {
      user_id: getFleetUserId(),
      match_name: matchName,
      platform,
      text,
      status: 'queued',
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Send reply error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: msg || 'Failed to send reply' }, { status: 500 }
    )
  }
}
