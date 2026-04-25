'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const VIBE_TAGS = [
  'chemistry',
  'funny',
  'spark',
  'kissed',
  'awkward',
  'flat',
  'hot',
  'great talker',
  'low energy',
  'flake risk',
  'second date locked',
  'overshares',
]

const NEXT_STEPS = [
  { v: 'more_dates', label: 'See again', emoji: '🔥' },
  { v: 'recurring', label: 'Make recurring', emoji: '💞' },
  { v: 'friend_zone', label: 'Friend zone', emoji: '🫂' },
  { v: 'one_and_done', label: 'One and done', emoji: '👋' },
  { v: 'undecided', label: 'TBD', emoji: '🤔' },
] as const

export function DateOutcomeButton({
  matchId,
  matchName,
  stage,
}: {
  matchId: string
  matchName: string
  stage: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [rating, setRating] = useState(3)
  const [tags, setTags] = useState<string[]>([])
  const [nextStep, setNextStep] = useState<string>('more_dates')
  const [lessons, setLessons] = useState('')
  const [hookedUp, setHookedUp] = useState(false)

  // Show button only if a date has been booked or attended.
  const showButton =
    stage === 'date_booked' || stage === 'date_attended' || stage === 'recurring'

  if (!showButton && !open) return null

  function toggleTag(t: string) {
    setTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    )
  }

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/date-outcome`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rating,
          vibe_tags: tags,
          next_step: nextStep,
          lessons: lessons || null,
          hooked_up: hookedUp,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setDone(true)
      router.refresh()
      setTimeout(() => {
        setOpen(false)
        setDone(false)
      }, 1500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 text-xs font-medium"
      >
        🎯 Log date outcome
      </button>
    )
  }

  if (done) {
    return (
      <div className="px-3 py-1.5 rounded-md bg-emerald-600/30 border border-emerald-500/40 text-xs">
        ✓ Logged.
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4">
      <div className="bg-zinc-950 border border-white/10 rounded-2xl p-5 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <div className="text-base font-semibold">How was the date with {matchName}?</div>
          <div className="text-xs text-white/50 mt-0.5">
            Feeds the ranking model so future suggestions get better.
          </div>
        </div>

        <div>
          <div className="text-xs text-white/70 mb-2">Rating</div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={`w-9 h-9 rounded-md border text-lg ${
                  n <= rating
                    ? 'bg-amber-500/30 border-amber-500/60'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                {n <= rating ? '★' : '☆'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs text-white/70 mb-2">Vibe</div>
          <div className="flex flex-wrap gap-1.5">
            {VIBE_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={`text-[11px] px-2 py-1 rounded-full border ${
                  tags.includes(t)
                    ? 'bg-pink-500/30 border-pink-500/60 text-pink-200'
                    : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs text-white/70 mb-2">Next step</div>
          <div className="grid grid-cols-2 gap-1.5">
            {NEXT_STEPS.map(({ v, label, emoji }) => (
              <button
                key={v}
                type="button"
                onClick={() => setNextStep(v)}
                className={`text-xs px-3 py-2 rounded-md border text-left ${
                  nextStep === v
                    ? 'bg-pink-600/30 border-pink-500/60'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                {emoji} {label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
          <input
            type="checkbox"
            checked={hookedUp}
            onChange={(e) => setHookedUp(e.target.checked)}
            className="accent-pink-500"
          />
          Hooked up
        </label>

        <label className="text-xs text-white/70 flex flex-col gap-1">
          Lessons / notes (optional)
          <textarea
            rows={3}
            placeholder="What worked. What didn't. What I'd do differently."
            value={lessons}
            onChange={(e) => setLessons(e.target.value)}
            className="bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm resize-none"
          />
        </label>

        {err && <div className="text-xs text-red-400">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="px-3 py-1.5 rounded-md bg-gradient-to-r from-amber-600 to-pink-600 text-xs font-medium disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save outcome'}
          </button>
        </div>
      </div>
    </div>
  )
}
