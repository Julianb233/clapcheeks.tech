'use client'

import { useState } from 'react'
import { Check, Plus, X, Loader2, Sparkles } from 'lucide-react'
import { VoiceInput } from '@/components/voice'

interface VoiceProfile {
  style_summary: string | null
  tone: string | null
  sample_phrases: string[]
  messages_analyzed: number
}

interface Props {
  onComplete: (profile: VoiceProfile) => void
}

// Curated sample messages grouped by style — users tap the ones that sound like them
const STYLE_GROUPS = [
  {
    label: "How you open",
    samples: [
      "hey! saw you like hiking too \u2014 what\u0027s your favorite trail?",
      "Okay your dog is literally the cutest thing I\u0027ve ever seen",
      "Hi, I noticed we have a lot in common. Would love to chat sometime.",
      "lmaoo your third photo is sending me \ud83d\ude2d",
      "okay so your answer to that prompt is actually perfect",
      "Hey! How\u0027s your week going so far?",
      "ngl your bio made me laugh out loud",
      "So... do you actually rock climb or is that just for the photo \ud83d\udc40",
    ],
  },
  {
    label: "How you keep it going",
    samples: [
      "that\u2019s actually so funny because the same thing happened to me",
      "wait no way, I love that place too",
      "ok now I need to know more about this story lol",
      "That\u2019s really cool. What got you into it?",
      "hahaha okay that\u2019s hilarious",
      "I feel like we have the same vibe honestly",
      "you seem really genuine which is rare on here tbh",
      "okay so tell me something weird about yourself",
    ],
  },
  {
    label: "How you move things forward",
    samples: [
      "we should grab coffee sometime",
      "okay we\u2019re clearly vibing, wanna just get drinks?",
      "I feel like this convo would be way better in person lol",
      "Would you want to continue this over dinner sometime?",
      "honestly let\u2019s just cut to it \u2014 are you free this weekend?",
      "give me your number and let\u2019s actually make plans",
      "I\u2019d love to meet up if you\u2019re down",
      "this is fun, we should do this irl",
    ],
  },
  {
    label: "Your vibe",
    samples: [
      "lol",
      "haha",
      "omg",
      "honestly",
      "ngl",
      "lowkey",
      "literally",
      "wait what",
      "no way",
      "that\u2019s crazy",
      "I mean\u2026",
      "tbh",
    ],
  },
]

export default function VoiceProfileSetup({ onComplete }: Props) {
  const [step, setStep] = useState<'select' | 'custom' | 'analyzing'>('select')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [customMessages, setCustomMessages] = useState<string[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  function toggleSample(msg: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(msg)) next.delete(msg)
      else next.add(msg)
      return next
    })
  }

  function addCustom() {
    const trimmed = newMessage.trim()
    if (!trimmed) return
    setCustomMessages(prev => [...prev, trimmed])
    setNewMessage('')
  }

  function removeCustom(i: number) {
    setCustomMessages(prev => prev.filter((_, idx) => idx !== i))
  }

  async function analyze() {
    const allMessages = [...Array.from(selected), ...customMessages]
    if (allMessages.length < 3) {
      setError('Pick at least 3 messages so we can learn your style.')
      return
    }
    setError(null)
    setStep('analyzing')

    try {
      const res = await fetch('/api/conversation/voice-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleMessages: allMessages }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to analyze')
      onComplete(data.profile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStep('custom')
    }
  }

  const totalSelected = selected.size + customMessages.length

  if (step === 'analyzing') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
        <p className="text-white/60 text-sm">Learning your voice...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-white font-semibold text-lg mb-1">Set up your voice</h2>
        <p className="text-white/40 text-sm">
          Tap the messages that sound like something you'd actually send. The AI will learn your style and reply as you.
        </p>
      </div>

      {/* Sample message groups */}
      {step === 'select' && (
        <div className="space-y-6">
          {STYLE_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.samples.map(msg => {
                  const isSelected = selected.has(msg)
                  return (
                    <button
                      key={msg}
                      onClick={() => toggleSample(msg)}
                      className={`px-3 py-2 rounded-xl text-sm border transition-all text-left ${
                        isSelected
                          ? 'bg-brand-600/30 border-brand-500/60 text-white'
                          : 'bg-white/5 border-white/10 text-white/60 hover:border-white/30 hover:text-white/80'
                      }`}
                    >
                      {isSelected && <Check className="inline w-3 h-3 mr-1.5 text-brand-400" />}
                      {msg}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2">
            <span className="text-white/30 text-xs">
              {totalSelected} selected {totalSelected < 3 && '(need 3+)'}
            </span>
            <button
              onClick={() => setStep('custom')}
              className="text-brand-400 hover:text-brand-300 text-sm transition-colors"
            >
              Add your own messages →
            </button>
          </div>
        </div>
      )}

      {/* Custom messages step */}
      {step === 'custom' && (
        <div className="space-y-4">
          <p className="text-white/40 text-sm">
            Add real messages you've sent — copy/paste from your phone if you want.
            The more specific, the better the AI match.
          </p>

          {/* Existing custom messages */}
          {customMessages.length > 0 && (
            <div className="space-y-2">
              {customMessages.map((msg, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5"
                >
                  <span className="text-white/80 text-sm flex-1">{msg}</span>
                  <button
                    onClick={() => removeCustom(i)}
                    className="text-white/20 hover:text-white/50 flex-shrink-0 mt-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2">
            <VoiceInput
              type="text"
              value={newMessage}
              onChange={setNewMessage}
              onKeyDown={e => e.key === 'Enter' && addCustom()}
              placeholder={"e.g. \"omg that\u2019s so funny, okay but seriously...\""}
              className="flex-1 h-auto bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50"
            />
            <button
              onClick={addCustom}
              disabled={!newMessage.trim()}
              className="px-3 py-2.5 bg-brand-600/30 border border-brand-500/40 rounded-xl text-brand-300 hover:bg-brand-600/50 disabled:opacity-30 transition-all"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setStep('select')}
            className="text-white/30 hover:text-white/50 text-sm transition-colors"
          >
            ← Back to samples
          </button>
        </div>
      )}

      {/* Selected summary + selected samples (shown in custom step) */}
      {step === 'custom' && selected.size > 0 && (
        <div>
          <p className="text-white/30 text-xs mb-2">{selected.size} samples selected</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(selected).map(msg => (
              <span
                key={msg}
                className="text-xs bg-brand-600/20 border border-brand-500/30 text-brand-300 px-2 py-1 rounded-lg"
              >
                {msg.length > 40 ? msg.slice(0, 40) + '…' : msg}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {/* CTA */}
      <button
        onClick={analyze}
        disabled={totalSelected < 3}
        className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 disabled:opacity-30 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all"
      >
        <Sparkles className="w-4 h-4" />
        Analyze my style ({totalSelected} messages)
      </button>
    </div>
  )
}
