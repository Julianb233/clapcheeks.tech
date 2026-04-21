import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import MatchGrid from '@/components/matches/MatchGrid'
import OfflineContactForm from '@/components/matches/OfflineContactForm'
import { ClapcheeksMatchRow } from '@/lib/matches/types'

export const metadata: Metadata = {
  title: 'Matches — Clapcheeks',
  description: 'Every match across every platform, ranked and ready to action.',
}

const PAGE_SIZE = 30

// `clapcheeks_matches` may not be in the generated Database type yet —
// use a loose cast so the page still builds while Phase A is in flight.
type ConvoLite = {
  match_id: string
  last_message: string | null
  last_message_at: string | null
}

export default async function MatchesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch matches. If the table doesn't exist yet (Phase A not landed),
  // swallow the error and render the empty state.
  let matches: ClapcheeksMatchRow[] = []
  let hasMore = false
  let fetchError: string | null = null
  try {
    const { data, error } = await (supabase as any)
      .from('clapcheeks_matches')
      .select('*')
      .eq('user_id', user.id)
      .order('final_score', { ascending: false, nullsFirst: false })
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .range(0, PAGE_SIZE - 1)
    if (error) {
      fetchError = error.message
    } else if (data) {
      matches = data as ClapcheeksMatchRow[]
      hasMore = data.length >= PAGE_SIZE
    }
  } catch (e) {
    fetchError = (e as Error).message
  }

  // Best-effort last-message pull.
  const lastMessages: Record<string, string | null> = {}
  if (matches.length > 0) {
    try {
      const matchIds = matches
        .map((m) => m.external_id)
        .filter((x): x is string => !!x)
      if (matchIds.length > 0) {
        const { data } = await supabase
          .from('clapcheeks_conversations')
          .select('match_id, last_message, last_message_at')
          .eq('user_id', user.id)
          .in('match_id', matchIds)
        const map = new Map<string, ConvoLite>()
        for (const row of (data ?? []) as ConvoLite[]) {
          map.set(row.match_id, row)
        }
        for (const m of matches) {
          const c = m.external_id ? map.get(m.external_id) : undefined
          lastMessages[m.id] = c?.last_message ?? null
        }
      }
    } catch {
      // non-fatal — last-message preview is optional
    }
  }

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="relative max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-3xl md:text-4xl uppercase tracking-wide gold-text">
                Matches
              </h1>
              <span className="font-mono text-[10px] uppercase tracking-widest text-white/30 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                phase d
              </span>
            </div>
            <p className="text-white/50 text-sm">
              Every match, ranked by score and recency. Click a card to drill in.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <OfflineContactForm />
            <Link
              href="/dashboard"
              className="text-white/40 hover:text-white/70 text-xs font-mono bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              ← Dashboard
            </Link>
          </div>
        </div>

        {fetchError && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 my-4 text-xs text-amber-300 font-mono">
            Matches table error: {fetchError}. Phase A (match intake) may not have run its migration yet.
          </div>
        )}

        <div className="mt-6">
          <MatchGrid
            initialMatches={matches}
            initialHasMore={hasMore}
            initialLastMessages={lastMessages}
            pageSize={PAGE_SIZE}
          />
        </div>
      </div>
    </div>
  )
}
