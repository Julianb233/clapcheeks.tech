import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-5'

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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 500 },
    )
  }

  const client = new Anthropic({ apiKey })

  const intel = (match.match_intel || {}) as Record<string, unknown>
  const stats = `messages: ${match.messages_total ?? 0} total, ${match.messages_7d ?? 0} last 7d, ratio his/her ${match.his_to_her_ratio ?? '?'}, avg reply ${match.avg_reply_hours ?? '?'}h, last activity ${match.last_activity_at ?? 'unknown'}`

  const prompt = `You are an executive coach prepping Julian for a date with ${match.name}. Output a TIGHT pre-date brief in clean markdown — no preamble, no fluff. Sections (only include if you have content):

## Who she is
1-2 sentences. Pull from bio + intel.

## What's worked so far
3 bullets max. Cite specific moments from the transcript.

## What to bring up
3 bullets. Concrete topics that move the relationship forward.

## What to avoid
2 bullets. Anything she's flagged as a turn-off or sensitive.

## Conversation lines (use her energy)
3 short lines Julian can actually say tonight, in his casual texting voice.

## Risks
1-2 bullets. What could blow this up.

INPUTS:
- Name: ${match.name}
- Bio: ${match.bio || '(none)'}
- Stage: ${match.stage}, julian_rank ${match.julian_rank}, health ${match.health_score}
- Stats: ${stats}
- Intel: ${JSON.stringify(intel).slice(0, 1500)}

LAST 30 MESSAGES:
${transcript || '(no thread yet)'}`

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n')
      .trim()

    return NextResponse.json({ brief: text, model: MODEL })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI failed' },
      { status: 500 },
    )
  }
}
