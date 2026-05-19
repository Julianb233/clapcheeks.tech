'use client'

import { useState, useEffect, useMemo } from 'react'
import { Copy, Check, Loader2, MessageSquare, Mic, ChevronRight, ShieldCheck, Target, AlertTriangle } from 'lucide-react'
import VoiceProfileSetup from './components/voice-profile-setup'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

interface Suggestion {
  text: string
  tone: 'witty' | 'warm' | 'direct'
  reasoning: string
  confidence: number
}

interface VoiceProfile {
  style_summary: string | null
  tone: string | null
  sample_phrases: string[]
  messages_analyzed: number
}

const toneColors: Record<string, string> = {
  witty: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  warm: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  direct: 'bg-green-500/20 text-green-300 border-green-500/30',
}

const platforms = ['Tinder', 'Bumble', 'Hinge', 'iMessage']
const replyGoals = [
  { value: 'keep_momentum', label: 'Keep momentum' },
  { value: 'ask_date', label: 'Ask for date' },
  { value: 'recover_thread', label: 'Recover thread' },
  { value: 'confirm_plan', label: 'Confirm plan' },
] as const

function countTurns(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(them|her|you|me|julian):/i.test(line)).length
}

function normalizePlatform(value: string | null) {
  if (!value) return null
  return platforms.find((platform) => platform.toLowerCase() === value.toLowerCase()) ?? value
}

export default function ConversationPage() {
  const [conversationContext, setConversationContext] = useState('')
  const [matchName, setMatchName] = useState('')
  const [platform, setPlatform] = useState('Tinder')
  const [replyGoal, setReplyGoal] = useState<(typeof replyGoals)[number]['value']>('keep_momentum')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const [sending, setSending] = useState<number | null>(null)
  const [sent, setSent] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null)
  const [showVoiceSetup, setShowVoiceSetup] = useState(false)
  const [profileLoading, setProfileLoading] = useState(true)

  // Load existing voice profile on mount
  useEffect(() => {
    fetch('/api/conversation/voice-profile')
      .then(r => r.json())
      .then(data => {
        if (data.profile) setVoiceProfile(data.profile)
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextName = params.get('matchName')
    const nextPlatform = params.get('platform')
    const nextContext = params.get('context')
    const nextGoal = params.get('goal')
    if (nextName) setMatchName(nextName)
    if (nextPlatform) setPlatform(normalizePlatform(nextPlatform) ?? nextPlatform)
    if (nextContext) setConversationContext(nextContext)
    if (replyGoals.some((goal) => goal.value === nextGoal)) {
      setReplyGoal(nextGoal as (typeof replyGoals)[number]['value'])
    }
  }, [])

  const contextHealth = useMemo(() => {
    const trimmed = conversationContext.trim()
    const turnCount = countTurns(trimmed)
    const hasRecentInbound = /^(them|her):/im.test(trimmed)
    const hasUserMessage = /^(you|me|julian):/im.test(trimmed)
    return {
      chars: trimmed.length,
      turnCount,
      ready: trimmed.length >= 40 && hasRecentInbound,
      checks: [
        { label: 'Recent inbound', ok: hasRecentInbound },
        { label: 'Your prior tone', ok: hasUserMessage || !!voiceProfile },
        { label: 'Enough context', ok: trimmed.length >= 40 || turnCount >= 2 },
      ],
    }
  }, [conversationContext, voiceProfile])

  function handleProfileComplete(profile: VoiceProfile) {
    setVoiceProfile(profile)
    setShowVoiceSetup(false)
  }

  async function handleGenerate() {
    if (!conversationContext.trim() || !matchName.trim()) return
    setLoading(true)
    setSuggestions([])
    setSent(new Set())
    setError(null)
    try {
      const res = await fetch('/api/conversation/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationContext,
          matchName,
          platform,
          profile_context: {
            reply_goal: replyGoal,
            context_turns: contextHealth.turnCount,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to generate replies')
        return
      }
      setSuggestions(data.suggestions || [])
    } catch {
      setError('Failed to generate reply suggestions')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy(text: string, index: number) {
    await navigator.clipboard.writeText(text)
    setCopied(index)
    setTimeout(() => setCopied(null), 2000)
  }

  async function handleSend(text: string, index: number) {
    setSending(index)
    try {
      const res = await fetch('/api/conversation/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, matchName, platform }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to queue reply')
        return
      }
      setSent(prev => new Set(prev).add(index))
    } catch {
      setError('Failed to queue reply')
    } finally {
      setSending(null)
    }
  }

  // Show voice setup if no profile yet and not loading
  const needsVoiceSetup = !profileLoading && !voiceProfile && !showVoiceSetup

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="orb w-96 h-96 bg-brand-600"
          style={{ top: '10%', left: '50%', transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="relative max-w-3xl mx-auto">
        <div className="mb-8 animate-slide-up">
          <div className="flex items-center gap-3 mb-2">
            <MessageSquare className="w-6 h-6 text-brand-400" />
            <h1 className="text-2xl font-bold gradient-text">Conversation AI</h1>
          </div>
          <p className="text-white/30 text-sm animate-fade-in delay-150">AI-powered reply suggestions in your voice</p>
        </div>

        <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-emerald-300">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-sm font-semibold">Approval queue mode</span>
            </div>
            <div className="text-xs text-white/50">
              Suggestions can be copied or queued. Live delivery still requires the send gate.
            </div>
          </div>
        </div>

        {/* Voice Profile Card */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-brand-400" />
              <h2 className="text-white font-semibold text-sm">Your Voice Profile</h2>
            </div>
            {voiceProfile && !showVoiceSetup && (
              <button
                onClick={() => setShowVoiceSetup(true)}
                className="text-white/30 hover:text-white/60 text-xs transition-colors"
              >
                Retrain
              </button>
            )}
          </div>

          {profileLoading ? (
            <div className="flex items-center gap-2 text-white/30 text-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading profile...
            </div>
          ) : voiceProfile && !showVoiceSetup ? (
            // Profile exists — show summary
            <div>
              <p className="text-white/70 text-sm">{voiceProfile.style_summary}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-white/30 text-xs capitalize">
                  Tone: {voiceProfile.tone}
                </span>
                <span className="text-white/20 text-xs">·</span>
                <span className="text-white/30 text-xs">
                  {voiceProfile.messages_analyzed} messages analyzed
                </span>
              </div>
              {voiceProfile.sample_phrases?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {voiceProfile.sample_phrases.slice(0, 5).map((p, i) => (
                    <span
                      key={i}
                      className="text-xs bg-brand-600/20 border border-brand-500/30 text-brand-300 px-2 py-0.5 rounded-lg"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : needsVoiceSetup ? (
            // No profile — prompt to set up
            <button
              onClick={() => setShowVoiceSetup(true)}
              className="w-full flex items-center justify-between text-left group"
            >
              <div>
                <p className="text-white/60 text-sm">No voice profile yet</p>
                <p className="text-white/30 text-xs mt-0.5">
                  Set up your voice so AI replies sound exactly like you
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-brand-400 transition-colors" />
            </button>
          ) : null}

          {/* Inline voice setup */}
          {showVoiceSetup && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <VoiceProfileSetup onComplete={handleProfileComplete} />
              {voiceProfile && (
                <button
                  onClick={() => setShowVoiceSetup(false)}
                  className="mt-4 text-white/30 hover:text-white/50 text-xs transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Conversation Input */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-white/60 text-xs block mb-1.5">Match name</label>
              <VoiceInput
                type="text"
                value={matchName}
                onChange={setMatchName}
                placeholder="Their name"
                className="h-auto bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/20 focus:outline-none w-full"
              />
            </div>
            <div>
              <label className="text-white/60 text-xs block mb-1.5">Platform</label>
              <select
                value={platform}
                onChange={e => setPlatform(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 appearance-none"
              >
                {platforms.map(p => (
                  <option key={p} value={p} className="bg-black">{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-white/60 text-xs block mb-1.5">Goal</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {replyGoals.map((goal) => {
                const active = replyGoal === goal.value
                return (
                  <button
                    key={goal.value}
                    type="button"
                    onClick={() => setReplyGoal(goal.value)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      active
                        ? 'border-brand-500/60 bg-brand-600/20 text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/80'
                    }`}
                  >
                    <Target className="mb-1 h-3.5 w-3.5" />
                    {goal.label}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="text-white/60 text-xs block mb-1.5">Paste the conversation so far</label>
          <VoiceTextarea
            value={conversationContext}
            onChange={setConversationContext}
            placeholder={"Them: Hey! I saw you like hiking too\nYou: Yeah I love it! Did the Half Dome trail last summer\nThem: No way that's on my bucket list. Any tips?"}
            rows={6}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-500/50 resize-none mb-4"
          />

          <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
            {contextHealth.checks.map((check) => (
              <div
                key={check.label}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  check.ok
                    ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                    : 'border-white/10 bg-white/[0.03] text-white/40'
                }`}
              >
                {check.ok ? 'ok' : 'missing'} {check.label}
              </div>
            ))}
          </div>

          {!contextHealth.ready && conversationContext.trim() && (
            <div className="mb-4 flex gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-yellow-200/80">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Add the latest inbound line before generating. The drafts get safer when the model sees what she just said.
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading || !conversationContext.trim() || !matchName.trim()}
            className="w-full bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-3 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating replies...
              </>
            ) : (
              'Generate replies'
            )}
          </button>
        </div>

        {/* Reply Suggestions */}
        {suggestions.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">
              Reply Suggestions — in your voice
            </h2>
            {suggestions.map((s, index) => (
              <div key={index} className="bg-white/5 border border-white/10 rounded-xl p-4 group">
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      toneColors[s.tone] || toneColors.witty
                    }`}
                  >
                    {s.tone}
                  </span>
                  <div className="flex items-center gap-1">
                    {sent.has(index) ? (
                      <span className="text-green-400 text-xs flex items-center gap-1 pr-1">
                        <Check className="w-3.5 h-3.5" />
                        Queued for approval
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSend(s.text, index)}
                        disabled={sending === index}
                        className="text-white/30 hover:text-brand-400 transition-colors p-1"
                        title="Queue for approval"
                        aria-label="Queue for approval"
                      >
                        {sending === index ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleCopy(s.text, index)}
                      className="text-white/30 hover:text-white/70 transition-colors p-1"
                      aria-label="Copy reply"
                    >
                      {copied === index ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-white text-sm">{s.text}</p>
                {s.reasoning && (
                  <p className="text-white/30 text-xs mt-1.5">{s.reasoning}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
                  <span>{s.text.length} chars</span>
                  <span>approval gated</span>
                  {s.text.length > 160 && (
                    <span className="text-yellow-300">long draft</span>
                  )}
                </div>
                <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500/50 rounded-full"
                    style={{ width: `${Math.round(s.confidence * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
