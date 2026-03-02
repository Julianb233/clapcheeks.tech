'use client'

import { useState, useEffect } from 'react'
import { Sparkles, ArrowUp, ArrowDown, Minus, CheckCircle, ThumbsUp, ThumbsDown } from 'lucide-react'

interface CoachingTip {
  category: string
  title: string
  tip: string
  supporting_data: string
  priority: string
}

interface BenchmarkComparison {
  metric: string
  userValue: number
  benchmark: number
  delta: number
  status: 'above' | 'below' | 'at'
}

interface CoachingData {
  score: number
  tips: CoachingTip[]
  benchmarks: BenchmarkComparison[]
  positives: string[]
  generatedAt: string
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

function getScoreColor(score: number): string {
  if (score < 40) return 'text-red-400'
  if (score <= 70) return 'text-yellow-400'
  return 'text-green-400'
}

function getScoreRingColor(score: number): string {
  if (score < 40) return 'border-red-400/60'
  if (score <= 70) return 'border-yellow-400/60'
  return 'border-green-400/60'
}

function getScoreBgColor(score: number): string {
  if (score < 40) return 'bg-red-400/10'
  if (score <= 70) return 'bg-yellow-400/10'
  return 'bg-green-400/10'
}

export default function CoachingPage() {
  const [data, setData] = useState<CoachingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedbackState, setFeedbackState] = useState<Record<number, boolean | null>>({})

  useEffect(() => {
    async function fetchCoaching() {
      try {
        const res = await fetch('/api/coaching/tips')
        if (!res.ok) {
          const errData = await res.json()
          setError(errData.error || 'Failed to load coaching data')
          return
        }
        const json: CoachingData = await res.json()
        setData(json)
      } catch {
        setError('Failed to load coaching data')
      } finally {
        setLoading(false)
      }
    }
    fetchCoaching()
  }, [])

  async function handleFeedback(tipIndex: number, helpful: boolean) {
    setFeedbackState((prev) => ({ ...prev, [tipIndex]: helpful }))

    await fetch('/api/coaching/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipIndex, helpful }),
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-6 h-6 bg-white/10 rounded animate-pulse" />
            <div className="w-32 h-6 bg-white/10 rounded animate-pulse" />
          </div>
          <div className="w-32 h-32 bg-white/5 rounded-full mx-auto mb-8 animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white/5 rounded-xl h-24 animate-pulse" />
            ))}
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white/5 rounded-xl h-32 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 animate-slide-up">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Sparkles className="w-6 h-6 text-purple-400" />
            <h1 className="text-xl md:text-2xl font-bold gradient-text">AI Coach</h1>
          </div>
          <p className="text-white/30 text-xs sm:text-sm animate-fade-in delay-150">Personalized insights from your dating data</p>
        </div>

        {/* Performance Score */}
        <div className="flex justify-center mb-10">
          <div
            className={`relative w-36 h-36 rounded-full border-4 ${getScoreRingColor(data.score)} ${getScoreBgColor(data.score)} flex flex-col items-center justify-center`}
          >
            <span className={`text-4xl font-bold ${getScoreColor(data.score)}`}>
              {data.score}
            </span>
            <span className="text-white/40 text-xs mt-1">Performance Score</span>
          </div>
        </div>

        {/* Benchmark Comparison */}
        <div className="mb-10">
          <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
            Benchmark Comparison
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.benchmarks.map((b) => (
              <div
                key={b.metric}
                className="bg-white/5 border border-white/10 rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white text-sm font-medium">{b.metric}</span>
                  <div className="flex items-center gap-1">
                    {b.status === 'above' && <ArrowUp className="w-3.5 h-3.5 text-green-400" />}
                    {b.status === 'below' && <ArrowDown className="w-3.5 h-3.5 text-red-400" />}
                    {b.status === 'at' && <Minus className="w-3.5 h-3.5 text-white/40" />}
                    <span
                      className={`text-xs font-medium ${
                        b.status === 'above' ? 'text-green-400' : b.status === 'below' ? 'text-red-400' : 'text-white/40'
                      }`}
                    >
                      {b.delta >= 0 ? '+' : ''}{(b.delta * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-white/70 text-xs">
                    You: {(b.userValue * 100).toFixed(1)}%
                  </span>
                  <span className="text-white/30 text-xs">
                    Top performers: {(b.benchmark * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top 3 Coaching Tips */}
        {data.tips.length > 0 && (
          <div className="mb-10">
            <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
              Coaching Tips
            </h2>
            <div className="space-y-3">
              {data.tips.slice(0, 3).map((tip, index) => (
                <div
                  key={index}
                  className="bg-white/5 border border-white/8 rounded-xl p-4"
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
          </div>
        )}

        {/* What's Working */}
        {data.positives.length > 0 && (
          <div className="mb-10">
            <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
              What&apos;s Working
            </h2>
            <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5">
              <ul className="space-y-3">
                {data.positives.map((insight, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <span className="text-green-300/80 text-sm">{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center pb-8">
          <p className="text-white/20 text-xs">
            Last updated: {new Date(data.generatedAt).toLocaleDateString()}
          </p>
          <p className="text-white/15 text-[10px] mt-1">
            AI analyzes your stats, never your messages
          </p>
        </div>
      </div>
    </div>
  )
}
