import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatComplete } from '@/lib/conversation-ai/llm-provider'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!match) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  const { data: convo } = await (supabase as any)
    .from('clapcheeks_conversations')
    .select('messages')
    .eq('user_id', user.id)
    .eq('match_id', match.match_id)
    .maybeSingle()

  const messages = Array.isArray(convo?.messages) ? convo!.messages : []
  const last30 = messages.slice(-30)
  const transcript = last30
    .map(
      (m: { from?: string; text?: string }) =>
        `${m.from === 'him' ? 'You' : match.name || 'Her'}: ${m.text ?? ''}`,
    )
    .join('\n')

  const intel = (match.match_intel || {}) as Record<string, unknown>
  const stats = `messages: ${match.messages_total ?? 0} total, ${match.messages_7d ?? 0} last 7d, ratio his/her ${match.his_to_her_ratio ?? '?'}, avg reply ${match.avg_reply_hours ?? '?'}h, last activity ${match.last_activity_at ?? 'unknown'}`

  const systemPrompt =
    'You are an executive coach prepping Julian for a date. Output a TIGHT pre-date brief in clean markdown — no preamble, no fluff. Use only the sections below if you actually have content for them. Sections:\n\n' +
    '## Who she is — 1-2 sentences from bio + intel\n' +
    "## What's worked so far — 3 bullets max, cite specific transcript moments\n" +
    '## What to bring up — 3 concrete topics that move the relationship forward\n' +
    '## What to avoid — 2 bullets on turn-offs or sensitivities\n' +
    '## Conversation lines (use her energy) — 3 short lines Julian can actually say tonight, in his casual texting voice\n' +
    '## Risks — 1-2 bullets on what could blow this up\n'

  const userPrompt = `INPUTS:
- Name: ${match.name}
- Bio: ${match.bio || '(none)'}
- Stage: ${match.stage}, julian_rank ${match.julian_rank}, health ${match.health_score}
- Stats: ${stats}
- Intel: ${JSON.stringify(intel).slice(0, 1500)}

LAST 30 MESSAGES:
${transcript || '(no thread yet)'}`

  try {
    const res = await chatComplete({
      systemPrompt,
      userPrompt,
      maxTokens: 1500,
      temperature: 0.4,
    })
    return NextResponse.json({
      brief: res.text,
      model: res.model,
      provider: res.provider,
      duration_ms: res.durationMs,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI failed' },
      { status: 500 },
    )
  }
}
