import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/convex/server'
import { getTokenHealth } from '@/lib/clapcheeks/token-health'
import { getRuntimeHealth } from '@/lib/clapcheeks/runtime-health'

/**
 * Operator briefing card — top-of-dashboard glanceable counts that point to
 * the page the operator should open next. Server component so the counts are
 * fresh on every navigation; the badge in the sidebar handles realtime delta.
 *
 * Metrics:
 *   - Drafts to Approve  (clapcheeks_approval_queue, status='pending')
 *   - Stale Convos       (clapcheeks_conversations, last_message_at < now-48h
 *                         AND stage IN active stages, capped at 50)
 *   - Tokens Missing     (required app tokens missing for the dashboard user)
 *   - Dates This Week    (clapcheeks_dates, scheduled_at within next 7d)
 *
 * Each metric degrades gracefully: a query error becomes 0, never a crash.
 */
export default async function BriefingCard() {
  const convex = await createClient()
  const { data: userRes } = await convex.auth.getUser()
  const userId = userRes.user?.id
  if (!userId) return null

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const [approvalsRes, staleRes, datesRes, tokenHealth, runtimeHealth] = await Promise.all([
    convex
      .from('clapcheeks_approval_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending'),
    convex
      .from('clapcheeks_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .lt('last_message_at', fortyEightHoursAgo)
      .limit(50),
    convex
      .from('clapcheeks_dates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('scheduled_at', nowIso)
      .lte('scheduled_at', sevenDaysFromNow),
    getTokenHealth(userId).catch(() => null),
    Promise.resolve(getRuntimeHealth()).catch(() => null),
  ])

  const approvals = approvalsRes.count ?? 0
  const stale = staleRes.count ?? 0
  const dates = datesRes.count ?? 0

  const missingTokens = tokenHealth?.missing_required ?? 0
  const tokenBlockers = tokenHealth?.missing_required_services?.map((item) => item.name).join(', ') || 'All required tokens configured'
  const runtimeBlockers = runtimeHealth?.blockers?.length ?? 1
  const runtimeDetail = runtimeHealth?.blockers?.map((item) => item.reason).join(', ') || 'Runtime status unavailable'

  const cards: Array<{
    label: string
    count: number
    href: string
    detail?: string
    /** "alert" tone if exceeded — matches the urgency model from the sidebar */
    redAt?: number
  }> = [
    { label: 'Drafts to Approve', count: approvals, href: '/autonomy', redAt: 5 },
    { label: 'Stale Convos', count: stale, href: '/matches?filter=stale', redAt: 5 },
    { label: 'Tokens Missing', count: missingTokens, href: '/device', detail: tokenBlockers, redAt: 0 },
    { label: 'Runtime Blockers', count: runtimeHealth?.ok === true ? 0 : runtimeBlockers, href: '/device', detail: runtimeHealth?.ok === true ? 'Inbound watcher healthy' : runtimeDetail, redAt: 0 },
    { label: 'Dates This Week', count: dates, href: '/scheduled' },
  ]

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white/60 text-xs uppercase tracking-widest font-mono">
          Today&apos;s Briefing
        </h2>
        <span className="text-white/30 text-[10px] font-mono">
          live · server-rendered
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <BriefingTile
            key={c.label}
            label={c.label}
            count={c.count}
            href={c.href}
            detail={c.detail}
            redAt={c.redAt}
          />
        ))}
      </div>
    </div>
  )
}

function BriefingTile({
  label,
  count,
  href,
  detail,
  redAt,
}: {
  label: string
  count: number
  href: string
  detail?: string
  redAt?: number
}) {
  // Tone matches sidebar badge urgency model so visual language is consistent.
  let tone = 'border-white/10 hover:border-white/20'
  let valueTone = 'text-white/40'
  if (count > 0) {
    if (redAt !== undefined && count > redAt) {
      tone = 'border-red-500/40 hover:border-red-500/70 bg-red-500/[0.04]'
      valueTone = 'text-red-300'
    } else {
      tone = 'border-amber-400/40 hover:border-amber-400/70 bg-amber-400/[0.04]'
      valueTone = 'text-amber-200'
    }
  }

  return (
    <Link
      href={href}
      className={`group bg-white/5 border ${tone} rounded-xl p-4 transition-all flex flex-col gap-1 relative`}
    >
      <div className="flex items-baseline justify-between">
        <div className={`text-3xl font-bold tabular-nums ${valueTone}`}>{count}</div>
        <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-white/70 transition-colors" />
      </div>
      <div className="text-white/60 text-xs leading-tight">{label}</div>
      {detail && (
        <div className="min-h-[1rem] break-words text-[10px] leading-snug text-white/35">
          {detail}
        </div>
      )}
    </Link>
  )
}
