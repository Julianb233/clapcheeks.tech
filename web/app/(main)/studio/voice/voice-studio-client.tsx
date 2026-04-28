'use client'

/**
 * /studio/voice — client UI (AI-8763).
 *
 * Renders:
 *   - Stats card (msg count, avg length, emoji freq)
 *   - "Re-train from chat.db" button — fires the local CLI via a
 *     copyable command. (We can't run chat.db scans server-side because
 *     the operator's Mac holds chat.db; running it remotely would
 *     violate the agent's data-locality contract.)
 *   - Top phrases + openers + slang
 *   - 24-hour time-of-day chart (CSS bars, no extra deps)
 *   - Tone calibration: pick 5 sample messages that feel "most like me"
 *     to boost in the few-shot prompt.
 *   - Privacy footnote.
 */
import { useState, useTransition } from 'react'
import {
  Mic,
  RefreshCw,
  Check,
  Copy,
  Sparkles,
  ShieldCheck,
  Clock,
  Hash,
  Smile,
} from 'lucide-react'

export interface Digest {
  message_count?: number
  avg_length_chars?: number
  median_length_chars?: number
  emoji_per_message?: number
  most_common_openers?: string[]
  common_phrases?: string[]
  slang_dictionary?: string[]
  time_of_day_clusters?: Record<string, number>
  sample_messages?: string[]
  computed_at?: string
}

export interface VoiceProfile {
  user_id?: string
  style_summary?: string | null
  tone?: string | null
  sample_phrases?: string[] | null
  profile_data?: Record<string, unknown> | null
  messages_analyzed?: number | null
  digest?: Digest | null
  boosted_samples?: string[] | null
  last_scan_at?: string | null
  updated_at?: string | null
}

const SCAN_COMMAND = 'clapcheeks voice scan'

export default function VoiceStudioClient({
  initialProfile,
}: {
  initialProfile: VoiceProfile | null
}) {
  const [profile, setProfile] = useState<VoiceProfile | null>(initialProfile)
  const [boosted, setBoosted] = useState<string[]>(
    initialProfile?.boosted_samples ?? []
  )
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const digest: Digest | null = profile?.digest ?? null
  const samples = digest?.sample_messages ?? []
  const sampleSlice = samples.slice(0, 10)

  const refresh = () => {
    startRefresh(async () => {
      const r = await fetch('/api/voice/train', { cache: 'no-store' })
      const json = await r.json()
      setProfile(json.profile ?? null)
      setBoosted(json.profile?.boosted_samples ?? [])
    })
  }

  const toggleBoost = (msg: string) => {
    setBoosted((prev) => {
      if (prev.includes(msg)) return prev.filter((m) => m !== msg)
      if (prev.length >= 5) return prev
      return [...prev, msg]
    })
  }

  const saveBoosted = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/voice/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boostedSamples: boosted }),
      })
      const json = await r.json()
      if (!r.ok) {
        alert(json.error ?? 'Failed to save')
        return
      }
      setProfile((p) => ({
        ...(p ?? {}),
        boosted_samples: json.profile?.boosted_samples ?? boosted,
      }))
      setSavedAt(new Date().toLocaleTimeString())
    } finally {
      setSaving(false)
    }
  }

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(SCAN_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* no-op */
    }
  }

  return (
    <div className="min-h-screen bg-black px-4 md:px-8 py-6 md:py-10 text-white">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div className="flex items-center gap-3 text-blue-400 text-sm font-medium mb-2">
            <Mic className="w-4 h-4" />
            Voice Training
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Train Clapcheeks on your real texting style
          </h1>
          <p className="text-zinc-400 mt-3 max-w-2xl">
            We analyse your past iMessage sends locally and feed the AI
            actual examples of how you write. The digest plus your tone
            calibration picks become few-shot examples for every reply
            suggestion.
          </p>
        </header>

        {/* Re-train card */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-600/20 p-2 text-blue-300">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <div className="font-medium">Re-train from chat.db</div>
                <div className="text-sm text-zinc-400 mt-1">
                  Runs a local read-only scan of{' '}
                  <code className="text-zinc-300">
                    ~/Library/Messages/chat.db
                  </code>
                  . Only the digest leaves your Mac.
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyCmd}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 hover:bg-white/15 px-3 py-2 text-sm transition"
                aria-label="Copy CLI command"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <code className="text-xs">{SCAN_COMMAND}</code>
                  </>
                )}
              </button>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-3 py-2 text-sm font-medium transition"
              >
                <RefreshCw
                  className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
                />
                {refreshing ? 'Reloading…' : 'Refresh digest'}
              </button>
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            Last scan:{' '}
            {profile?.last_scan_at
              ? new Date(profile.last_scan_at).toLocaleString()
              : digest?.computed_at
                ? new Date(digest.computed_at).toLocaleString()
                : 'never — run the CLI command above on your Mac'}
          </div>
        </section>

        {/* Stats grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Stat
            icon={<Hash className="w-4 h-4" />}
            label="Messages analysed"
            value={
              digest?.message_count?.toLocaleString() ??
              profile?.messages_analyzed?.toLocaleString() ??
              '—'
            }
          />
          <Stat
            icon={<Sparkles className="w-4 h-4" />}
            label="Avg length"
            value={
              digest?.avg_length_chars
                ? `${Math.round(digest.avg_length_chars)} chars`
                : '—'
            }
            sub={
              digest?.median_length_chars
                ? `median ${digest.median_length_chars}`
                : undefined
            }
          />
          <Stat
            icon={<Smile className="w-4 h-4" />}
            label="Emoji frequency"
            value={
              typeof digest?.emoji_per_message === 'number'
                ? `${Math.round(digest.emoji_per_message * 100)}%`
                : '—'
            }
          />
          <Stat
            icon={<Clock className="w-4 h-4" />}
            label="Boosted samples"
            value={`${boosted.length}/5`}
            sub="picked below"
          />
        </section>

        {/* Top phrases / openers / slang */}
        <section className="grid md:grid-cols-3 gap-4 mb-8">
          <PillBlock
            title="Top openers"
            items={(digest?.most_common_openers ?? []).slice(0, 12)}
            empty="No openers yet — run a scan."
          />
          <PillBlock
            title="Common phrases"
            items={(digest?.common_phrases ?? []).slice(0, 8)}
            empty="No recurring phrases captured."
          />
          <PillBlock
            title="Your slang"
            items={(digest?.slang_dictionary ?? []).slice(0, 12)}
            empty="No slang detected. (Maybe you write more formally than you think.)"
          />
        </section>

        {/* Time-of-day chart */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">When you text</h2>
            <span className="text-xs text-zinc-500">24h cluster</span>
          </div>
          <TimeOfDayChart clusters={digest?.time_of_day_clusters ?? {}} />
        </section>

        {/* Tone calibration */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="font-medium">Tone calibration</h2>
              <p className="text-sm text-zinc-400 mt-1 max-w-xl">
                Pick the 5 messages that sound MOST like you. Boosted picks
                are placed first in every few-shot prompt — they pull the
                model harder toward your real voice.
              </p>
            </div>
            <button
              onClick={saveBoosted}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-3 py-2 text-sm font-medium transition"
            >
              {saving ? 'Saving…' : 'Save picks'}
            </button>
          </div>

          {sampleSlice.length === 0 ? (
            <div className="text-sm text-zinc-500 italic">
              Run <code>clapcheeks voice scan</code> to populate samples.
            </div>
          ) : (
            <ul className="space-y-2">
              {sampleSlice.map((msg) => {
                const active = boosted.includes(msg)
                return (
                  <li key={msg}>
                    <button
                      type="button"
                      onClick={() => toggleBoost(msg)}
                      className={`w-full text-left rounded-xl border px-4 py-3 transition flex items-start gap-3 ${
                        active
                          ? 'border-blue-500 bg-blue-600/10'
                          : 'border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div
                        className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          active
                            ? 'border-blue-400 bg-blue-500'
                            : 'border-zinc-500'
                        }`}
                      >
                        {active ? (
                          <Check className="w-3 h-3 text-white" />
                        ) : null}
                      </div>
                      <span className="text-sm text-zinc-200">{msg}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {savedAt ? (
            <div className="mt-3 text-xs text-emerald-300">
              Saved at {savedAt}.
            </div>
          ) : null}
        </section>

        {/* Privacy */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 flex items-start gap-3 text-sm text-zinc-400">
          <ShieldCheck className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
          <div>
            <div className="text-zinc-200 font-medium mb-1">
              Only the digest is uploaded
            </div>
            No raw message text leaves your Mac. The chat.db scan runs
            locally in the agent CLI, computes aggregate stats and a small
            curated sample set, and PATCHes only that JSON to Supabase.
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-zinc-400 text-xs">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
      {sub ? <div className="text-xs text-zinc-500 mt-1">{sub}</div> : null}
    </div>
  )
}

function PillBlock({
  title,
  items,
  empty,
}: {
  title: string
  items: string[]
  empty: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-zinc-400 text-xs mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-zinc-500 italic">{empty}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className="text-xs rounded-full bg-white/10 border border-white/10 px-2 py-1 text-zinc-200"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function TimeOfDayChart({ clusters }: { clusters: Record<string, number> }) {
  const counts = Array.from({ length: 24 }, (_, h) =>
    Number(clusters[String(h)] ?? 0)
  )
  const max = Math.max(1, ...counts)
  return (
    <div
      className="grid gap-1 items-end"
      style={{
        height: 96,
        gridTemplateColumns: 'repeat(24, minmax(0, 1fr))',
      }}
    >
      {counts.map((c, h) => {
        const pct = (c / max) * 100
        return (
          <div key={h} className="flex flex-col items-center gap-1">
            <div
              className="w-full rounded-sm bg-blue-500/40 hover:bg-blue-500/70 transition"
              style={{ height: `${Math.max(4, pct)}%` }}
              title={`${h}:00 — ${c} messages`}
            />
            {h % 4 === 0 ? (
              <div className="text-[10px] text-zinc-500">{h}</div>
            ) : (
              <div className="text-[10px] text-transparent">_</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
