import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Match Intel - Clapcheeks',
  description: 'Enriched profiles for every match — photos, bios, interests, and conversation strategy.',
}

type PhotoJson = { url: string; supabase_path?: string | null; width?: number; height?: number }

function coverPhoto(photos: unknown): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null
  const p = photos[0] as PhotoJson
  return (p && typeof p === 'object' && p.url) || null
}

function intelInterests(intel: unknown): string[] {
  if (!intel || typeof intel !== 'object') return []
  const v = (intel as Record<string, unknown>).interests
  return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : []
}

export default async function MatchesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: matches, error } = await supabase
    .from('clapcheeks_matches')
    .select(
      'id, match_name, name, age, bio, platform, photos_jsonb, instagram_handle, zodiac, job, school, stage, health_score, julian_rank, match_intel, created_at'
    )
    .eq('user_id', user.id)
    .order('julian_rank', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)

  const items = matches ?? []

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-sm">
                🔮
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold">Match Intel</h1>
              <span className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded-full font-mono">
                {items.length}
              </span>
            </div>
            <p className="text-sm text-white/50 ml-11">
              Photos, bios, interests, and conversation strategy for every match.
            </p>
          </div>
          <Link
            href="/matches/add"
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-sm font-medium transition-all"
          >
            + Add Match
          </Link>
        </div>

        {error && (
          <div className="text-sm text-red-400 mb-4">
            Could not load matches: {error.message}
          </div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🔮</div>
            <h2 className="text-xl font-medium mb-2">No matches yet</h2>
            <p className="text-white/50 mb-6">
              Connect a platform or add a match manually to see photos, bios, and intel here.
            </p>
            <Link
              href="/matches/add"
              className="inline-block px-6 py-3 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 font-medium transition-all"
            >
              Add Your First Match
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((m) => {
              const displayName = m.name || m.match_name || 'Unknown'
              const photo = coverPhoto(m.photos_jsonb)
              const nPhotos = Array.isArray(m.photos_jsonb)
                ? (m.photos_jsonb as PhotoJson[]).length
                : 0
              const interests = intelInterests(m.match_intel).slice(0, 5)
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="group flex flex-col rounded-2xl border border-white/10 bg-white/5 overflow-hidden hover:border-pink-500/40 hover:bg-white/[0.07] transition-all"
                >
                  <div className="relative aspect-[4/5] bg-gradient-to-br from-pink-900/40 to-purple-900/40">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo}
                        alt={displayName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-white/30">
                        {displayName[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                    {nPhotos > 1 && (
                      <span className="absolute top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm">
                        {nPhotos} pics
                      </span>
                    )}
                    {typeof m.julian_rank === 'number' && (
                      <span className="absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-pink-500/90">
                        #{m.julian_rank}
                      </span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                      <div className="font-semibold text-lg leading-tight">
                        {displayName}
                        {m.age ? (
                          <span className="font-normal text-white/70">, {m.age}</span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-white/60 uppercase tracking-wide">
                        {m.platform ?? 'unknown'}
                        {m.zodiac && <> · {m.zodiac}</>}
                        {m.stage && <> · {m.stage}</>}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    {m.bio && (
                      <p className="text-xs text-white/70 leading-relaxed line-clamp-3">
                        {m.bio}
                      </p>
                    )}
                    {(m.job || m.school) && (
                      <div className="text-[11px] text-white/50 space-y-0.5">
                        {m.job && <div>💼 {m.job}</div>}
                        {m.school && <div>🎓 {m.school}</div>}
                      </div>
                    )}
                    {interests.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {interests.map((t, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-300 border border-pink-500/20"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.instagram_handle && (
                      <div className="text-[11px] text-white/50">
                        📸 @{m.instagram_handle.replace(/^@/, '')}
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
