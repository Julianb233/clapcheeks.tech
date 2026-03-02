import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateCoaching } from '@/lib/coaching/generate'
import { checkLimit, incrementUsage } from '@/lib/usage'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check coaching_calls usage limit
  const usage = await checkLimit(user.id, 'coaching_calls')
  if (!usage.allowed) {
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    tomorrow.setUTCHours(0, 0, 0, 0)
    return NextResponse.json(
      {
        error: 'Usage limit reached',
        code: 'LIMIT_EXCEEDED',
        resource: 'coaching_calls',
        used: usage.used,
        limit: usage.limit,
        message: "You've used all your AI coaching sessions today. Upgrade to Elite for unlimited.",
        resets_at: tomorrow.toISOString(),
      },
      { status: 429 }
    )
  }

  try {
    const session = await generateCoaching(supabase, user.id)

    if (!session) {
      return NextResponse.json(
        { error: 'Not enough data yet. Use the app for at least a week to get coaching tips.' },
        { status: 400 }
      )
    }

    // Increment usage after successful generation
    await incrementUsage(user.id, 'coaching_calls')

    return NextResponse.json(session)
  } catch (error) {
    console.error('Coaching generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate coaching tips' },
      { status: 500 }
    )
  }
}
