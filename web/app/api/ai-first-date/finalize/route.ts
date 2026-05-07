import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: voice_context now lives on Convex.

export const runtime = 'nodejs'
export const maxDuration = 60

type Answer = { questionId: string; prompt: string; answer: string; purpose: string }

/**
 * Finalize the AI First Date interview: synthesize a dating persona blob +
 * a short summary the agent can quote. Marks completed_at.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const convex = getConvexServerClient()
  const row = await convex.query(api.voice.getContext, { user_id: user.id })

  const answers: Record<string, Answer> = (row?.answers as Record<string, Answer>) || {}
  const entries = Object.values(answers)
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No answers yet' }, { status: 400 })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const transcript = entries
    .map((a) => `Q: ${a.prompt}\nA: ${a.answer}`)
    .join('\n\n')

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1400,
    system: `You are synthesizing a dating persona for an AI co-pilot that will match, message, and plan dates on behalf of this user. Input is his first-date-style interview (questions + his voice-transcribed answers).

Return strict JSON with three fields:

{
  "summary": "a 2-3 sentence summary another AI could use as system context",
  "persona_blob": "a rich 300-500 word block the AI co-pilot can quote from when drafting messages. Cover: who he is, what he's looking for, his dating style, turn-ons, dealbreakers, humor, texting style, and 2-3 distinctive quirks in his own words (quote him when you can)",
  "tags": ["short","tags","for","filtering"]
}

No preamble, no trailing commentary. Just the JSON.`,
    messages: [
      {
        role: 'user',
        content: `Interview transcript:\n\n${transcript}`,
      },
    ],
  })

  const text = message.content
    .filter((c) => c.type === 'text')
    .map((c) => ('text' in c ? c.text : ''))
    .join('')

  let summary = ''
  let personaBlob = ''
  let tags: string[] = []
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as {
        summary?: string
        persona_blob?: string
        tags?: string[]
      }
      summary = parsed.summary || ''
      personaBlob = parsed.persona_blob || ''
      tags = Array.isArray(parsed.tags) ? parsed.tags : []
    }
  } catch (err) {
    console.error('finalize parse error', err)
  }

  const nowMs = Date.now()
  await convex.mutation(api.voice.upsertContext, {
    user_id: user.id,
    answers,
    summary,
    persona_blob: personaBlob,
    completed_at: nowMs,
  })

  return NextResponse.json({
    summary,
    persona_blob: personaBlob,
    tags,
    completed_at: new Date(nowMs).toISOString(),
  })
}
