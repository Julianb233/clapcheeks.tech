import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CancelQueuedButton } from './CancelQueuedButton'

export const metadata: Metadata = {
  title: 'Inbox — Clapcheeks',
  description: 'All your roster messages — queued sends, unanswered replies, recent threads.',
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Msg = { ts?: string; from?: 'her' | 'him'; text: string }
type Match = {
  id: string
  name: string | null
  match_name: string | null
  her_phone: string | null
  match_id: string | null
  platform: string | null
  stage: string | null
  julian_rank: number | null
  health_score: number | null
  last_activity_at: string | null
  last_her_initiated_at: string | null
  photos_jsonb: unknown
  match_intel: unknown
}
type Conv = {
  match_id: string
  messages: unknown
  last_message_at: string | null
}

function intelObj(intel: unknown): Record<string, unknown> {
  return intel && typeof intel === 'object'
    ? (intel as Record<string, unknown>)
    : {}
}

function coverPhoto(photos: unknown): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null
  const p = photos[0] as { url?: string }
  return (p && typeof p === 'object' && p.url) || null
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function lastMessage(messages: unknown): Msg | null {
  if (!Array.isArray(messages) || messages.length === 0) return null
  return messages[messages.length - 1] as Msg
}

export default async function InboxPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Pull all active matches + their conversations in parallel.
  const [matchesRes, convsRes] = await Promise.all([
    (supabase as any)
      .from('clapcheeks_matches')
      .select(
        'id, name, match_name, her_phone, match_id, platform, stage, julian_rank, health_score, last_activity_at, last_her_initiated_at, photos_jsonb, match_intel',
      )
      .eq('user_id', user.id)
      .not('stage', 'in', '("archived","archived_cluster_dupe")')
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(100),
    (supabase as any)
      .from('clapcheeks_conversations')
      .select('match_id, messages, last_message_at')
      .eq('user_id', user.id),
  ])

  const matches: Match[] = matchesRes.data ?? []
  const convs: Conv[] = convsRes.data ?? []
  const convByMatchId = new Map<string, Conv>()
  for (const c of convs) {
    if (c.match_id) convByMatchId.set(c.match_id, c)
  }

  // Build pending-send queue across all matches
  const pendingSends: Array<{
    matchId: string
    matchName: string
    text: string
    queuedAt: string
    queueId: string
  }> = []
  for (const m of matches) {
    const queue = intelObj(m.match_intel).outbound_queue
    if (!Array.isArray(queue)) continue
    for (const it of queue as Array<Record<string, unknown>>) {
      if (it.status !== 'pending') continue
      pendingSends.push({
        matchId: m.id,
        matchName: m.name || m.match_name || 'Match',
        text: String(it.text ?? ''),
        queuedAt: String(it.queued_at ?? ''),
        queueId: String(it.id ?? ''),
      })
    }
  }
  pendingSends.sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : -1))

  // Conversation rows enriched with last message preview
  const rows = matches.map((m) => {
    const conv = m.match_id ? convByMatchId.get(m.match_id) : undefined
    const last = lastMessage(conv?.messages)
    const lastTs = last?.ts ?? conv?.last_message_at ?? m.last_activity_at
    const sheReached =
      m.last_her_initiated_at &&
      Date.now() - new Date(m.last_her_initiated_at).getTime() < 24 * 3600_000
    const sheLast = last?.from === 'her'
    return { m, last, lastTs, sheReached: !!sheReached, sheLast }
  })
  rows.sort((a, b) => {
    // Unanswered her-messages first, then by recency.
    if (a.sheLast !== b.sheLast) return a.sheLast ? -1 : 1
    const ta = a.lastTs ? new Date(a.lastTs).getTime() : 0
    const tb = b.lastTs ? new Date(b.lastTs).getTime() : 0
    return tb - ta
  })

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold mb-1">Inbox</h1>
            <p className="text-sm text-white/50">
              {pendingSends.length > 0
                ? `${pendingSends.length} message${pendingSends.length === 1 ? '' : 's'} queued · `
                : ''}
              {rows.filter((r) => r.sheLast).length} need a reply ·{' '}
              {rows.length} active threads
            </p>
          </div>
          <Link
            href="/matches"
            className="text-xs text-white/60 hover:text-white"
          >
            All match cards →
          </Link>
        </div>

        {pendingSends.length > 0 && (
          <section className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
            <div className="text-xs uppercase tracking-wide text-amber-300 mb-3 font-semibold">
              📤 Sending now ({pendingSends.length})
            </div>
            <div className="space-y-2">
              {pendingSends.map((p) => (
                <div
                  key={`${p.matchId}-${p.queueId}`}
                  className="flex items-start gap-3 rounded-lg bg-black/40 border border-white/10 p-3"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/matches/${p.matchId}`}
                      className="text-sm font-medium hover:text-pink-400"
                    >
                      → {p.matchName}
                    </Link>
                    <div className="text-sm text-white/80 mt-1 break-words">
                      {p.text}
                    </div>
                    <div className="text-[10px] text-white/40 mt-1 font-mono">
                      queued {relTime(p.queuedAt)} ago · firing within 60s
                    </div>
                  </div>
                  <CancelQueuedButton
                    matchId={p.matchId}
                    queueId={p.queueId}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          {rows.length === 0 && (
            <div className="text-center py-20 text-white/40">
              No active threads.
            </div>
          )}
          {rows.map(({ m, last, lastTs, sheReached, sheLast }) => {
            const name = m.name || m.match_name || 'Unknown'
            const photo = coverPhoto(m.photos_jsonb)
            const preview = (last?.text ?? '').slice(0, 110)
            return (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.08] hover:border-pink-500/40 p-3 transition-colors"
              >
                <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-pink-900/40 to-purple-900/40 flex-shrink-0 flex items-center justify-center">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo}
                      alt={name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-lg text-white/50">
                      {name[0]?.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium truncate">
                      {name}
                      {typeof m.julian_rank === 'number' && (
                        <span className="text-[10px] text-pink-300 ml-2 font-mono">
                          #{m.julian_rank}
                        </span>
                      )}
                      {sheLast && (
                        <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200">
                          her turn
                        </span>
                      )}
                      {sheReached && !sheLast && (
                        <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                          recently active
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-white/40 font-mono whitespace-nowrap">
                      {relTime(lastTs)} · {m.stage ?? '—'}
                    </div>
                  </div>
                  {preview ? (
                    <div className="text-xs text-white/60 truncate mt-0.5">
                      <span className="text-white/40">
                        {last?.from === 'him' ? 'You: ' : ''}
                      </span>
                      {preview}
                    </div>
                  ) : (
                    <div className="text-xs text-white/30 italic mt-0.5">
                      no messages yet
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </section>
      </div>
    </div>
  )
}
