import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  const { error } = await supabase
    .from('clapcheeks_tip_feedback')
    .upsert(
      {
        user_id: user.id,
        coaching_session_id: sessionId,
        tip_index: tipIndex,
        helpful,
      },
      { onConflict: 'user_id,coaching_session_id,tip_index' }
    )

  if (error) {
    console.error('Feedback error:', error)
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
