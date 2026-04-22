'use client'

import { useState } from 'react'
import Link from 'next/link'

interface MatchProfile {
  id: string
  name: string | null
  platform: string | null
  age: number | null
  birthday: string | null
  bio: string | null
  ig_handle: string | null
  zodiac_sign: string | null
  zodiac_element: string | null
  zodiac_modality: string | null
  zodiac_cusp: string | null
  zodiac_traits: string | null
  zodiac_emoji: string | null
  compat_score: number | null
  compat_level: string | null
  compat_desc: string | null
  compat_strengths: string[] | null
  compat_challenges: string[] | null
  disc_type: string | null
  disc_label: string | null
  disc_scores: Record<string, number> | null
  disc_strategy: string | null
  disc_openers: string[] | null
  disc_topics: string[] | null
  disc_avoid: string[] | null
  interests: string[] | null
  interests_shared: string[] | null
  interest_tags: string[] | null
  ig_bio: string | null
  ig_follower_count: number | null
  ig_following_count: number | null
  ig_post_count: number | null
  ig_scraped_at: string | null
  conversation_strategy: string | null
  opener_suggestions: string[] | null
  topic_suggestions: string[] | null
  enrichment_status: string | null
  enrichment_error: string | null
  enriched_at: string | null
  tag: string | null
  notes: string | null
  quick_tags: string[] | null
  created_at: string | null
}

export default function MatchProfileView({ profile: p }: { profile: MatchProfile }) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const copyOpener = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Link href="/matches" className="text-white/40 hover:text-white/70 transition-colors text-sm">
          &larr; All Matches
        </Link>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-3">
            {p.name || 'Unknown'}
            {p.zodiac_emoji && <span className="text-3xl">{p.zodiac_emoji}</span>}
          </h1>
          <p className="text-sm text-white/50 mt-1">
            {p.platform}{p.age ? ` · ${p.age}` : ''}
            {p.zodiac_sign ? ` · ${p.zodiac_sign}` : ''}
            {p.zodiac_cusp ? ` (${p.zodiac_cusp} cusp)` : ''}
          </p>
        </div>
        {p.enrichment_status === 'complete' && (
          <span className="text-xs px-3 py-1 rounded-full bg-green-500/20 text-green-300">Enriched</span>
        )}
        {p.enrichment_status === 'pending' && (
          <span className="text-xs px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-300">Enriching...</span>
        )}
        {p.enrichment_status === 'failed' && (
          <span className="text-xs px-3 py-1 rounded-full bg-red-500/20 text-red-300">Failed</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Zodiac Section */}
        {p.zodiac_sign && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5">
            <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
              {p.zodiac_emoji} Zodiac
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">Sign</span>
                <span>{p.zodiac_sign}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Element</span>
                <span>{p.zodiac_element}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Modality</span>
                <span>{p.zodiac_modality}</span>
              </div>
              {p.zodiac_cusp && (
                <div className="flex justify-between">
                  <span className="text-white/50">Cusp</span>
                  <span>{p.zodiac_cusp}</span>
                </div>
              )}
              {p.zodiac_traits && (
                <p className="text-white/60 mt-3 pt-3 border-t border-white/10">{p.zodiac_traits}</p>
              )}
            </div>
          </div>
        )}

        {/* Compatibility */}
        {p.compat_score != null && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5">
            <h2 className="text-lg font-medium mb-3">Compatibility</h2>
            <div className="flex items-center gap-4 mb-3">
              <div className={`text-4xl font-bold ${
                p.compat_score >= 8 ? 'text-green-400' :
                p.compat_score >= 6.5 ? 'text-yellow-400' :
                p.compat_score >= 4.5 ? 'text-orange-400' : 'text-red-400'
              }`}>
                {p.compat_score}
              </div>
              <div>
                <div className="text-sm font-medium">{p.compat_level}</div>
                <div className="text-xs text-white/50">/10 compatibility</div>
              </div>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all ${
                  p.compat_score >= 8 ? 'bg-green-500' :
                  p.compat_score >= 6.5 ? 'bg-yellow-500' :
                  p.compat_score >= 4.5 ? 'bg-orange-500' : 'bg-red-500'
                }`}
                style={{ width: `${(p.compat_score / 10) * 100}%` }}
              />
            </div>
            {p.compat_desc && <p className="text-sm text-white/60 mb-3">{p.compat_desc}</p>}
            {p.compat_strengths && p.compat_strengths.length > 0 && (
              <div className="mb-2">
                <span className="text-xs text-green-400 font-medium">Strengths:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.compat_strengths.map((s, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-300">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {p.compat_challenges && p.compat_challenges.length > 0 && (
              <div>
                <span className="text-xs text-orange-400 font-medium">Challenges:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.compat_challenges.map((c, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-300">{c}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DISC Profile */}
        {p.disc_type && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5">
            <h2 className="text-lg font-medium mb-3">
              DISC Profile: {p.disc_type} — {p.disc_label}
            </h2>
            {/* Score bars */}
            {p.disc_scores && (
              <div className="space-y-2 mb-4">
                {(['D', 'I', 'S', 'C'] as const).map(dim => {
                  const val = p.disc_scores?.[dim] ?? 0
                  const labels: Record<string, string> = { D: 'Dominance', I: 'Influence', S: 'Steadiness', C: 'Conscientiousness' }
                  const colors: Record<string, string> = { D: 'bg-red-500', I: 'bg-yellow-500', S: 'bg-green-500', C: 'bg-blue-500' }
                  return (
                    <div key={dim}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-white/50">{labels[dim]}</span>
                        <span>{Math.round(val * 100)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${colors[dim]}`} style={{ width: `${val * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {p.disc_strategy && (
              <p className="text-sm text-white/60">{p.disc_strategy}</p>
            )}
            {p.disc_avoid && p.disc_avoid.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <span className="text-xs text-red-400 font-medium">Avoid:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.disc_avoid.map((a, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-300">{a}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Opener Suggestions */}
        {p.opener_suggestions && p.opener_suggestions.length > 0 && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5">
            <h2 className="text-lg font-medium mb-3">Opener Suggestions</h2>
            <div className="space-y-2">
              {p.opener_suggestions.map((opener, i) => (
                <button
                  key={i}
                  onClick={() => copyOpener(opener, i)}
                  className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-pink-500/30 transition-all text-sm group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-white/80">{opener}</span>
                    <span className="text-xs text-white/30 group-hover:text-pink-400 whitespace-nowrap">
                      {copiedIdx === i ? 'Copied!' : 'Click to copy'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Interests */}
        {p.interests && p.interests.length > 0 && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5">
            <h2 className="text-lg font-medium mb-3">Interests</h2>
            <div className="flex flex-wrap gap-1.5">
              {p.interests.map((interest, i) => {
                const isShared = p.interests_shared?.includes(interest)
                return (
                  <span
                    key={i}
                    className={`text-xs px-2.5 py-1 rounded-full ${
                      isShared
                        ? 'bg-pink-500/20 text-pink-300 border border-pink-500/30'
                        : 'bg-white/5 text-white/60 border border-white/10'
                    }`}
                  >
                    {isShared && '★ '}{interest}
                  </span>
                )
              })}
            </div>
            {p.interest_tags && p.interest_tags.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <span className="text-xs text-white/40">Categories: {p.interest_tags.join(', ')}</span>
              </div>
            )}
          </div>
        )}

        {/* Topics */}
        {p.topic_suggestions && p.topic_suggestions.length > 0 && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5">
            <h2 className="text-lg font-medium mb-3">Conversation Topics</h2>
            <div className="flex flex-wrap gap-1.5">
              {p.topic_suggestions.map((topic, i) => (
                <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Instagram */}
        {p.ig_handle && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5">
            <h2 className="text-lg font-medium mb-3">Instagram</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">Handle</span>
                <a
                  href={`https://instagram.com/${p.ig_handle.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pink-400 hover:text-pink-300"
                >
                  @{p.ig_handle.replace(/^@/, '')}
                </a>
              </div>
              {p.ig_follower_count != null && (
                <div className="flex justify-between">
                  <span className="text-white/50">Followers</span>
                  <span>{p.ig_follower_count.toLocaleString()}</span>
                </div>
              )}
              {p.ig_bio && (
                <p className="text-white/60 mt-3 pt-3 border-t border-white/10">{p.ig_bio}</p>
              )}
              {!p.ig_scraped_at && (
                <p className="text-xs text-yellow-400 mt-2">Not scraped yet — use Browserbase to enrich</p>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {(p.notes || (p.quick_tags && p.quick_tags.length > 0)) && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5">
            <h2 className="text-lg font-medium mb-3">Notes</h2>
            {p.quick_tags && p.quick_tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {p.quick_tags.map((tag, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60 capitalize">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {p.notes && <p className="text-sm text-white/60">{p.notes}</p>}
          </div>
        )}

        {/* Bio */}
        {p.bio && (
          <div className="p-5 rounded-xl border border-white/10 bg-white/5 md:col-span-2">
            <h2 className="text-lg font-medium mb-3">Profile Bio</h2>
            <p className="text-sm text-white/60 whitespace-pre-wrap">{p.bio}</p>
          </div>
        )}
      </div>
    </div>
  )
}
