'use client'

import { useState } from 'react'
import { Sparkles, ThumbsUp, ThumbsDown, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface CoachingTip {
  category: string
  title: string
  tip: string
  supporting_data: string
  priority: string
}

interface Feedback {
  tip_index: number
  helpful: boolean
}

interface CoachingSession {
  id: string
  tips: CoachingTip[]
  generated_at: string
  feedback: Feedback[]
}

const categoryColors: Record<string, string> = {
  timing: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  messaging: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  platform: 'bg-green-500/20 text-green-300 border-green-500/30',
  general: 'bg-white/10 text-white/60 border-white/20',
}

const priorityColors: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-yellow-400',
  low: 'text-white/40',
}

export default function CoachingSection({
  initialSession,
}: {
  initialSession: CoachingSession | null
}) {
  const [session, setSession] = useState<CoachingSession | null>(initialSession)
  const [loading, setLoading] = useState(false)
  const [feedbackState, setFeedbackState] = useState<Record<number, boolean | null>>(() => {
    if (!initialSession?.feedback) return {}
    const state: Record<number, boolean | null> = {}
    for (const f of initialSession.feedback) {
      state[f.tip_index] = f.helpful
    }
    return state
  })

  async function handleGenerate() {
    setLoading(true)
    try {
      const res = await fetch('/api/coaching/generate', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to generate tips')
        return
      }
      const data = await res.json()
      setSession(data)
      setFeedbackState({})
    } catch {
      toast.error('Failed to generate coaching tips')
    } finally {
      setLoading(false)
    }
  }

  async function handleFeedback(tipIndex: number, helpful: boolean) {
    if (!session) return

    setFeedbackState((prev) => ({ ...prev, [tipIndex]: helpful }))

    await fetch('/api/coaching/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        tipIndex,
        helpful,
      }),
    })
  }

  if (!session) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-brand-400" />
          <h2 className="text-white font-semibold">AI Coach</h2>
        </div>
        <p className="text-white/40 text-sm mb-4">
          Get personalized coaching tips based on your dating stats.
        </p>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating...
            </>
          ) : (
            'Generate your first coaching tips'
          )}
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-brand-400" />
          <h2 className="text-white font-semibold">This Week&apos;s Coaching</h2>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="text-white/40 hover:text-white/70 text-xs flex items-center gap-1 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Regenerate
        </button>
      </div>

      <div className="space-y-3">
        {session.tips.map((tip: CoachingTip, index: number) => (
          <div
            key={index}
            className="bg-white/5 border border-white/8 rounded-lg p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  categoryColors[tip.category] || categoryColors.general
                }`}
              >
                {tip.category}
              </span>
              <span className={`text-[10px] ${priorityColors[tip.priority] || ''}`}>
                {tip.priority}
              </span>
            </div>
            <h3 className="text-white font-medium text-sm mb-1">{tip.title}</h3>
            <p className="text-white/60 text-sm mb-2">{tip.tip}</p>
            <p className="text-white/30 text-xs mb-3">{tip.supporting_data}</p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleFeedback(index, true)}
                className={`p-1.5 rounded-md transition-colors ${
                  feedbackState[index] === true
                    ? 'bg-green-500/20 text-green-400'
                    : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                }`}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleFeedback(index, false)}
                className={`p-1.5 rounded-md transition-colors ${
                  feedbackState[index] === false
                    ? 'bg-red-500/20 text-red-400'
                    : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                }`}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-white/20 text-xs mt-3">
        Generated {new Date(session.generated_at).toLocaleDateString()} — AI analyzes your stats, never your messages
      </p>
    </div>
  )
}
