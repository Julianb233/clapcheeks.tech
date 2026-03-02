import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUsageSummary } from '@/lib/usage'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const usage = await getUsageSummary(user.id)

    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    tomorrow.setUTCHours(0, 0, 0, 0)
    const resetsAt = tomorrow.toISOString()

    const response = NextResponse.json({ usage, resets_at: resetsAt })

    // Add rate-limit headers for local agent consumption
    response.headers.set('X-RateLimit-Swipes-Used', String(usage.swipes.used))
    response.headers.set('X-RateLimit-Swipes-Limit', String(usage.swipes.limit))
    response.headers.set('X-RateLimit-CoachingCalls-Used', String(usage.coaching_calls.used))
    response.headers.set('X-RateLimit-CoachingCalls-Limit', String(usage.coaching_calls.limit))
    response.headers.set('X-RateLimit-AiReplies-Used', String(usage.ai_replies.used))
    response.headers.set('X-RateLimit-AiReplies-Limit', String(usage.ai_replies.limit))
    response.headers.set('X-RateLimit-Reset', resetsAt)

    return response
  } catch (error) {
    console.error('Usage API error:', error)
    return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 })
  }
}
