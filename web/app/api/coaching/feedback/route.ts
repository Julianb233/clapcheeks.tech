import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'

// AI-9537: tip feedback now lives on Convex tip_feedback.

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { sessionId, tipIndex, helpful } = body

  if (!sessionId || tipIndex === undefined || helpful === undefined) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const convex = getConvexServerClient()
    await convex.mutation(api.coaching.upsertTipFeedback, {
      user_id: user.id,
      coaching_session_id: sessionId as Id<'coaching_sessions'>,
      tip_index: tipIndex,
      helpful,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save feedback'
    console.error('Feedback error:', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
