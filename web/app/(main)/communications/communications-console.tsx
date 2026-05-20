'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Send,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'

export type CommunicationMessage = {
  id: string
  text: string
  is_from_me: boolean
  sent_at: string | null
  is_auto_sent?: boolean
}

export type CommunicationThread = {
  id: string
  match_id: string | null
  match_name: string
  platform: string
  last_message: string | null
  last_message_at: string | null
  messages: CommunicationMessage[]
}

type AutonomyConfig = {
  auto_respond_enabled: boolean
  approve_replies: boolean
  ai_active: boolean | null
}

type Suggestion = {
  text: string
  tone: 'witty' | 'warm' | 'direct'
  reasoning: string
  confidence: number
}

const PLATFORM_FILTERS = ['all', 'hinge', 'tinder', 'instagram'] as const
const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function platformLabel(platform: string) {
  if (platform === 'instagram') return 'Instagram'
  if (platform === 'hinge') return 'Hinge'
  if (platform === 'tinder') return 'Tinder'
  return platform || 'Unknown'
}

function platformTone(platform: string) {
  if (platform === 'hinge') return 'border-violet-500/30 bg-violet-500/10 text-violet-200'
  if (platform === 'tinder') return 'border-rose-500/30 bg-rose-500/10 text-rose-200'
  if (platform === 'instagram') return 'border-sky-500/30 bg-sky-500/10 text-sky-200'
  return 'border-white/10 bg-white/5 text-white/60'
}

function formatWhen(value: string | null) {
  if (!value) return 'No timestamp'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'No timestamp'
  return `${TIMESTAMP_FORMATTER.format(date)} UTC`
}

function draftContext(thread: CommunicationThread) {
  const source = thread.messages.length
    ? thread.messages
    : [{
        is_from_me: false,
        text: thread.last_message || '',
      }]
  return source
    .slice(-12)
    .map((message) => `${message.is_from_me ? 'You' : 'Them'}: ${message.text}`)
    .join('\n')
}

export default function CommunicationsConsole({
  initialThreads,
  initialConfig,
}: {
  initialThreads: CommunicationThread[]
  initialConfig: AutonomyConfig
}) {
  const [threads] = useState(initialThreads)
  const [selectedId, setSelectedId] = useState(initialThreads[0]?.id ?? '')
  const [platformFilter, setPlatformFilter] = useState<(typeof PLATFORM_FILTERS)[number]>('all')
  const [query, setQuery] = useState('')
  const [config, setConfig] = useState(initialConfig)
  const [savingToggle, setSavingToggle] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase()
    return threads.filter((thread) => {
      const platformOk = platformFilter === 'all' || thread.platform === platformFilter
      const queryOk =
        !q ||
        thread.match_name.toLowerCase().includes(q) ||
        (thread.last_message || '').toLowerCase().includes(q)
      return platformOk && queryOk
    })
  }, [threads, platformFilter, query])

  const selected = threads.find((thread) => thread.id === selectedId) || filteredThreads[0] || null
  const platformCounts = useMemo(() => {
    return threads.reduce<Record<string, number>>((acc, thread) => {
      acc[thread.platform] = (acc[thread.platform] || 0) + 1
      return acc
    }, {})
  }, [threads])

  async function updateAutoRespond(nextEnabled: boolean) {
    setSavingToggle(true)
    setError(null)
    try {
      const res = await fetch('/api/autonomy-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_respond_enabled: nextEnabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update automation')
      setConfig(data.config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update automation')
    } finally {
      setSavingToggle(false)
    }
  }

  async function generateDraft() {
    if (!selected) return
    setDrafting(true)
    setSuggestions([])
    setError(null)
    try {
      const res = await fetch('/api/conversation/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationContext: draftContext(selected),
          matchName: selected.match_name,
          platform: platformLabel(selected.platform),
          profile_context: {
            source: 'communications_console',
            platform: selected.platform,
            message_count: selected.messages.length,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to generate draft')
      setSuggestions(data.suggestions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate draft')
    } finally {
      setDrafting(false)
    }
  }

  async function copyDraft(text: string, index: number) {
    await navigator.clipboard.writeText(text)
    setCopied(index)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="min-h-screen bg-black px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <MessageCircle className="h-6 w-6 text-yellow-300" />
              <h1 className="font-display text-3xl uppercase tracking-wide gold-text">
                Communications
              </h1>
            </div>
            <p className="mt-1 text-sm text-white/45">
              One operator inbox for Hinge, Tinder, and Instagram threads.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/autonomy"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/65 transition hover:border-yellow-500/35 hover:text-white"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Gates
            </Link>
            <button
              type="button"
              onClick={() => updateAutoRespond(!config.auto_respond_enabled)}
              disabled={savingToggle}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                config.auto_respond_enabled
                  ? 'border-red-500/35 bg-red-500/15 text-red-100 hover:bg-red-500/20'
                  : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
              }`}
            >
              {savingToggle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              Auto response {config.auto_respond_enabled ? 'on' : 'off'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Total threads" value={threads.length} />
          <Metric label="Hinge" value={platformCounts.hinge || 0} />
          <Metric label="Tinder" value={platformCounts.tinder || 0} />
          <Metric label="Instagram" value={platformCounts.instagram || 0} />
        </div>

        {error && (
          <div className="flex gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid min-h-[680px] gap-4 lg:grid-cols-[360px_1fr]">
          <section className="rounded-xl border border-white/10 bg-white/[0.03]">
            <div className="border-b border-white/10 p-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or message"
                className="mb-3 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-yellow-500/40"
              />
              <div className="grid grid-cols-4 gap-1">
                {PLATFORM_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setPlatformFilter(filter)}
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold capitalize transition ${
                      platformFilter === filter
                        ? 'border-yellow-500/40 bg-yellow-500/15 text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/45 hover:text-white/75'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[590px] overflow-y-auto">
              {filteredThreads.length === 0 ? (
                <div className="p-6 text-center text-sm text-white/40">
                  No synced communications for this filter.
                </div>
              ) : (
                filteredThreads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setSelectedId(thread.id)}
                    className={`block w-full border-b border-white/5 p-3 text-left transition ${
                      selected?.id === thread.id ? 'bg-yellow-500/10' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">
                          {thread.match_name}
                        </div>
                        <div className="mt-1 truncate text-xs text-white/40">
                          {thread.last_message || 'No message preview'}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${platformTone(thread.platform)}`}>
                        {platformLabel(thread.platform)}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-white/30">
                      {formatWhen(thread.last_message_at)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.03]">
            {!selected ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-white/45">
                Connect Hinge, Tinder, or Instagram and synced threads will appear here.
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{selected.match_name}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${platformTone(selected.platform)}`}>
                        {platformLabel(selected.platform)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/35">
                      Latest activity {formatWhen(selected.last_message_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={generateDraft}
                    disabled={drafting}
                    className="inline-flex items-center gap-2 rounded-lg border border-yellow-500/35 bg-yellow-500/15 px-3 py-2 text-xs font-semibold text-yellow-100 transition hover:bg-yellow-500/20 disabled:opacity-60"
                  >
                    {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Draft response
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  <div className="space-y-2">
                    {(selected.messages.length ? selected.messages : []).map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.is_from_me ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm ${
                            message.is_from_me
                              ? 'rounded-br-md bg-gradient-to-br from-pink-500 to-purple-600 text-white'
                              : 'rounded-bl-md bg-white/10 text-white/90'
                          }`}
                        >
                          <div className="whitespace-pre-wrap break-words">{message.text}</div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] opacity-70">
                            <span>{formatWhen(message.sent_at)}</span>
                            {message.is_auto_sent && <span>auto</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                    {selected.messages.length === 0 && (
                      <div className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-white/45">
                        {selected.last_message || 'No message body synced for this thread yet.'}
                      </div>
                    )}
                  </div>

                  {suggestions.length > 0 && (
                    <div className="mt-5 space-y-2 border-t border-white/10 pt-4">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                        <ShieldCheck className="h-4 w-4" />
                        Drafts stay approval gated
                      </div>
                      {suggestions.map((suggestion, index) => (
                        <div key={`${suggestion.tone}-${index}`} className="rounded-lg border border-white/10 bg-black/25 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-yellow-200">
                              {suggestion.tone} · {Math.round(suggestion.confidence * 100)}%
                            </span>
                            <button
                              type="button"
                              onClick={() => copyDraft(suggestion.text, index)}
                              className="rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
                              aria-label="Copy draft"
                            >
                              {copied === index ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                            </button>
                          </div>
                          <p className="text-sm text-white">{suggestion.text}</p>
                          {suggestion.reasoning && (
                            <p className="mt-1.5 text-xs text-white/35">{suggestion.reasoning}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-white/40">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
    </div>
  )
}
