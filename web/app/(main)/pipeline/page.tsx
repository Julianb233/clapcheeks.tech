import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { ClapcheeksMatchRow } from '@/lib/matches/types'
import PipelineBoard from './PipelineBoard'

export const metadata: Metadata = {
  title: 'Pipeline — Clapcheeks',
  description:
    'Visual match management. Kanban pipeline, expandable profile cards, multi-dimension rankings, leaderboard. Mobile-first.',
}

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

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let matches: ClapcheeksMatchRow[] = []
  let fetchError: string | null = null
  try {
    const { data, error } = await supabase
      .from('clapcheeks_matches')
      .select('*')
      .eq('user_id', user.id)
      .order('close_probability', { ascending: false, nullsFirst: false })
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .range(0, 299)
    if (error) {
      fetchError = error.message
    } else if (data) {
      matches = data as unknown as ClapcheeksMatchRow[]
    }
  } catch (e) {
    fetchError = (e as Error).message
  }

  // Pull last-message previews using the existing convo table mapping.
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
      // non-fatal — last messages are decorative
    }
  }

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-4 md:py-8">
      <div className="max-w-[1600px] mx-auto">
        {/* Header — compact on mobile so the kanban gets the height. */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-2xl md:text-4xl uppercase tracking-wide gold-text">
                Pipeline
              </h1>
              <span className="font-mono text-[10px] uppercase tracking-widest text-white/30 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                phase 40
              </span>
            </div>
            <p className="text-white/50 text-xs md:text-sm">
              Six-stage visual board. Drag to move, tap to expand, slide to rank.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/roster"
              className="text-white/40 hover:text-white/70 text-[11px] font-mono bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-lg transition-all"
            >
              Detail roster
            </Link>
            <Link
              href="/dashboard/matches"
              className="text-white/40 hover:text-white/70 text-[11px] font-mono bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-lg transition-all"
            >
              Grid
            </Link>
          </div>
        </div>

        {fetchError && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-xs text-amber-300 font-mono">
            Pipeline fetch error: {fetchError}.
          </div>
        )}

        {matches.length === 0 && !fetchError ? (
          <div className="bg-white/[0.03] border border-white/10 rounded-xl p-10 text-center">
            <h3 className="text-white font-semibold text-lg mb-2">Empty pipeline</h3>
            <p className="text-white/40 text-sm max-w-md mx-auto mb-4">
              No matches yet. Once the agent pulls them from Tinder/Hinge or you
              add one manually, they&apos;ll land in the New column.
            </p>
            <Link
              href="/matches/add"
              className="inline-block px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-500 to-red-600 text-black text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Add a match
            </Link>
          </div>
        ) : (
          <PipelineBoard initialMatches={matches} lastMessages={lastMessages} />
        )}
      </div>
    </div>
  )
}
