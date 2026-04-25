import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateReplies } from '@/lib/conversation-ai/generate-replies'
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
    const { conversationContext, matchName, platform, profile_context } = body

    if (!conversationContext || !matchName || !platform) {
      return NextResponse.json(
        { error: 'Missing required fields: conversationContext, matchName, platform' },
        { status: 400 }
      )
    }

    const suggestions = await generateReplies(
      supabase,
      user.id,
      conversationContext,
      matchName,
      platform,
      profile_context
    )

    // Increment usage after successful suggestion
    await incrementUsage(user.id, 'ai_replies')

    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Conversation suggest error:', error)
    const raw = error instanceof Error ? error.message : String(error)
    // Surface Anthropic-side reason so the UI can show something actionable
    // (insufficient credits, rate limit, model unavailable, etc.) instead
    // of a generic "failed".
    let userMessage = 'Failed to generate suggestion'
    if (/credit balance/i.test(raw)) userMessage = 'AI service unavailable (credits low). Top up at console.anthropic.com.'
    else if (/rate limit|429/i.test(raw)) userMessage = 'Rate limited by Claude API. Try again in a minute.'
    else if (/invalid.*api.*key|unauthorized/i.test(raw)) userMessage = 'Claude API key invalid. Check ANTHROPIC_API_KEY env.'
    return NextResponse.json(
      { error: 'suggest_failed', message: userMessage, detail: raw.slice(0, 300) },
      { status: 500 }
    )
  }
}
