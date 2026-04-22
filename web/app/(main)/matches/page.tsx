import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Match Intel - Clapcheeks',
  description: 'Enriched profiles for every match - zodiac, DISC, interests, and conversation strategy.',
}

export default async function MatchesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: profiles, error } = await supabase
    .from('clapcheeks_match_profiles')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const items = profiles ?? []

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-sm">
                🔮
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold">Match Intel</h1>
            </div>
            <p className="text-sm text-white/50 ml-11">
              Enriched profiles — zodiac, DISC, interests, and conversation strategy.
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
          <div className="text-sm text-red-400 mb-4">Could not load profiles: {error.message}</div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🔮</div>
            <h2 className="text-xl font-medium mb-2">No matches yet</h2>
            <p className="text-white/50 mb-6">Add your first match to get zodiac, DISC, and conversation intel.</p>
            <Link
              href="/matches/add"
              className="inline-block px-6 py-3 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 font-medium transition-all"
            >
              Add Your First Match
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((p) => (
              <Link
                key={p.id}
                href={`/matches/${p.id}`}
                className="block p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-medium text-lg group-hover:text-pink-400 transition-colors">
                      {p.name || 'Unknown'}
                    </h3>
                    <p className="text-xs text-white/40">
                      {p.platform}{p.age ? ` · ${p.age}` : ''}
                    </p>
                  </div>
                  {p.zodiac_emoji && (
                    <span className="text-2xl" title={p.zodiac_sign || undefined}>{p.zodiac_emoji}</span>
                  )}
                </div>

                {/* Compatibility bar */}
                {p.compat_score != null && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-white/50">Compatibility</span>
                      <span className={
                        p.compat_score >= 8 ? 'text-green-400' :
                        p.compat_score >= 6.5 ? 'text-yellow-400' :
                        p.compat_score >= 4.5 ? 'text-orange-400' : 'text-red-400'
                      }>
                        {p.compat_score}/10
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          p.compat_score >= 8 ? 'bg-green-500' :
                          p.compat_score >= 6.5 ? 'bg-yellow-500' :
                          p.compat_score >= 4.5 ? 'bg-orange-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${(p.compat_score / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* DISC + Tags */}
                <div className="flex flex-wrap gap-1.5">
                  {p.disc_type && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                      DISC: {p.disc_type}
                    </span>
                  )}
                  {p.zodiac_sign && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">
                      {p.zodiac_sign}
                    </span>
                  )}
                  {p.enrichment_status === 'pending' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300">
                      Enriching...
                    </span>
                  )}
                  {p.enrichment_status === 'complete' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300">
                      Enriched
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
