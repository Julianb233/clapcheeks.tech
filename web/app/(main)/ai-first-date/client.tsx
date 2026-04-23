'use client'

import * as React from 'react'
import { ArrowRight, Check, Heart, Loader2, SkipForward, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { VoiceTextarea } from '@/components/voice'

interface Question {
  id: string
  prompt: string
  purpose?: string
  whisperHint?: string
}

interface TurnResponse {
  question: Question | null
  progress: { answered: number; total: number }
  done: boolean
}

interface FinalizeResponse {
  summary: string
  persona_blob: string
  tags: string[]
  completed_at: string
}

type Phase = 'loading' | 'answering' | 'finalizing' | 'done' | 'error'

export function AiFirstDateClient() {
  const [phase, setPhase] = React.useState<Phase>('loading')
  const [question, setQuestion] = React.useState<Question | null>(null)
  const [answer, setAnswer] = React.useState('')
  const [progress, setProgress] = React.useState({ answered: 0, total: 20 })
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<FinalizeResponse | null>(null)

  const fetchNext = React.useCallback(
    async (lastQuestionId?: string, lastAnswer?: string) => {
      setSubmitting(true)
      setError(null)
      try {
        const res = await fetch('/api/ai-first-date/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastQuestionId, lastAnswer }),
        })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          throw new Error((detail as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as TurnResponse
        setProgress(data.progress)
        if (data.done || !data.question) {
          void finalize()
        } else {
          setQuestion(data.question)
          setAnswer('')
          setPhase('answering')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Something went wrong'
        setError(msg)
        setPhase('error')
      } finally {
        setSubmitting(false)
      }
    },
    [],
  )

  const finalize = React.useCallback(async () => {
    setPhase('finalizing')
    try {
      const res = await fetch('/api/ai-first-date/finalize', { method: 'POST' })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error((detail as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as FinalizeResponse
      setSummary(data)
      setPhase('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Finalize failed'
      setError(msg)
      setPhase('error')
    }
  }, [])

  React.useEffect(() => {
    void fetchNext()
  }, [fetchNext])

  const handleSubmit = () => {
    if (!question || !answer.trim()) return
    void fetchNext(question.id, answer)
  }

  const handleSkip = () => {
    if (!question) return
    void fetchNext(question.id, '')
  }

  const pct = progress.total > 0 ? Math.round((progress.answered / progress.total) * 100) : 0

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-primary text-sm uppercase tracking-wide">
          <Heart className="h-4 w-4" />
          <span>AI First Date</span>
        </div>
        <h1 className="text-3xl font-semibold">Let&apos;s get to know you.</h1>
        <p className="text-muted-foreground">
          Talk to me like we&apos;re on a first date. Tap the mic, speak freely — I&apos;ll
          transcribe, then ask the next thing. Your answers teach your AI co-pilot who
          you actually are, so it can text, match, and plan dates that sound like you.
        </p>
      </header>

      <Progress value={pct} className="h-1.5" />
      <p className="text-xs text-muted-foreground">
        {progress.answered} / {progress.total} answered
      </p>

      {phase === 'loading' && (
        <Card className="p-8 flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Warming up…</span>
        </Card>
      )}

      {phase === 'answering' && question && (
        <Card className="p-6 space-y-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Her</p>
            <p className="text-lg leading-relaxed">{question.prompt}</p>
          </div>
          <VoiceTextarea
            value={answer}
            onChange={setAnswer}
            placeholder="Tap the mic and talk. Or type. Whatever's easier."
            voicePrompt={question.whisperHint}
            rows={6}
            className="min-h-[160px] resize-y"
          />
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={handleSkip}
              disabled={submitting}
              className="text-muted-foreground"
            >
              <SkipForward className="h-4 w-4 mr-2" />
              Skip
            </Button>
            <Button onClick={handleSubmit} disabled={!answer.trim() || submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              Next question
            </Button>
          </div>
        </Card>
      )}

      {phase === 'finalizing' && (
        <Card className="p-8 flex items-center justify-center gap-3 text-muted-foreground">
          <Sparkles className="h-5 w-5 animate-pulse" />
          <span>Writing up who you are…</span>
        </Card>
      )}

      {phase === 'done' && summary && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-500">
            <Check className="h-5 w-5" />
            <span className="font-medium">We&apos;re done. Your AI has context.</span>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Summary</p>
            <p className="leading-relaxed">{summary.summary}</p>
          </div>
          {summary.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {summary.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border bg-accent/40 px-2.5 py-0.5 text-xs"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              Show the persona the AI will use
            </summary>
            <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 p-4 text-sm leading-relaxed">
              {summary.persona_blob}
            </pre>
          </details>
          <div className="pt-2 flex gap-3">
            <Button asChild>
              <a href="/dashboard">Go to dashboard</a>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSummary(null)
                setPhase('loading')
                void fetchNext()
              }}
            >
              Add more context
            </Button>
          </div>
        </Card>
      )}

      {phase === 'error' && (
        <Card className="p-6 space-y-3">
          <p className="text-destructive font-medium">Something broke.</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => void fetchNext()}>Try again</Button>
        </Card>
      )}
    </div>
  )
}
