'use client'

import { useState } from 'react'
import Link from 'next/link'

type Photo = {
  url: string
  supabase_path?: string | null
  width?: number
  height?: number
}

type Prompt = { question?: string; answer?: string; prompt?: string; text?: string }

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
  health_score: number | null
  julian_rank: number | null
  first_impression: string | null
  vision_summary: string | null
  match_intel: Record<string, unknown> | null
  instagram_intel: Record<string, unknown> | null
  distance_miles: number | null
  final_score: number | null
  dealbreaker_flags: string[] | null
  red_flags: string[] | null
  created_at: string | null
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function getNestedList(obj: unknown, key: string): string[] {
  if (!obj || typeof obj !== 'object') return []
  return stringList((obj as Record<string, unknown>)[key])
}

export default function MatchProfileView({ match: m }: { match: MatchRow }) {
  const displayName = m.name || m.match_name || 'Unknown'
  const photos = (m.photos_jsonb ?? []).filter((p): p is Photo => !!p?.url)
  const [active, setActive] = useState(0)

  const intelInterests = getNestedList(m.match_intel, 'interests')
  const intelTopics = getNestedList(m.match_intel, 'topics')
  const intelGreen = getNestedList(m.match_intel, 'green_flags')
  const intelRed = [...(m.red_flags ?? []), ...getNestedList(m.match_intel, 'red_flags')]
  const intelOpeners = getNestedList(m.match_intel, 'opener_suggestions')
  const spotifyArtists = Array.isArray(m.spotify_artists)
    ? (m.spotify_artists as Array<{ name?: string } | string>)
        .map((x) => (typeof x === 'string' ? x : x?.name ?? ''))
        .filter(Boolean)
    : []

  const prompts = (m.prompts_jsonb ?? []).filter(
    (p) => p && (p.answer || p.text)
  )

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
                  ‹
                </button>
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-lg"
                  onClick={() => setActive((i) => (i + 1) % photos.length)}
                  aria-label="Next photo"
                >
                  ›
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
              {m.zodiac && <> · {m.zodiac}</>}
              {m.distance_miles != null && <> · {m.distance_miles} mi</>}
              {m.stage && <> · {m.stage}</>}
            </p>
          </div>

          {(m.job || m.school) && (
            <div className="flex flex-col gap-1 text-sm text-white/70">
              {m.job && <div>💼 {m.job}</div>}
              {m.school && <div>🎓 {m.school}</div>}
            </div>
          )}

          {m.instagram_handle && (
            <a
              href={`https://instagram.com/${m.instagram_handle.replace(/^@/, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-pink-400 hover:text-pink-300"
            >
              📸 @{m.instagram_handle.replace(/^@/, '')}
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

        {intelOpeners.length > 0 && (
          <OpenersBlock openers={intelOpeners} />
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
                  🎵 {t}
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

function OpenersBlock({ openers }: { openers: string[] }) {
  const [copied, setCopied] = useState<number | null>(null)
  return (
    <Section title="Opener Suggestions">
      <div className="space-y-2">
        {openers.map((opener, i) => (
          <button
            key={i}
            onClick={() => {
              navigator.clipboard.writeText(opener)
              setCopied(i)
              setTimeout(() => setCopied(null), 1500)
            }}
            className="w-full text-left p-3 rounded-lg bg-black/30 hover:bg-black/40 border border-white/5 hover:border-pink-500/30 transition-all text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span>{opener}</span>
              <span className="text-[10px] text-white/30 shrink-0">
                {copied === i ? 'Copied' : 'Tap to copy'}
              </span>
            </div>
          </button>
        ))}
      </div>
    </Section>
  )
}
