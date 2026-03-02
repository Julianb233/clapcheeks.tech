import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkLimit, incrementUsage } from '@/lib/usage'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check ai_replies usage limit
  const usage = await checkLimit(user.id, 'ai_replies')
  if (!usage.allowed) {
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    tomorrow.setUTCHours(0, 0, 0, 0)
    return NextResponse.json(
      {
        error: 'Usage limit reached',
        code: 'LIMIT_EXCEEDED',
        resource: 'ai_replies',
        used: usage.used,
        limit: usage.limit,
        message: "You've used all your AI reply suggestions today. Upgrade to Elite for unlimited.",
        resets_at: tomorrow.toISOString(),
      },
      { status: 429 }
    )
  }

  try {
    const body = await request.json()

    // Increment usage after successful suggestion
    await incrementUsage(user.id, 'ai_replies')

    // TODO: Implement actual AI reply suggestion generation
    return NextResponse.json({
      message: 'Conversation suggestion endpoint ready. AI generation not yet implemented.',
      context: body,
    })
  } catch (error) {
    console.error('Conversation suggest error:', error)
    return NextResponse.json(
      { error: 'Failed to generate suggestion' },
      { status: 500 }
    )
  }
}
