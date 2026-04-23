import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import RosterKanban from '@/components/roster/RosterKanban'
import RosterStatsBar from '@/components/roster/RosterStatsBar'
import DailyTopThree from '@/components/roster/DailyTopThree'
import { ClapcheeksMatchRow } from '@/lib/matches/types'

export const metadata: Metadata = {
  title: 'Roster - Clapcheeks',
  description: 'Dating CRM. Every active match tracked with health, stage, rank, and close probability.',
}

// Loose cast until the clapcheeks_matches type is regenerated for Phase J columns.
type ConvoLite = {
  match_id: string
  last_message: string | null
  last_message_at: string | null
}

export default async function RosterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let matches: ClapcheeksMatchRow[] = []
  let fetchError: string | null = null
  try {
    // Pull up to 200 rows; the kanban caps each column to 20 client-side.
    const { data, error } = await (supabase as any)
      .from('clapcheeks_matches')
      .select('*')
      .eq('user_id', user.id)
      .order('close_probability', { ascending: false, nullsFirst: false })
      .order('final_score', { ascending: false, nullsFirst: false })
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .range(0, 199)
    if (error) {
      fetchError = error.message
    } else if (data) {
      matches = data as ClapcheeksMatchRow[]
    }
  } catch (e) {
    fetchError = (e as Error).message
  }

  // Last-message preview (same strategy as /dashboard/matches).
  const lastMessages: Record<string, string | null> = {}
  if (matches.length > 0) {
    try {
      const matchIds = matches.map((m) => m.external_id).filter((x): x is string => !!x)
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
      // non-fatal
    }
  }

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="max-w-[1600px] mx-auto">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-3xl md:text-4xl uppercase tracking-wide gold-text">
                Roster
              </h1>
            </div>
            <p className="text-white/50 text-sm">
              Dating CRM. Health decays with silence, close-prob ranks the pipeline, rank is your override.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/matches"
              className="text-white/40 hover:text-white/70 text-xs font-mono bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Grid view
            </Link>
            <Link
              href="/dashboard"
              className="text-white/40 hover:text-white/70 text-xs font-mono bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {fetchError && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-xs text-amber-300 font-mono">
            Roster fetch error: {fetchError}. Phase J migration may still be propagating.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 mb-6">
          <RosterStatsBar matches={matches} />
          <DailyTopThree matches={matches} />
        </div>

        {matches.length === 0 && !fetchError ? (
          <div className="bg-white/[0.03] border border-white/10 rounded-xl p-10 text-center">
            <h3 className="text-white font-semibold text-lg mb-2">Empty roster</h3>
            <p className="text-white/40 text-sm max-w-md mx-auto">
              No matches yet. Match intake lands here the moment the agent pulls them from Tinder/Hinge.
            </p>
          </div>
        ) : (
          <RosterKanban initialMatches={matches} lastMessages={lastMessages} />
        )}
      </div>
    </div>
  )
}
