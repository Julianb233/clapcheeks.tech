'use client'

import { useMemo, useState } from 'react'

/**
 * Thoughtful-question chip strip (AI-9608).
 *
 * Generates 3-5 caring/follow-up questions from intel data the agent has
 * already collected (interests, topics, prompts, life events) and renders them
 * as tap-to-copy chips on mobile. Helps the operator send something specific
 * that "shows he cares" without staring at a blank composer.
 *
 * Pure client-side template fill — no LLM call. Future: replace with a Convex
 * action that calls Claude when intel data goes deeper than these heuristics.
 */
type Props = {
  matchName?: string | null
  interests?: string[]
  topics?: string[]
  prompts?: Array<{ question?: string; answer?: string } | unknown>
  lifeEvents?: Array<{ what?: string; when?: string } | unknown>
}

function pickQuestionsFromIntel({ interests = [], topics = [], prompts = [], lifeEvents = [] }: Props): string[] {
  const out: string[] = []
  const top = (interests[0] ?? topics[0]) as string | undefined
  const second = (interests[1] ?? topics[1]) as string | undefined

  if (top) out.push(`What got you into ${top}?`)
  if (second && second !== top) out.push(`How did you discover ${second}?`)

  // Mine prompts for the most evocative answer
  for (const raw of prompts) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as { question?: string; answer?: string }
    if (typeof p.answer !== 'string' || p.answer.length < 10) continue
    const subject = p.answer.split(/[.,;!?\n]/)[0]?.trim()
    if (!subject || subject.length < 4) continue
    out.push(`You mentioned ${subject.toLowerCase()} — what was the story behind that?`)
    break
  }

  // Mine life events
  for (const raw of lifeEvents) {
    if (!raw || typeof raw !== 'object') continue
    const ev = raw as { what?: string }
    if (typeof ev.what !== 'string' || ev.what.length < 4) continue
    out.push(`How are you feeling about ${ev.what}?`)
    break
  }

  // Always keep a few generic-but-caring fallbacks
  out.push('What was the highlight of your week so far?')
  out.push('Working on anything fun outside work right now?')

  // Dedupe + cap at 5
  return Array.from(new Set(out)).slice(0, 5)
}

export default function ThoughtfulQuestions(props: Props) {
  const questions = useMemo(() => pickQuestionsFromIntel(props), [props])
  const [copied, setCopied] = useState<string | null>(null)

  if (questions.length === 0) return null

  const onCopy = async (q: string) => {
    try {
      await navigator.clipboard.writeText(q)
      setCopied(q)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // best-effort
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-widest text-white/50 font-mono">
          Thoughtful Questions
        </span>
        <span className="text-[10px] text-white/30">tap to copy</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {questions.map((q) => {
          const isCopied = copied === q
          return (
            <button
              key={q}
              type="button"
              onClick={() => onCopy(q)}
              className={`shrink-0 snap-start max-w-[80%] text-left rounded-full border px-3 py-2 text-xs leading-snug transition ${
                isCopied
                  ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-100'
                  : 'border-white/15 bg-white/5 text-white/85 hover:bg-white/10 hover:border-white/30 active:bg-white/15'
              }`}
            >
              {isCopied ? '✓ Copied' : q}
            </button>
          )
        })}
      </div>
    </div>
  )
}
