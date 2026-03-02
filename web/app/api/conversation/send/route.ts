import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    const { error } = await supabase
      .from('clapcheeks_queued_replies')
      .insert({
        user_id: user.id,
        match_name: matchName,
        platform,
        text,
        status: 'queued',
      })

    if (error) {
      console.error('Queue reply error:', error)
      return NextResponse.json(
        { error: 'Failed to queue reply' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Send reply error:', error)
    return NextResponse.json(
      { error: 'Failed to send reply' },
      { status: 500 }
    )
  }
}
