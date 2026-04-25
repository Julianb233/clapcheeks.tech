import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import OfflineContactForm from '@/components/matches/OfflineContactForm'
import MatchesGrid, { MatchGridRow } from './matches-grid'

export const metadata: Metadata = {
  title: 'Matches — Clapcheeks',
  description: 'Every match across every platform, ranked and ready to action.',
}

// Full in-memory filter/sort — dataset is small (hundreds max). Cap the fetch
// to 500 rows so a runaway account can't blow up the client bundle.
const MAX_ROWS = 500

type ConvoLite = {
  match_id: string
  messages: unknown
  last_message_at: string | null
}

function extractLastMessage(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null
  const last = messages[messages.length - 1] as Record<string, unknown>
  const text = (last?.text ?? last?.body ?? last?.content ?? null) as string | null
  return typeof text === 'string' ? text : null
}

export default async function MatchesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch matches. If the table doesn't exist yet, swallow the error and
  // render the empty state.
  let matches: MatchGridRow[] = []
  let fetchError: string | null = null
  try {
    const { data, error } = await (supabase as any)
      .from('clapcheeks_matches')
      .select('*')
      .eq('user_id', user.id)
      .order('julian_rank', { ascending: false, nullsFirst: false })
      .order('final_score', { ascending: false, nullsFirst: false })
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(MAX_ROWS)
    if (error) {
      fetchError = error.message
    } else if (data) {
      matches = data as MatchGridRow[]
    }
  } catch (e) {
    fetchError = (e as Error).message
  }

  // Best-effort last-message pull so cards can preview the latest reply.
  const lastMessages: Record<string, string | null> = {}
  if (matches.length > 0) {
    try {
      const matchIds = matches
        .map((m) => m.external_id)
        .filter((x): x is string => !!x)
      if (matchIds.length > 0) {
        const { data } = await supabase
          .from('clapcheeks_conversations')
          .select('match_id, messages, last_message_at')
          .eq('user_id', user.id)
          .in('match_id', matchIds)
        const map = new Map<string, ConvoLite>()
        for (const row of (data ?? []) as ConvoLite[]) {
          map.set(row.match_id, row)
        }
        for (const m of matches) {
          const c = m.external_id ? map.get(m.external_id) : undefined
          lastMessages[m.id] = c ? extractLastMessage(c.messages) : null
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
          {matches.length === 0 ? (
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-10 text-center">
              <h3 className="text-white font-semibold text-lg mb-2">No matches yet</h3>
              <p className="text-white/40 text-sm max-w-md mx-auto">
                Match intake is running — the Clapcheeks agent pulls your matches every 10
                minutes. Check back soon.
              </p>
            </div>
          ) : (
            <MatchesGrid matches={matches} lastMessages={lastMessages} />
          )}
        </div>
      </div>
    </div>
  )
}
