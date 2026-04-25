import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const metadata: Metadata = {
  title: "Today's Roster - Clapcheeks",
  description: 'Who replied, who\'s gone cold, who you owe a reply.',
}

type Match = {
  id: string
  name: string | null
  match_name: string | null
  stage: string | null
  julian_rank: number | null
  health_score: number | null
  close_probability: number | null
  messages_total: number | null
  messages_7d: number | null
  his_to_her_ratio: number | null
  last_activity_at: string | null
  last_her_initiated_at: string | null
  platform: string | null
  her_phone: string | null
}

function hoursAgo(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.round((Date.now() - t) / 3600000)
}

function formatAge(hrs: number | null): string {
  if (hrs == null) return '—'
  if (hrs < 1) return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function bucket(m: Match) {
  const cold = hoursAgo(m.last_activity_at)
  const lastHer = hoursAgo(m.last_her_initiated_at)
  if (lastHer != null && lastHer < 24) return 'her_initiated'
  if (cold != null && cold > 168) return 'gone_cold'
  if (cold != null && cold > 72) return 'cooling'
  if ((m.his_to_her_ratio ?? 0) > 2.5) return 'over_pursuing'
  return 'active'
}

const BUCKETS: Array<{
  key: string
  title: string
  hint: string
  tone: string
}> = [
  {
    key: 'her_initiated',
    title: 'She reached out',
    hint: 'Her last message in the past 24h. Reply now.',
    tone: 'border-emerald-500/40 bg-emerald-500/5',
  },
  {
    key: 'cooling',
    title: 'Cooling off',
    hint: '3-7 days quiet. Send something light.',
    tone: 'border-amber-500/40 bg-amber-500/5',
  },
  {
    key: 'over_pursuing',
    title: 'You\'re over-pursuing',
    hint: 'Your-to-her ratio > 2.5. Stop. Let her chase.',
    tone: 'border-red-500/40 bg-red-500/5',
  },
  {
    key: 'gone_cold',
    title: 'Gone cold',
    hint: '>7 days quiet. Reignite or archive.',
    tone: 'border-blue-500/40 bg-blue-500/5',
  },
  {
    key: 'active',
    title: 'Active',
    hint: 'Currently warm.',
    tone: 'border-white/10 bg-white/5',
  },
]

export default async function TodayRosterPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: matches } = await (supabase as any)
    .from('clapcheeks_matches')
    .select(
      'id, name, match_name, stage, julian_rank, health_score, close_probability, messages_total, messages_7d, his_to_her_ratio, last_activity_at, last_her_initiated_at, platform, her_phone'
    )
    .eq('user_id', user.id)
    .not('stage', 'in', '("ghosted","faded","archived","archived_cluster_dupe")')
    .order('close_probability', { ascending: false, nullsFirst: false })
    .limit(100)

  const items: Match[] = (matches as Match[]) ?? []
  const grouped = new Map<string, Match[]>()
  for (const b of BUCKETS) grouped.set(b.key, [])
  for (const m of items) grouped.get(bucket(m))?.push(m)

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold mb-1">
              Today&apos;s Roster
            </h1>
            <p className="text-sm text-white/50">
              Who replied, who&apos;s cooling, who needs a nudge.
            </p>
          </div>
          <Link
            href="/matches"
            className="text-xs text-white/60 hover:text-white"
          >
            All matches →
          </Link>
        </div>

        <div className="space-y-6">
          {BUCKETS.map((b) => {
            const list = grouped.get(b.key) ?? []
            if (list.length === 0) return null
            return (
              <section
                key={b.key}
                className={`rounded-2xl border p-5 ${b.tone}`}
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold">
                    {b.title}{' '}
                    <span className="text-xs font-mono text-white/40 ml-1">
                      {list.length}
                    </span>
                  </h2>
                  <div className="text-[11px] text-white/50">{b.hint}</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map((m) => {
                    const name = m.name || m.match_name || 'Unknown'
                    return (
                      <Link
                        key={m.id}
                        href={`/matches/${m.id}`}
                        className="rounded-lg border border-white/10 bg-black/40 hover:bg-black/60 hover:border-pink-500/40 p-3 transition-all"
                      >
                        <div className="flex items-baseline justify-between mb-1">
                          <div className="font-medium">{name}</div>
                          {typeof m.julian_rank === 'number' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300">
                              #{m.julian_rank}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-white/50">
                          {m.platform ?? '—'} · {m.stage ?? '—'} · last{' '}
                          {formatAge(hoursAgo(m.last_activity_at))}
                        </div>
                        <div className="text-[11px] text-white/50 mt-1">
                          health{' '}
                          <span className="font-mono">
                            {m.health_score ?? '—'}
                          </span>{' '}
                          · close{' '}
                          <span className="font-mono">
                            {m.close_probability != null
                              ? m.close_probability.toFixed(2)
                              : '—'}
                          </span>{' '}
                          · ratio{' '}
                          <span
                            className={
                              (m.his_to_her_ratio ?? 0) > 2.5
                                ? 'font-mono text-red-400'
                                : 'font-mono'
                            }
                          >
                            {m.his_to_her_ratio?.toFixed(1) ?? '—'}
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </section>
            )
          })}
          {items.length === 0 && (
            <div className="text-center py-20 text-white/40">
              No active matches in roster.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
