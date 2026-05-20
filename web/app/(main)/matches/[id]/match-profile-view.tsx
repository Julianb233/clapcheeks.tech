'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { VoiceInput, VoiceTextarea } from '@/components/voice'
import MatchPhotoImage from '@/components/matches/MatchPhotoImage'
import { getMatchIdentityStatus } from '@/lib/matches/identity'
import { normalizeMatchPhotos } from '@/lib/matches/photos'
import ConversationThread, { type ChatMessage } from './conversation-thread'
import MemoViewer from './memo-viewer'

type TabKey = 'profile' | 'conversation' | 'memo' | 'intel'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'conversation', label: 'Conversation' },
  { key: 'memo', label: 'Memo' },
  { key: 'intel', label: 'Intel' },
]

type Photo = {
  url: string
  public_url?: string | null
  publicUrl?: string | null
  signed_url?: string | null
  signedUrl?: string | null
  supabase_url?: string | null
  supabaseUrl?: string | null
  convex_url?: string | null
  convexUrl?: string | null
  image_url?: string | null
  imageUrl?: string | null
  cdn_url?: string | null
  cdnUrl?: string | null
  raw_url?: string | null
  rawUrl?: string | null
  src?: string | null
  convex_path?: string | null
  supabase_path?: string | null
  width?: number | null
  height?: number | null
}

type Prompt = { question?: string; answer?: string; prompt?: string; text?: string }

type MatchIntel = Record<string, unknown> & {
  notes?: string
  tags?: string[]
  prompts?: Prompt[]
  interests?: string[]
  topics?: string[]
  prompt_text?: string
  prompt_themes?: string[]
  profile_prompts_observed?: string[]
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
  photos?: Photo[] | null
  prompts_jsonb: Prompt[] | null
  prompts?: Prompt[] | null
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
  created_at: string | number | null
  updated_at: string | number | null
  last_activity_at: string | number | null
  birth_date: string | null
  met_at: string | null
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

function promptList(value: unknown): Prompt[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is Prompt => Boolean(v) && typeof v === 'object' && !Array.isArray(v))
    .filter((p) => Boolean(p.answer || p.text || p.question || p.prompt))
}

function getNestedList(obj: unknown, key: string): string[] {
  if (!obj || typeof obj !== 'object') return []
  return stringList((obj as Record<string, unknown>)[key])
}

function getNestedString(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null
  const record = obj as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

type PatchBody = {
  stage?: string
  status?: string
  julian_rank?: number
  opener_sent_at?: string
  name?: string
  age?: number
  bio?: string
  job?: string
  school?: string
  instagram_handle?: string
  zodiac?: string
  birth_date?: string
  met_at?: string
  first_impression?: string
  vision_summary?: string
  match_intel_patch?: Record<string, unknown>
}

function toTime(value: string | number | null | undefined) {
  if (value == null || value === '') return NaN
  return typeof value === 'number' ? value : new Date(value).getTime()
}

function formatRelative(iso: string | number | null | undefined) {
  if (!iso) return 'No timestamp'
  const time = toTime(iso)
  if (Number.isNaN(time)) return 'Invalid timestamp'
  const diffMs = Date.now() - time
  const mins = Math.max(0, Math.round(diffMs / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function formatDateTime(value: string | number | null | undefined) {
  if (!value) return 'Not set'
  const time = toTime(value)
  if (Number.isNaN(time)) return String(value)
  return new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function splitEditableList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildDraftContext({
  displayName,
  platform,
  bio,
  prompts,
  interests,
  topics,
  messages,
}: {
  displayName: string
  platform: string | null
  bio: string | null
  prompts: Prompt[]
  interests: string[]
  topics: string[]
  messages: ChatMessage[]
}) {
  const lines: string[] = []
  lines.push(`Match: ${displayName}`)
  lines.push(`Platform: ${platform ?? 'unknown'}`)
  if (bio) lines.push(`Bio: ${bio}`)
  const promptLines = prompts
    .slice(0, 4)
    .map((p) => `${p.question || p.prompt || 'Prompt'}: ${p.answer || p.text || ''}`)
    .filter(Boolean)
  if (promptLines.length) lines.push(`Profile prompts:\n${promptLines.join('\n')}`)
  const signals = [...interests, ...topics].slice(0, 12)
  if (signals.length) lines.push(`Useful hooks: ${signals.join(', ')}`)
  if (messages.length) {
    lines.push('Recent conversation:')
    for (const msg of messages.slice(-12)) {
      lines.push(`${msg.is_from_me ? 'You' : 'Them'}: ${msg.text}`)
    }
  }
  return lines.join('\n\n')
}

function formatIntelValue(value: unknown, depth = 0): string {
  if (value == null || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => formatIntelValue(item, depth + 1))
      .filter(Boolean)
      .join(', ')
      .slice(0, 1200)
  }
  if (typeof value === 'object' && depth < 3) {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key, child]) => {
        const lower = key.toLowerCase()
        return !lower.includes('token') && !lower.includes('auth') && child != null && child !== ''
      })
      .slice(0, 24)
      .map(([key, child]) => `${key.replace(/_/g, ' ')}: ${formatIntelValue(child, depth + 1)}`)
      .filter((line) => !line.endsWith(': '))
      .join(' · ')
      .slice(0, 1200)
  }
  return ''
}

export default function MatchProfileView({
  match: initial,
  conversation = [],
  memoHandle = null,
  memoInitial = null,
}: {
  match: MatchRow
  conversation?: ChatMessage[]
  memoHandle?: string | null
  memoInitial?: { content: string; updated_at: string | null } | null
}) {
  const router = useRouter()
  const [m, setM] = useState<MatchRow>(initial)
  const [active, setActive] = useState(0)
  const [tab, setTab] = useState<TabKey>('profile')
  const [briefCopied, setBriefCopied] = useState(false)

  const identity = getMatchIdentityStatus(m)
  const displayName = identity.displayName
  const photos = useMemo(() => {
    return normalizeMatchPhotos([...(m.photos_jsonb ?? []), ...(m.photos ?? [])])
  }, [m.photos, m.photos_jsonb])

  useEffect(() => {
    if (active >= photos.length) setActive(0)
  }, [active, photos.length])

  const intelInterests = getNestedList(m.match_intel, 'interests')
  const intelPromptThemes = getNestedList(m.match_intel, 'prompt_themes')
  const intelTopics = [...getNestedList(m.match_intel, 'topics'), ...intelPromptThemes]
  const intelProfilePrompts = getNestedList(m.match_intel, 'profile_prompts_observed')
  const intelPromptText =
    typeof (m.match_intel as MatchIntel | null)?.prompt_text === 'string'
      ? ((m.match_intel as MatchIntel).prompt_text ?? '')
      : ''
  const intelGreen = getNestedList(m.match_intel, 'green_flags')
  const intelRed = [...(m.red_flags ?? []), ...getNestedList(m.match_intel, 'red_flags')]
  const intelMetAt = getNestedString(m.match_intel, 'met_at', 'date_met')
  const displayMetAt = m.met_at || intelMetAt
  const displayFirstImpression =
    m.first_impression || getNestedString(m.match_intel, 'first_impression')
  const editableMatch = useMemo(
    () => ({
      ...m,
      met_at: displayMetAt,
      first_impression: displayFirstImpression,
    }),
    [m, displayMetAt, displayFirstImpression],
  )
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

  const prompts = [
    ...(m.prompts_jsonb ?? []),
    ...(m.prompts ?? []),
    ...promptList((m.match_intel as MatchIntel | null)?.prompts),
  ].filter(
    (p) => p && (p.answer || p.text)
  )

  const existingTags = useMemo(
    () => stringList((m.match_intel as MatchIntel | null)?.tags),
    [m.match_intel]
  )
  const existingNotes = (m.match_intel as MatchIntel | null)?.notes ?? ''

  const lastMessage = useMemo(() => {
    return [...conversation]
      .filter((msg) => msg.sent_at)
      .sort((a, b) => new Date(b.sent_at ?? 0).getTime() - new Date(a.sent_at ?? 0).getTime())[0]
  }, [conversation])

  const lastInbound = useMemo(() => {
    return [...conversation]
      .filter((msg) => !msg.is_from_me && msg.sent_at)
      .sort((a, b) => new Date(b.sent_at ?? 0).getTime() - new Date(a.sent_at ?? 0).getTime())[0]
  }, [conversation])

  const draftContext = useMemo(
    () =>
      buildDraftContext({
        displayName,
        platform: m.platform,
        bio: m.bio,
        prompts,
        interests: intelInterests,
        topics: intelTopics,
        messages: conversation,
      }),
    [displayName, m.platform, m.bio, prompts, intelInterests, intelTopics, conversation],
  )

  const draftHref = useMemo(() => {
    const params = new URLSearchParams()
    params.set('matchName', displayName)
    params.set('platform', m.platform ?? 'iMessage')
    params.set('context', draftContext)
    params.set('goal', lastInbound ? 'keep_momentum' : 'recover_thread')
    return `/conversation?${params.toString()}`
  }, [displayName, m.platform, draftContext, lastInbound])

  const copyDraftBrief = async () => {
    try {
      await navigator.clipboard.writeText(draftContext)
      setBriefCopied(true)
      setTimeout(() => setBriefCopied(false), 1600)
    } catch {
      toast.error('Could not copy communication brief')
    }
  }

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

      <CommunicationCommandStrip
        draftHref={draftHref}
        onCopyBrief={copyDraftBrief}
        briefCopied={briefCopied}
        messageCount={conversation.length}
        lastMessageLabel={lastMessage ? formatRelative(lastMessage.sent_at) : 'No messages'}
        lastInboundLabel={lastInbound ? formatRelative(lastInbound.sent_at) : 'No inbound yet'}
        lastSpeaker={lastMessage ? (lastMessage.is_from_me ? 'You' : 'Them') : 'None'}
        hasInbound={!!lastInbound}
      />

      <RecordTimelineStrip
        createdAt={m.created_at}
        updatedAt={m.updated_at}
        lastActivityAt={m.last_activity_at}
        openerSentAt={m.opener_sent_at}
        metAt={displayMetAt}
      />

      {/* Tabs */}
      <div className="mb-6 border-b border-white/10 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const isActive = tab === t.key
          const badge =
            t.key === 'conversation' && conversation.length > 0
              ? conversation.length
              : null
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                isActive
                  ? 'border-pink-500 text-white'
                  : 'border-transparent text-white/50 hover:text-white/80 hover:border-white/20'
              }`}
            >
              {t.label}
              {badge != null && (
                <span
                  className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${
                    isActive
                      ? 'bg-pink-500/30 text-pink-100'
                      : 'bg-white/10 text-white/60'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'conversation' && (
        <div className="mb-6">
          <ConversationThread messages={conversation} />
        </div>
      )}

      {tab === 'memo' && (
        <div className="mb-6">
          <MemoViewer
            handle={memoHandle}
            initialContent={memoInitial?.content}
            initialUpdatedAt={memoInitial?.updated_at}
          />
        </div>
      )}

      {tab === 'intel' && (
        <IntelTab
          prompts={prompts}
          intelInterests={intelInterests}
          intelTopics={intelTopics}
          intelPromptText={intelPromptText}
          intelProfilePrompts={intelProfilePrompts}
          intelGreen={intelGreen}
          intelRed={intelRed}
          spotifyArtists={spotifyArtists}
          dealbreakers={m.dealbreaker_flags ?? []}
          visionSummary={m.vision_summary}
          rawIntel={m.match_intel ?? {}}
        />
      )}

      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 ${
          tab === 'profile' ? '' : 'hidden'
        }`}
      >
        {/* Photo carousel */}
        <div>
          <div className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-gradient-to-br from-pink-900/40 to-purple-900/40 border border-white/10">
            <MatchPhotoImage
              src={photos[active]?.url ?? null}
              alt={`${displayName} photo ${active + 1}`}
              initials={displayName}
              className="w-full h-full object-cover"
              fallbackClassName="w-full h-full flex items-center justify-center text-6xl text-white/30"
              loading="eager"
            />
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
                  <MatchPhotoImage
                    src={p.url}
                    alt={`${displayName} thumbnail ${i + 1}`}
                    initials={displayName}
                    className="w-full h-full object-cover"
                    fallbackClassName="w-full h-full flex items-center justify-center text-[10px] text-white/40"
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
            {identity.needsReview && identity.label && (
              <div className="mt-2 inline-flex max-w-full flex-col rounded-md border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-100">
                <span className="font-semibold">{identity.label}</span>
                {identity.helper && <span className="mt-0.5 text-amber-100/70">{identity.helper}</span>}
              </div>
            )}
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
            <a
              href={`https://instagram.com/${m.instagram_handle.replace(/^@/, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-pink-400 hover:text-pink-300"
            >
              @{m.instagram_handle.replace(/^@/, '')}
            </a>
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

          {displayFirstImpression && (
            <div className="p-4 rounded-xl border border-pink-500/20 bg-pink-500/5">
              <div className="text-xs text-pink-400 font-semibold uppercase tracking-wide mb-1">
                First impression
              </div>
              <p className="text-sm text-white/80">{displayFirstImpression}</p>
            </div>
          )}
        </div>
      </div>

      {/* Notes + Tags block (profile tab only) */}
      <div className={`mb-8 space-y-4 ${tab === 'profile' ? '' : 'hidden'}`}>
        <ProfileBackendEditor
          match={editableMatch}
          interests={intelInterests}
          topics={getNestedList(m.match_intel, 'topics')}
          promptThemes={intelPromptThemes}
          greenFlags={intelGreen}
          redFlags={intelRed}
          onPatch={patch}
        />
        <NotesBlock
          matchId={m.id}
          initialNotes={existingNotes}
          initialTags={existingTags}
          onPatch={patch}
        />
      </div>
    </div>
  )
}

function CommunicationCommandStrip({
  draftHref,
  onCopyBrief,
  briefCopied,
  messageCount,
  lastMessageLabel,
  lastInboundLabel,
  lastSpeaker,
  hasInbound,
}: {
  draftHref: string
  onCopyBrief: () => void
  briefCopied: boolean
  messageCount: number
  lastMessageLabel: string
  lastInboundLabel: string
  lastSpeaker: string
  hasInbound: boolean
}) {
  return (
    <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40">
            Communication state
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-white/70">
              {messageCount} messages
            </span>
            <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-white/70">
              latest: {lastSpeaker} - {lastMessageLabel}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 ${
                hasInbound
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
              }`}
            >
              inbound: {lastInboundLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={draftHref}
            className="rounded-lg bg-pink-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-pink-500"
          >
            Draft reply
          </Link>
          <button
            type="button"
            onClick={onCopyBrief}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            {briefCopied ? 'Copied brief' : 'Copy brief'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RecordTimelineStrip({
  createdAt,
  updatedAt,
  lastActivityAt,
  openerSentAt,
  metAt,
}: {
  createdAt: string | number | null
  updatedAt: string | number | null
  lastActivityAt: string | number | null
  openerSentAt: string | null
  metAt: string | null
}) {
  const items = [
    { label: 'Created', value: createdAt, relative: true },
    { label: 'Updated', value: updatedAt, relative: true },
    { label: 'Last activity', value: lastActivityAt, relative: true },
    { label: 'Opener copied', value: openerSentAt, relative: true },
    { label: 'Date met', value: metAt, relative: false },
  ]

  return (
    <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wide text-white/40">
            {item.label}
          </div>
          <div className="mt-1 text-sm text-white/80">
            {formatDateTime(item.value)}
          </div>
          {item.relative && item.value && (
            <div className="mt-0.5 text-[11px] text-white/40">
              {formatRelative(item.value)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ProfileBackendEditor({
  match,
  interests,
  topics,
  promptThemes,
  greenFlags,
  redFlags,
  onPatch,
}: {
  match: MatchRow
  interests: string[]
  topics: string[]
  promptThemes: string[]
  greenFlags: string[]
  redFlags: string[]
  onPatch: (
    body: PatchBody,
    optimistic: Partial<MatchRow>,
    label: string,
  ) => Promise<boolean>
}) {
  const [name, setName] = useState(match.name || match.match_name || '')
  const [age, setAge] = useState(match.age != null ? String(match.age) : '')
  const [job, setJob] = useState(match.job ?? '')
  const [school, setSchool] = useState(match.school ?? '')
  const [instagram, setInstagram] = useState(match.instagram_handle ?? '')
  const [zodiac, setZodiac] = useState(match.zodiac ?? '')
  const [birthDate, setBirthDate] = useState(match.birth_date ?? '')
  const [metAt, setMetAt] = useState(match.met_at ?? '')
  const [bio, setBio] = useState(match.bio ?? '')
  const [firstImpression, setFirstImpression] = useState(match.first_impression ?? '')
  const [visionSummary, setVisionSummary] = useState(match.vision_summary ?? '')
  const [interestsText, setInterestsText] = useState(interests.join(', '))
  const [topicsText, setTopicsText] = useState(topics.join(', '))
  const [promptThemesText, setPromptThemesText] = useState(promptThemes.join(', '))
  const [greenText, setGreenText] = useState(greenFlags.join(', '))
  const [redText, setRedText] = useState(redFlags.join(', '))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(match.name || match.match_name || '')
    setAge(match.age != null ? String(match.age) : '')
    setJob(match.job ?? '')
    setSchool(match.school ?? '')
    setInstagram(match.instagram_handle ?? '')
    setZodiac(match.zodiac ?? '')
    setBirthDate(match.birth_date ?? '')
    setMetAt(match.met_at ?? '')
    setBio(match.bio ?? '')
    setFirstImpression(match.first_impression ?? '')
    setVisionSummary(match.vision_summary ?? '')
    setInterestsText(interests.join(', '))
    setTopicsText(topics.join(', '))
    setPromptThemesText(promptThemes.join(', '))
    setGreenText(greenFlags.join(', '))
    setRedText(redFlags.join(', '))
  }, [
    match.id,
    match.name,
    match.match_name,
    match.age,
    match.job,
    match.school,
    match.instagram_handle,
    match.zodiac,
    match.birth_date,
    match.met_at,
    match.bio,
    match.first_impression,
    match.vision_summary,
    interests,
    topics,
    promptThemes,
    greenFlags,
    redFlags,
  ])

  const save = async () => {
    const trimmedAge = age.trim()
    let parsedAge: number | undefined
    if (trimmedAge) {
      const n = Number(trimmedAge)
      if (!Number.isInteger(n) || n < 18 || n > 100) {
        toast.error('Age must be a whole number from 18 to 100')
        return
      }
      parsedAge = n
    }

    const matchIntelPatch: Record<string, unknown> = {
      interests: splitEditableList(interestsText),
      topics: splitEditableList(topicsText),
      prompt_themes: splitEditableList(promptThemesText),
      green_flags: splitEditableList(greenText),
      red_flags: splitEditableList(redText),
    }
    const body: PatchBody = {
      name: name.trim(),
      bio: bio.trim(),
      job: job.trim(),
      school: school.trim(),
      instagram_handle: instagram.trim().replace(/^@/, ''),
      zodiac: zodiac.trim(),
      birth_date: birthDate.trim(),
      met_at: metAt.trim(),
      first_impression: firstImpression.trim(),
      vision_summary: visionSummary.trim(),
      match_intel_patch: matchIntelPatch,
    }
    if (parsedAge !== undefined) body.age = parsedAge

    setSaving(true)
    const optimisticIntel = {
      ...(match.match_intel ?? {}),
      ...matchIntelPatch,
    } as MatchIntel
    const ok = await onPatch(
      body,
      {
        name: body.name ?? match.name,
        age: parsedAge ?? match.age,
        bio: body.bio ?? match.bio,
        job: body.job ?? match.job,
        school: body.school ?? match.school,
        instagram_handle: body.instagram_handle ?? match.instagram_handle,
        zodiac: body.zodiac ?? match.zodiac,
        birth_date: body.birth_date ?? match.birth_date,
        met_at: body.met_at ?? match.met_at,
        first_impression: body.first_impression ?? match.first_impression,
        vision_summary: body.vision_summary ?? match.vision_summary,
        match_intel: optimisticIntel,
      },
      'Save profile data',
    )
    setSaving(false)
    if (ok) toast.success('Profile data saved')
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/80">
          Profile Data
        </h2>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-pink-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save edits'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <EditField label="Name" value={name} onChange={setName} />
        <EditField label="Age" value={age} onChange={setAge} type="number" />
        <EditField label="Job" value={job} onChange={setJob} />
        <EditField label="School" value={school} onChange={setSchool} />
        <EditField label="Instagram" value={instagram} onChange={setInstagram} />
        <EditField label="Zodiac" value={zodiac} onChange={setZodiac} />
        <EditField label="Birthday" value={birthDate} onChange={setBirthDate} type="date" />
        <EditField label="Date met" value={metAt} onChange={setMetAt} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3">
        <EditTextArea label="Bio" value={bio} onChange={setBio} rows={3} />
        <EditTextArea label="First impression" value={firstImpression} onChange={setFirstImpression} rows={3} />
        <EditTextArea label="Photo vision summary" value={visionSummary} onChange={setVisionSummary} rows={3} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <EditField label="Interests" value={interestsText} onChange={setInterestsText} />
        <EditField label="Topics" value={topicsText} onChange={setTopicsText} />
        <EditField label="Prompt themes" value={promptThemesText} onChange={setPromptThemesText} />
        <EditField label="Green flags" value={greenText} onChange={setGreenText} />
        <EditField label="Red flags" value={redText} onChange={setRedText} />
      </div>
    </div>
  )
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-white/45">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-pink-500/40"
      />
    </label>
  )
}

function EditTextArea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-white/45">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-pink-500/40"
      />
    </label>
  )
}

/* --------------------------------- Intel Tab --------------------------------- */

function IntelTab({
  prompts,
  intelInterests,
  intelTopics,
  intelPromptText,
  intelProfilePrompts,
  intelGreen,
  intelRed,
  spotifyArtists,
  dealbreakers,
  visionSummary,
  rawIntel,
}: {
  prompts: Prompt[]
  intelInterests: string[]
  intelTopics: string[]
  intelPromptText: string
  intelProfilePrompts: string[]
  intelGreen: string[]
  intelRed: string[]
  spotifyArtists: string[]
  dealbreakers: string[]
  visionSummary: string | null
  rawIntel: MatchIntel
}) {
  const intelEntries = Object.entries(rawIntel)
    .filter(([key, value]) => {
      if (['notes', 'tags', 'interests', 'topics', 'prompt_themes', 'profile_prompts_observed', 'green_flags', 'red_flags', 'openers', 'opener_suggestions', 'spotify_artists'].includes(key)) return false
      if (value == null || value === '') return false
      if (Array.isArray(value) && value.length === 0) return false
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) return false
      return true
    })
    .slice(0, 12)
  const hasAny =
    prompts.length > 0 ||
    intelInterests.length > 0 ||
    intelTopics.length > 0 ||
    intelPromptText.trim().length > 0 ||
    intelProfilePrompts.length > 0 ||
    intelGreen.length > 0 ||
    intelRed.length > 0 ||
    spotifyArtists.length > 0 ||
    dealbreakers.length > 0 ||
    !!visionSummary ||
    intelEntries.length > 0

  if (!hasAny) {
    return (
      <div className="mb-6 p-8 rounded-xl border border-white/10 bg-white/5 text-center">
        <p className="text-sm text-white/60">
          No intel collected yet — interests, prompts, signals, and Spotify
          artists appear here as the agent enriches the profile.
        </p>
      </div>
    )
  }

  return (
    <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {(intelProfilePrompts.length > 0 || intelPromptText.trim()) && (
        <Section title="Profile Copy">
          <div className="space-y-2">
            {intelProfilePrompts.map((line, i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/75">
                {line}
              </div>
            ))}
            {intelPromptText.trim() && (
              <p className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/70 whitespace-pre-wrap">
                {intelPromptText}
              </p>
            )}
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

      {dealbreakers.length > 0 && (
        <Section title="Dealbreakers">
          <div className="flex flex-wrap gap-1.5">
            {dealbreakers.map((t, i) => (
              <Chip key={i} tone="red">
                {t}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {visionSummary && (
        <Section title="Photo Vision Summary">
          <p className="text-sm text-white/70 whitespace-pre-wrap">
            {visionSummary}
          </p>
        </Section>
      )}

      {intelEntries.length > 0 && (
        <Section title="Intel Snapshot">
          <div className="grid grid-cols-1 gap-2">
            {intelEntries.map(([key, value]) => (
              <div key={key} className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-[11px] uppercase tracking-wide text-white/40">
                  {key.replace(/_/g, ' ')}
                </div>
                <div className="mt-1 text-sm text-white/75 break-words">
                  {formatIntelValue(value)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
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
