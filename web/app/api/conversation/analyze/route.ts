import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  analyzeConversation,
  detectRedFlags,
  generateStrategy,
  redFlagSummary,
  renderStrategyForPrompt,
  type IncomingMessage,
} from '@/lib/conversation-ai/analyzer'

/**
 * POST /api/conversation/analyze
 *
 * Phase 41 (AI-8326) — Conversation Intelligence.
 * Returns analysis (CONV-01), strategy (CONV-02), and red flags (CONV-05)
 * for a given conversation history.
 *
 * Body:
 *   {
 *     messages: [{ role: "user"|"assistant", content: string, sent_at?: string }, ...],
 *     match_profile?: { name?, interests?, instagram_intel?, vision_summary?, red_flags?, style_profile? },
 *     include_prompt_block?: boolean   // include the LLM-ready strategy block in response
 *   }
 *
 * Response:
 *   { analysis, strategy, red_flags: { flagged, count, max_severity, flags }, strategy_prompt? }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    messages?: unknown
    match_profile?: Record<string, unknown> | null
    include_prompt_block?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const messages = Array.isArray(body.messages) ? (body.messages as IncomingMessage[]) : null
  if (!messages) {
    return NextResponse.json(
      { error: 'Missing required field: messages (array)' },
      { status: 400 },
    )
  }

  try {
    const analysis = analyzeConversation(messages)
    const strategy = generateStrategy(body.match_profile || {}, messages, analysis)
    const flags = detectRedFlags(messages)
    const summary = redFlagSummary(flags)

    return NextResponse.json({
      analysis,
      strategy,
      red_flags: summary,
      ...(body.include_prompt_block ? { strategy_prompt: renderStrategyForPrompt(strategy) } : {}),
    })
  } catch (err) {
    console.error('conversation/analyze error:', err)
    return NextResponse.json(
      { error: 'analyze_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
