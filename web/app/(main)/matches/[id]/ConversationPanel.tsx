'use client'

import { useEffect, useState } from 'react'
import { ScheduleDateButton } from './ScheduleDateButton'
import { DateOutcomeButton } from './DateOutcomeButton'
import { PhotoUploadButton } from './PhotoUploadButton'
import { RescheduleButton } from './RescheduleButton'
import { FlakeButton } from './FlakeButton'

type Msg = { ts?: string; from?: 'her' | 'him'; text: string }

export function ConversationPanel({
  matchId,
  matchName,
  platform,
  stage,
  flakeCount = 0,
  rescheduleCount = 0,
}: {
  matchId: string
  matchName: string
  platform: string
  stage?: string | null
  flakeCount?: number
  rescheduleCount?: number
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [drafting, setDrafting] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [briefing, setBriefing] = useState(false)
  const [brief, setBrief] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/matches/${matchId}/conversation`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setMessages(d.messages ?? [])
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [matchId])

  const [draftSource, setDraftSource] = useState<string | null>(null)
  const [sendingIdx, setSendingIdx] = useState<number | null>(null)
  const [sentIdx, setSentIdx] = useState<number | null>(null)

  async function sendDraft(idx: number, text: string) {
    if (!confirm(`Send to ${matchName}:\n\n"${text}"`)) return
    setSendingIdx(idx)
    setErr(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setSentIdx(idx)
      // Optimistically add to local thread
      setMessages((prev) => [
        ...prev,
        { ts: new Date().toISOString(), from: 'him', text },
      ])
      setSuggestions([])
      setTimeout(() => setSentIdx(null), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSendingIdx(null)
    }
  }

  async function draft() {
    setDrafting(true)
    setErr(null)
    setSuggestions([])
    setDraftSource(null)
    try {
      // Try the local-Ollama cache first (Mac Mini worker keeps these
      // < 2 min fresh) — instant + zero API cost.
      const cached = await fetch(`/api/matches/${matchId}/cached-replies`)
      if (cached.ok) {
        const cj = (await cached.json()) as {
          suggestions?: Array<{ text: string; model?: string; generated_at?: string }>
          generated_at?: string | null
        }
        const list = (cj.suggestions ?? []).map((s) => s.text).filter(Boolean)
        if (list.length > 0) {
          setSuggestions(list)
          const model = cj.suggestions?.[0]?.model ?? 'local'
          const gen = cj.generated_at ?? cj.suggestions?.[0]?.generated_at
          const age = gen ? Math.round((Date.now() - new Date(gen).getTime()) / 1000 / 60) : null
          setDraftSource(
            age != null ? `${model} · ${age} min ago` : `${model} · cached`,
          )
          return
        }
      }
      // Fallback: live API call (counts toward usage limit).
      const ctx = messages
        .slice(-10)
        .map((m) => `${m.from === 'him' ? 'You' : matchName}: ${m.text}`)
        .join('\n')
      const res = await fetch('/api/conversation/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationContext:
            ctx || `${matchName} hasn't replied yet — open the thread.`,
          matchName,
          platform,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        suggestions?: Array<{ text?: string; reply?: string } | string>
        error?: string
        message?: string
      }
      if (!res.ok) {
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const list = (j.suggestions ?? [])
        .map((s) => (typeof s === 'string' ? s : s.text || s.reply || ''))
        .filter(Boolean)
      setSuggestions(list)
      // Live path now goes through Ollama on MacBook Pro (qwen2.5:7b)
      // unless LLM_PROVIDER is overridden to anthropic.
      setDraftSource('Ollama (live) · just now')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setDrafting(false)
    }
  }

  async function generateBrief() {
    setBriefing(true)
    setErr(null)
    setBrief(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/pre-date-brief`, {
        method: 'POST',
      })
      const j = (await res.json().catch(() => ({}))) as {
        brief?: string
        error?: string
      }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setBrief(j.brief ?? '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Brief failed')
    } finally {
      setBriefing(false)
    }
  }

  return (
    <div className="p-5 rounded-xl border border-white/10 bg-white/5">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">
          Conversation
        </h3>
        <div className="flex gap-2 flex-wrap">
          <PhotoUploadButton matchId={matchId} />
          <ScheduleDateButton matchId={matchId} matchName={matchName} />
          <RescheduleButton matchId={matchId} matchName={matchName} />
          <FlakeButton matchId={matchId} matchName={matchName} flakeCount={flakeCount} />
          <DateOutcomeButton
            matchId={matchId}
            matchName={matchName}
            stage={stage ?? null}
          />
          {(flakeCount > 0 || rescheduleCount > 0) && (
            <div className="text-[10px] text-white/40 font-mono px-2 self-center">
              {rescheduleCount > 0 && <span>{rescheduleCount}× rescheduled</span>}
              {rescheduleCount > 0 && flakeCount > 0 && <span className="mx-1">·</span>}
              {flakeCount > 0 && <span className="text-rose-400/80">{flakeCount}× flaked</span>}
            </div>
          )}
          <button
            type="button"
            onClick={() => void generateBrief()}
            disabled={briefing}
            className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-medium disabled:opacity-50"
          >
            {briefing ? 'Briefing…' : '🧭 Pre-date brief'}
          </button>
          <button
            type="button"
            onClick={() => void draft()}
            disabled={drafting}
            className="px-3 py-1.5 rounded-md bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-xs font-medium disabled:opacity-50"
          >
            {drafting ? 'Drafting…' : '✨ Draft reply in your voice'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-white/40">Loading thread…</div>
      ) : messages.length === 0 ? (
        <div className="text-xs text-white/40">No messages yet.</div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {messages.map((m, i) => {
            const mine = m.from === 'him'
            return (
              <div
                key={i}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm ${
                    mine
                      ? 'bg-blue-600/80 text-white rounded-br-sm'
                      : 'bg-white/10 text-white/90 rounded-bl-sm'
                  }`}
                >
                  <div>{m.text}</div>
                  {m.ts && (
                    <div className="text-[9px] mt-0.5 opacity-60">
                      {new Date(m.ts).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {err && <div className="mt-3 text-xs text-red-400">{err}</div>}

      {brief && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-[11px] text-white/60 font-semibold uppercase tracking-wide mb-2">
            Pre-date brief
          </div>
          <div className="text-xs text-white/85 whitespace-pre-wrap leading-relaxed bg-black/30 rounded-lg p-3 border border-white/10">
            {brief}
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[11px] text-pink-400 font-semibold uppercase tracking-wide">
              Suggested replies (your voice)
            </div>
            {draftSource && (
              <div className="text-[10px] text-white/40 font-mono">{draftSource}</div>
            )}
          </div>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="flex gap-2 items-stretch"
              >
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(s)
                  }}
                  className="flex-1 text-left p-3 rounded-lg border border-white/10 hover:border-pink-500/40 hover:bg-white/[0.07] text-sm transition-colors"
                  title="Click to copy"
                >
                  {s}
                </button>
                <button
                  type="button"
                  disabled={sendingIdx !== null}
                  onClick={() => void sendDraft(i, s)}
                  className={`px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    sentIdx === i
                      ? 'bg-emerald-600 text-white'
                      : sendingIdx === i
                        ? 'bg-pink-700 text-white/60'
                        : 'bg-pink-600 hover:bg-pink-500 text-white'
                  } disabled:opacity-50`}
                  title={`Send to ${matchName}`}
                >
                  {sentIdx === i ? '✓ Sent' : sendingIdx === i ? '…' : 'Send →'}
                </button>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-white/40 mt-2">
            Tap text to copy · Tap Send to fire it through iMessage to {matchName}.
          </div>
        </div>
      )}
    </div>
  )
}
