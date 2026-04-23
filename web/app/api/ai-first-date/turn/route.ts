import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  SEED_QUESTIONS,
  getNextSeedQuestion,
  getQuestionById,
  type DateQuestion,
} from '@/lib/ai-first-date/questions'

export const runtime = 'nodejs'
export const maxDuration = 30

type Answer = { questionId: string; prompt: string; answer: string; purpose: string }

interface TurnRequest {
  lastQuestionId?: string
  lastAnswer?: string
}

interface TurnResponse {
  question: DateQuestion | null
  progress: { answered: number; total: number }
  done: boolean
}

/**
 * One "turn" of the AI First Date interview.
 * - Persists the last answer (if provided)
 * - Returns the next question (seed first, then adaptive via Claude)
 * - Flags done when enough has been gathered
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: TurnRequest = {}
  try {
    body = (await req.json()) as TurnRequest
  } catch {
    // empty body on the very first turn is fine
  }

  const { data: existing } = await supabase
    .from('user_voice_context')
    .select('answers')
    .eq('user_id', user.id)
    .maybeSingle()

  const answers: Record<string, Answer> = (existing?.answers as Record<string, Answer>) || {}

  if (body.lastQuestionId && body.lastAnswer && body.lastAnswer.trim().length > 0) {
    const q = getQuestionById(body.lastQuestionId)
    answers[body.lastQuestionId] = {
      questionId: body.lastQuestionId,
      prompt: q?.prompt ?? body.lastQuestionId,
      answer: body.lastAnswer.trim(),
      purpose: q?.purpose ?? 'adaptive',
    }

    await supabase.from('user_voice_context').upsert(
      {
        user_id: user.id,
        answers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  }

  const answeredIds = Object.keys(answers)
  const nextSeed = getNextSeedQuestion(answeredIds)

  if (nextSeed) {
    const response: TurnResponse = {
      question: nextSeed,
      progress: { answered: answeredIds.length, total: SEED_QUESTIONS.length },
      done: false,
    }
    return NextResponse.json(response)
  }

  // All seeds answered → optionally ask one adaptive follow-up, else finish.
  const shouldAdaptive = answeredIds.length < SEED_QUESTIONS.length + 3
  if (!shouldAdaptive) {
    return NextResponse.json({
      question: null,
      progress: { answered: answeredIds.length, total: SEED_QUESTIONS.length + 3 },
      done: true,
    } as TurnResponse)
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const transcript = Object.values(answers)
    .map((a) => `Q: ${a.prompt}\nA: ${a.answer}`)
    .join('\n\n')

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `You are a warm, playful woman on a first date. You've already asked the guy a bunch of questions and gotten real answers. Now ask ONE thoughtful follow-up question that digs into something he said that you're genuinely curious about — something he glossed over, contradicted himself on, or that would unlock real context for an AI dating copilot.

Rules:
- One question only, conversational, not an interview.
- Reference something specific he said.
- No therapy-speak, no "tell me more about your feelings."
- 1-2 sentences max.
- Don't ask about stuff already covered.

Return JSON: {"id": "adaptive-N", "prompt": "your question", "purpose": "what context this unlocks"}`,
    messages: [
      {
        role: 'user',
        content: `Prior Q&A:\n\n${transcript}\n\nAsk the next follow-up.`,
      },
    ],
  })

  const text = message.content
    .filter((c) => c.type === 'text')
    .map((c) => ('text' in c ? c.text : ''))
    .join('')

  let adaptive: DateQuestion | null = null
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as { id?: string; prompt?: string; purpose?: string }
      if (parsed.prompt) {
        adaptive = {
          id: parsed.id || `adaptive-${answeredIds.length - SEED_QUESTIONS.length + 1}`,
          prompt: parsed.prompt,
          purpose: parsed.purpose || 'adaptive follow-up',
        }
      }
    }
  } catch {
    // fall through
  }

  if (!adaptive) {
    return NextResponse.json({
      question: null,
      progress: { answered: answeredIds.length, total: SEED_QUESTIONS.length + 3 },
      done: true,
    } as TurnResponse)
  }

  return NextResponse.json({
    question: adaptive,
    progress: { answered: answeredIds.length, total: SEED_QUESTIONS.length + 3 },
    done: false,
  } as TurnResponse)
}
