'use client'

import { useState } from 'react'
import { Copy, Check, Loader2, MessageSquare, User, Mic } from 'lucide-react'

interface Suggestion {
  text: string
  tone: 'playful' | 'direct' | 'flirty'
  confidence: number
}

interface VoiceProfile {
  style_summary: string | null
  tone: string | null
  sample_phrases: string[]
  messages_analyzed: number
}

const toneColors: Record<string, string> = {
  playful: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  direct: 'bg-green-500/20 text-green-300 border-green-500/30',
  flirty: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
}

const platforms = ['Tinder', 'Bumble', 'Hinge', 'iMessage']

export default function ConversationPage() {
  const [conversationContext, setConversationContext] = useState('')
  const [matchName, setMatchName] = useState('')
  const [platform, setPlatform] = useState('Tinder')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  // Voice profile state
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null)
  const [sampleMessages, setSampleMessages] = useState('')
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [showVoiceSetup, setShowVoiceSetup] = useState(false)

  async function handleGenerate() {
    if (!conversationContext.trim() || !matchName.trim()) return

    setLoading(true)
    setSuggestions([])
    try {
      const res = await fetch('/api/conversation/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationContext, matchName, platform }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || data.message || 'Failed to generate replies')
        return
      }
      const data = await res.json()
      setSuggestions(data.suggestions || [])
    } catch {
      alert('Failed to generate reply suggestions')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy(text: string, index: number) {
    await navigator.clipboard.writeText(text)
    setCopied(index)
    setTimeout(() => setCopied(null), 2000)
  }

  async function handleVoiceProfile() {
    const messages = sampleMessages
      .split('\n')
      .map((m) => m.trim())
      .filter((m) => m.length > 0)

    if (messages.length < 5) {
      alert('Please provide at least 5 sample messages (one per line)')
      return
    }

    setVoiceLoading(true)
    try {
      const res = await fetch('/api/conversation/voice-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleMessages: messages }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Failed to analyze voice')
        return
      }
      const data = await res.json()
      setVoiceProfile(data.profile)
      setShowVoiceSetup(false)
      setSampleMessages('')
    } catch {
      alert('Failed to update voice profile')
    } finally {
      setVoiceLoading(false)
    }
  }

  // Load voice profile on mount
  useState(() => {
    fetch('/api/conversation/voice-profile')
      .then((r) => r.json())
      .then((data) => {
        if (data.profile) setVoiceProfile(data.profile)
      })
      .catch(() => {})
  })

  return (
    <div className="min-h-screen bg-black px-6 py-8">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="orb w-96 h-96 bg-brand-600"
          style={{ top: '10%', left: '50%', transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="relative max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <MessageSquare className="w-6 h-6 text-brand-400" />
          <h1 className="text-2xl font-bold text-white">Conversation AI</h1>
        </div>

        {/* Voice Profile Card */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-brand-400" />
              <h2 className="text-white font-semibold text-sm">Voice Profile</h2>
            </div>
            <button
              onClick={() => setShowVoiceSetup(!showVoiceSetup)}
              className="text-brand-400 hover:text-brand-300 text-xs transition-colors"
            >
              {voiceProfile ? 'Update' : 'Set up'}
            </button>
          </div>

          {voiceProfile ? (
            <div>
              <p className="text-white/60 text-sm">{voiceProfile.style_summary}</p>
              <p className="text-white/30 text-xs mt-1">
                Tone: {voiceProfile.tone} | Analyzed from {voiceProfile.messages_analyzed} messages
              </p>
            </div>
          ) : (
            <p className="text-white/40 text-sm">
              No voice profile yet. Set one up so AI replies sound like you.
            </p>
          )}

          {showVoiceSetup && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <label className="text-white/60 text-xs block mb-2">
                Paste your sample messages (one per line, at least 5):
              </label>
              <textarea
                value={sampleMessages}
                onChange={(e) => setSampleMessages(e.target.value)}
                placeholder={"hey what's up\nlol that's wild\nwanna grab coffee sometime?\nyeah I'm down\nhaha no way"}
                rows={6}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-500/50 resize-none"
              />
              <button
                onClick={handleVoiceProfile}
                disabled={voiceLoading}
                className="mt-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {voiceLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  'Analyze my voice'
                )}
              </button>
            </div>
          )}
        </div>

        {/* Conversation Input */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-white/60 text-xs block mb-1.5">Match name</label>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                <User className="w-4 h-4 text-white/30" />
                <input
                  type="text"
                  value={matchName}
                  onChange={(e) => setMatchName(e.target.value)}
                  placeholder="Their name"
                  className="bg-transparent text-white text-sm placeholder:text-white/20 focus:outline-none w-full"
                />
              </div>
            </div>
            <div>
              <label className="text-white/60 text-xs block mb-1.5">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500/50 appearance-none"
              >
                {platforms.map((p) => (
                  <option key={p} value={p} className="bg-black">
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="text-white/60 text-xs block mb-1.5">Paste the conversation so far</label>
          <textarea
            value={conversationContext}
            onChange={(e) => setConversationContext(e.target.value)}
            placeholder={"Them: Hey! I saw you like hiking too\nYou: Yeah I love it! Did the Half Dome trail last summer\nThem: No way that's on my bucket list. Any tips?"}
            rows={6}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-500/50 resize-none mb-4"
          />

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
              Reply Suggestions
            </h2>
            {suggestions.map((s, index) => (
              <div
                key={index}
                className="bg-white/5 border border-white/10 rounded-xl p-4 group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      toneColors[s.tone] || toneColors.playful
                    }`}
                  >
                    {s.tone}
                  </span>
                  <button
                    onClick={() => handleCopy(s.text, index)}
                    className="text-white/30 hover:text-white/70 transition-colors p-1"
                  >
                    {copied === index ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-white text-sm">{s.text}</p>
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
