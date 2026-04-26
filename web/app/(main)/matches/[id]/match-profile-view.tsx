'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

type Photo = {
  url: string
  supabase_path?: string | null
  width?: number
  height?: number
}

type Prompt = { question?: string; answer?: string; prompt?: string; text?: string }

type MatchIntel = Record<string, unknown> & {
  notes?: string
  tags?: string[]
  interests?: string[]
  topics?: string[]
  green_flags?: string[]
  red_flags?: string[]
  opener_suggestions?: string[]
  openers?: string[]
}

type MatchRow = {
  id: string
  match_name: string | null
  name: string | null
  age: number | null
  bio: string | null
  platform: string | null
  photos_jsonb: Photo[] | null
  prompts_jsonb: Prompt[] | null
  instagram_handle: string | null
  spotify_artists: unknown
  zodiac: string | null
  job: string | null
  school: string | null
  stage: string | null
  status: string | null
  health_score: number | null
  julian_rank: number | null
  first_impression: string | null
  vision_summary: string | null
  match_intel: MatchIntel | null
  instagram_intel: Record<string, unknown> | null
  distance_miles: number | null
  final_score: number | null
  dealbreaker_flags: string[] | null
  red_flags: string[] | null
  opener_sent_at: string | null
  created_at: string | null
}

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'chatting', label: 'Chatting' },
  { value: 'date_planned', label: 'Date planned' },
  { value: 'dated', label: 'Dated' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'archived', label: 'Archived' },
]

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function getNestedList(obj: unknown, key: string): string[] {
  if (!obj || typeof obj !== 'object') return []
  return stringList((obj as Record<string, unknown>)[key])
}

type PatchBody = {
  stage?: string
  status?: string
  julian_rank?: number
  opener_sent_at?: string
  match_intel_patch?: Record<string, unknown>
}

export default function MatchProfileView({ match: initial }: { match: MatchRow }) {
  const router = useRouter()
  const [m, setM] = useState<MatchRow>(initial)
  const [active, setActive] = useState(0)

  const displayName = m.name || m.match_name || 'Unknown'
  const photos = (m.photos_jsonb ?? []).filter((p): p is Photo => !!p?.url)

  const intelInterests = getNestedList(m.match_intel, 'interests')
  const intelTopics = getNestedList(m.match_intel, 'topics')
  const intelGreen = getNestedList(m.match_intel, 'green_flags')
  const intelRed = [...(m.red_flags ?? []), ...getNestedList(m.match_intel, 'red_flags')]
  const intelOpeners = useMemo(() => {
    const fromOpeners = getNestedList(m.match_intel, 'openers')
    const fromSuggestions = getNestedList(m.match_intel, 'opener_suggestions')
    return fromOpeners.length > 0 ? fromOpeners : fromSuggestions
  }, [m.match_intel])
  const spotifyArtists = Array.isArray(m.spotify_artists)
    ? (m.spotify_artists as Array<{ name?: string } | string>)
        .map((x) => (typeof x === 'string' ? x : x?.name ?? ''))
        .filter(Boolean)
    : []

  const prompts = (m.prompts_jsonb ?? []).filter(
    (p) => p && (p.answer || p.text)
  )

  const existingTags = useMemo(
    () => stringList((m.match_intel as MatchIntel | null)?.tags),
    [m.match_intel]
  )
  const existingNotes = (m.match_intel as MatchIntel | null)?.notes ?? ''

  // Send a PATCH with optimistic update. Returns true on success.
  const patch = useCallback(
    async (
      body: PatchBody,
      optimistic: Partial<MatchRow>,
      label: string,
    ): Promise<boolean> => {
      const prev = m
      setM((cur) => ({ ...cur, ...optimistic }))
      try {
        const res = await fetch(`/api/matches/${m.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }))
          throw new Error(err.error || `Update failed (${res.status})`)
        }
        const json = await res.json()
        if (json?.match) {
          setM((cur) => ({ ...cur, ...(json.match as MatchRow) }))
        }
        return true
      } catch (e) {
        setM(prev)
        toast.error(`${label} failed: ${(e as Error).message}`)
        return false
      }
    },
    [m],
  )

  const handleStageChange = async (next: string) => {
    if (next === m.stage) return
    await patch({ stage: next }, { stage: next }, 'Stage update')
  }

  const handleRankChange = async (next: number) => {
    if (Number.isNaN(next)) return
    const clamped = Math.max(0, Math.min(10, Math.floor(next)))
    if (clamped === m.julian_rank) return
    const ok = await patch(
      { julian_rank: clamped },
      { julian_rank: clamped },
      'Rank update',
    )
    if (ok) toast.success(`Rank set to ${clamped}`)
  }

  const handleArchive = async () => {
    if (m.status === 'archived') {
      toast.message('Already archived')
      return
    }
    const prev = m
    setM((cur) => ({ ...cur, status: 'archived' }))
    try {
      const res = await fetch(`/api/matches/${m.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `Archive failed (${res.status})`)
      }
      toast.success('Match archived')
      router.push('/matches')
    } catch (e) {
      setM(prev)
      toast.error(`Archive failed: ${(e as Error).message}`)
    }
  }

  const handleCopyOpener = async (opener: string) => {
    try {
      await navigator.clipboard.writeText(opener)
    } catch {
      /* clipboard optional in some browsers */
    }
    const sentAt = new Date().toISOString()
    const ok = await patch(
      {
        opener_sent_at: sentAt,
        match_intel_patch: { last_opener_copied: opener },
      } as PatchBody,
      { opener_sent_at: sentAt } as Partial<MatchRow>,
      'Copy opener',
    )
    if (ok) toast.success('Opener copied and marked as sent')
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/matches"
          className="text-white/40 hover:text-white/70 transition-colors text-sm"
        >
          &larr; All Matches
        </Link>
      </div>

      {/* Action Bar */}
      <ActionBar
        stage={m.stage}
        rank={m.julian_rank}
        status={m.status}
        openerSentAt={m.opener_sent_at}
        openers={intelOpeners}
        onStage={handleStageChange}
        onRank={handleRankChange}
        onArchive={handleArchive}
        onCopyOpener={handleCopyOpener}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {/* Photo carousel */}
        <div>
          <div className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-gradient-to-br from-pink-900/40 to-purple-900/40 border border-white/10">
            {photos[active] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photos[active].url}
                alt={`${displayName} photo ${active + 1}`}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-6xl text-white/30">
                {displayName[0]?.toUpperCase() || '?'}
              </div>
            )}
            {photos.length > 1 && (
              <>
                <button
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-lg"
                  onClick={() =>
                    setActive((i) => (i - 1 + photos.length) % photos.length)
                  }
                  aria-label="Previous photo"
                >
                  &lsaquo;
                </button>
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-lg"
                  onClick={() => setActive((i) => (i + 1) % photos.length)}
                  aria-label="Next photo"
                >
                  &rsaquo;
                </button>
                <span className="absolute bottom-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded bg-black/70">
                  {active + 1} / {photos.length}
                </span>
              </>
            )}
          </div>
          {photos.length > 1 && (
            <div className="mt-3 grid grid-cols-6 gap-2">
              {photos.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`aspect-square rounded-md overflow-hidden border-2 transition-all ${
                    i === active
                      ? 'border-pink-500 ring-2 ring-pink-500/30'
                      : 'border-transparent hover:border-white/30'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Header + stats */}
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold">
              {displayName}
              {m.age ? (
                <span className="font-normal text-white/70">, {m.age}</span>
              ) : null}
            </h1>
            <p className="text-sm text-white/50 mt-1 uppercase tracking-wide">
              {m.platform ?? 'unknown'}
              {m.zodiac && <> &middot; {m.zodiac}</>}
              {m.distance_miles != null && <> &middot; {m.distance_miles} mi</>}
              {m.stage && <> &middot; {m.stage}</>}
            </p>
          </div>

          {(m.job || m.school) && (
            <div className="flex flex-col gap-1 text-sm text-white/70">
              {m.job && <div>&#128188; {m.job}</div>}
              {m.school && <div>&#127891; {m.school}</div>}
            </div>
          )}

          {m.instagram_handle && (
            <div className="inline-flex items-center gap-2">
              <a
                href={`https://instagram.com/${m.instagram_handle.replace(/^@/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-pink-400 hover:text-pink-300"
              >
                @{m.instagram_handle.replace(/^@/, '')}
              </a>
              {(() => {
                const intel = (m.match_intel ?? {}) as Record<string, unknown>
                const src = intel.instagram_handle_source as string | undefined
                if (src === 'message_parser') {
                  const conf = intel.instagram_handle_confidence as number | undefined
                  return (
                    <span
                      className="text-[9px] px-1 py-0.5 rounded bg-pink-500/10 text-pink-300/70 border border-pink-500/20 font-mono uppercase tracking-wider"
                      title={`Auto-extracted from her message${conf ? ` (${Math.round(conf * 100)}% confidence)` : ''}`}
                    >
                      auto
                    </span>
                  )
                }
                return null
              })()}
            </div>
          )}

          {(typeof m.julian_rank === 'number' ||
            typeof m.health_score === 'number' ||
            typeof m.final_score === 'number') && (
            <div className="flex flex-wrap gap-2">
              {typeof m.julian_rank === 'number' && (
                <StatPill label="Rank" value={`#${m.julian_rank}`} tone="pink" />
              )}
              {typeof m.health_score === 'number' && (
                <StatPill
                  label="Health"
                  value={`${m.health_score}/100`}
                  tone={
                    m.health_score >= 75
                      ? 'green'
                      : m.health_score >= 50
                        ? 'yellow'
                        : 'orange'
                  }
                />
              )}
              {typeof m.final_score === 'number' && (
                <StatPill
                  label="Score"
                  value={m.final_score.toFixed(1)}
                  tone="purple"
                />
              )}
            </div>
          )}

          {m.bio && (
            <div className="p-4 rounded-xl border border-white/10 bg-white/5">
              <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
                {m.bio}
              </p>
            </div>
          )}

          {m.first_impression && (
            <div className="p-4 rounded-xl border border-pink-500/20 bg-pink-500/5">
              <div className="text-xs text-pink-400 font-semibold uppercase tracking-wide mb-1">
                First impression
              </div>
              <p className="text-sm text-white/80">{m.first_impression}</p>
            </div>
          )}
        </div>
      </div>

      {/* Notes + Tags block */}
      <div className="mb-8">
        <NotesBlock
          matchId={m.id}
          initialNotes={existingNotes}
          initialTags={existingTags}
          onPatch={patch}
        />
      </div>

      {/* Secondary grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {prompts.length > 0 && (
          <Section title="Prompts">
            <div className="space-y-3">
              {prompts.map((p, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-black/30 border border-white/10"
                >
                  {(p.question || p.prompt) && (
                    <div className="text-[11px] text-white/50 uppercase tracking-wide mb-1">
                      {p.question || p.prompt}
                    </div>
                  )}
                  <div className="text-sm">{p.answer || p.text}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {intelInterests.length > 0 && (
          <Section title="Interests">
            <div className="flex flex-wrap gap-1.5">
              {intelInterests.map((t, i) => (
                <Chip key={i} tone="pink">
                  {t}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        {intelTopics.length > 0 && (
          <Section title="Conversation Topics">
            <div className="flex flex-wrap gap-1.5">
              {intelTopics.map((t, i) => (
                <Chip key={i} tone="purple">
                  {t}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        {(intelGreen.length > 0 || intelRed.length > 0) && (
          <Section title="Signals">
            {intelGreen.length > 0 && (
              <div className="mb-3">
                <div className="text-[11px] text-green-400 font-semibold uppercase tracking-wide mb-1">
                  Green flags
                </div>
                <div className="flex flex-wrap gap-1">
                  {intelGreen.map((t, i) => (
                    <Chip key={i} tone="green">
                      {t}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            {intelRed.length > 0 && (
              <div>
                <div className="text-[11px] text-red-400 font-semibold uppercase tracking-wide mb-1">
                  Red flags
                </div>
                <div className="flex flex-wrap gap-1">
                  {intelRed.map((t, i) => (
                    <Chip key={i} tone="red">
                      {t}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {spotifyArtists.length > 0 && (
          <Section title="Spotify">
            <div className="flex flex-wrap gap-1.5">
              {spotifyArtists.slice(0, 20).map((t, i) => (
                <Chip key={i} tone="green">
                  {t}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        {(m.dealbreaker_flags?.length ?? 0) > 0 && (
          <Section title="Dealbreakers">
            <div className="flex flex-wrap gap-1.5">
              {m.dealbreaker_flags!.map((t, i) => (
                <Chip key={i} tone="red">
                  {t}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        {m.vision_summary && (
          <Section title="Photo Vision Summary">
            <p className="text-sm text-white/70 whitespace-pre-wrap">
              {m.vision_summary}
            </p>
          </Section>
        )}
      </div>
    </div>
  )
}

/* --------------------------------- Action Bar --------------------------------- */

function ActionBar({
  stage,
  rank,
  status,
  openerSentAt,
  openers,
  onStage,
  onRank,
  onArchive,
  onCopyOpener,
}: {
  stage: string | null
  rank: number | null
  status: string | null
  openerSentAt: string | null
  openers: string[]
  onStage: (v: string) => void | Promise<void>
  onRank: (n: number) => void | Promise<void>
  onArchive: () => void | Promise<void>
  onCopyOpener: (opener: string) => void | Promise<void>
}) {
  const [rankInput, setRankInput] = useState<string>(
    typeof rank === 'number' ? String(rank) : '',
  )
  const [openerOpen, setOpenerOpen] = useState(false)
  const openerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setRankInput(typeof rank === 'number' ? String(rank) : '')
  }, [rank])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!openerRef.current) return
      if (!openerRef.current.contains(e.target as Node)) setOpenerOpen(false)
    }
    if (openerOpen) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [openerOpen])

  const currentStage = stage && STAGE_OPTIONS.some((o) => o.value === stage)
    ? stage
    : stage || 'new'

  const isArchived = status === 'archived'

  return (
    <div className="mb-6 p-3 rounded-xl border border-white/10 bg-white/5 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-wide text-white/50">
          Stage
        </label>
        <select
          value={currentStage}
          onChange={(e) => void onStage(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-500/40"
        >
          {STAGE_OPTIONS.some((o) => o.value === currentStage) ? null : (
            <option value={currentStage}>{currentStage}</option>
          )}
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-wide text-white/50">
          Rank
        </label>
        <input
          type="number"
          min={0}
          max={10}
          step={1}
          value={rankInput}
          onChange={(e) => setRankInput(e.target.value)}
          onBlur={() => {
            if (rankInput === '') return
            const n = parseInt(rankInput, 10)
            if (!Number.isNaN(n)) void onRank(n)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur()
            }
          }}
          className="w-16 bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-500/40"
          placeholder="0-10"
        />
      </div>

      {openers.length > 0 && (
        <div className="relative" ref={openerRef}>
          <button
            onClick={() => setOpenerOpen((v) => !v)}
            className="px-3 py-1.5 rounded-md bg-pink-600 hover:bg-pink-500 text-sm font-medium text-white transition-colors"
          >
            Copy opener
            {openerSentAt && (
              <span className="ml-2 text-[10px] text-white/70">sent</span>
            )}
          </button>
          {openerOpen && (
            <div className="absolute left-0 mt-2 z-20 w-80 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-black/90 backdrop-blur-sm shadow-xl p-2 space-y-1">
              {openers.map((o, i) => (
                <button
                  key={i}
                  onClick={async () => {
                    setOpenerOpen(false)
                    await onCopyOpener(o)
                  }}
                  className="w-full text-left text-sm p-2 rounded hover:bg-white/5 border border-transparent hover:border-pink-500/30 transition-colors"
                >
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => void onArchive()}
          disabled={isArchived}
          className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/80 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isArchived ? 'Archived' : 'Archive'}
        </button>
      </div>
    </div>
  )
}

/* --------------------------------- Notes Block --------------------------------- */

function NotesBlock({
  matchId: _matchId,
  initialNotes,
  initialTags,
  onPatch,
}: {
  matchId: string
  initialNotes: string
  initialTags: string[]
  onPatch: (
    body: PatchBody,
    optimistic: Partial<MatchRow>,
    label: string,
  ) => Promise<boolean>
}) {
  const [notes, setNotes] = useState(initialNotes)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const lastSavedNotes = useRef(initialNotes)

  const saveNotes = async () => {
    if (notes === lastSavedNotes.current) return
    setSaving(true)
    const ok = await onPatch(
      { match_intel_patch: { notes } },
      {},
      'Save note',
    )
    setSaving(false)
    if (ok) {
      lastSavedNotes.current = notes
      toast.success('Note saved')
    }
  }

  const addTag = async (raw: string) => {
    const t = raw.trim()
    if (!t) return
    if (tags.includes(t)) {
      setTagInput('')
      return
    }
    const next = [...tags, t]
    setTags(next)
    setTagInput('')
    const ok = await onPatch(
      { match_intel_patch: { tags: next } },
      {},
      'Add tag',
    )
    if (!ok) setTags(tags)
  }

  const removeTag = async (t: string) => {
    const next = tags.filter((x) => x !== t)
    setTags(next)
    const ok = await onPatch(
      { match_intel_patch: { tags: next } },
      {},
      'Remove tag',
    )
    if (!ok) setTags(tags)
  }

  return (
    <div className="p-5 rounded-xl border border-white/10 bg-white/5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
          Notes
        </h2>
        <button
          onClick={() => void saveNotes()}
          disabled={saving || notes === lastSavedNotes.current}
          className="text-[11px] px-2 py-1 rounded-md bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save note'}
        </button>
      </div>
      <VoiceTextarea
        value={notes}
        onChange={setNotes}
        onBlur={() => void saveNotes()}
        placeholder="Quick notes about this match — vibes, quirks, follow-ups..."
        className="w-full min-h-[100px] bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500/40 resize-y"
      />

      <div className="mt-4">
        <div className="text-[11px] text-white/50 uppercase tracking-wide mb-2">
          Tags
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-pink-500/10 text-pink-300 border-pink-500/20"
            >
              {t}
              <button
                onClick={() => void removeTag(t)}
                className="text-pink-300/70 hover:text-white"
                aria-label={`Remove ${t}`}
              >
                &times;
              </button>
            </span>
          ))}
          {tags.length === 0 && (
            <span className="text-[11px] text-white/30">No tags yet</span>
          )}
        </div>
        <VoiceInput
          type="text"
          value={tagInput}
          onChange={setTagInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void addTag(tagInput)
            } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
              void removeTag(tags[tags.length - 1])
            }
          }}
          placeholder="Add a tag and press Enter"
          className="w-full h-auto bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500/40"
        />
      </div>
    </div>
  )
}

/* --------------------------------- UI bits --------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-xl border border-white/10 bg-white/5">
      <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wide mb-3">
        {title}
      </h2>
      {children}
    </div>
  )
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'pink' | 'purple' | 'green' | 'red' | 'yellow'
}) {
  const map = {
    pink: 'bg-pink-500/10 text-pink-300 border-pink-500/20',
    purple: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    green: 'bg-green-500/10 text-green-300 border-green-500/20',
    red: 'bg-red-500/10 text-red-300 border-red-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20',
  }
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full border ${map[tone]}`}
    >
      {children}
    </span>
  )
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'pink' | 'purple' | 'green' | 'yellow' | 'orange'
}) {
  const map = {
    pink: 'bg-pink-500/10 text-pink-300 border-pink-500/20',
    purple: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    green: 'bg-green-500/10 text-green-300 border-green-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20',
    orange: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
  }
  return (
    <div className={`px-3 py-1.5 rounded-lg border ${map[tone]}`}>
      <div className="text-[9px] uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}
