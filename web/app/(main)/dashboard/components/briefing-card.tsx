import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

/**
 * Operator briefing card — top-of-dashboard glanceable counts that point to
 * the page the operator should open next. Server component so the counts are
 * fresh on every navigation; the badge in the sidebar handles realtime delta.
 *
 * Metrics:
 *   - Drafts to Approve  (clapcheeks_approval_queue, status='pending')
 *   - Stale Convos       (clapcheeks_conversations, last_message_at < now-48h
 *                         AND stage IN active stages, capped at 50)
 *   - Tokens Expiring    (skipped — schema has *_updated_at, not *_expires_at)
 *   - Dates This Week    (clapcheeks_dates, scheduled_at within next 7d)
 *
 * Each metric degrades gracefully: a query error becomes 0, never a crash.
 */
export default async function BriefingCard() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  const userId = userRes.user?.id
  if (!userId) return null

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // The roster pipeline uses these "still warm" stages. Anything else (ghosted,
  // archived, hooked_up, recurring, etc.) is intentionally excluded — we only
  // want stale convos the operator can still salvage.
  //
  // Note: clapcheeks_conversations.stage default is 'opened' (legacy); the
  // newer clapcheeks_matches.stage uses 'chatting' / 'chatting_phone' /
  // 'date_proposed'. We query the conversations table because that's where
  // last_message_at lives, and we union both vocabularies.
  const ACTIVE_STAGES = [
    'opened',
    'replying',
    'chatting',
    'chatting_phone',
    'date_proposed',
  ]

  // AI-9535 — approval_queue lives on Convex; the rest stays Supabase.
  const convex = getConvexServerClient()
  const [approvalsCount, staleRes, datesRes] = await Promise.all([
    convex.query(api.queues.countPendingApprovalsForUser, { user_id: userId }),
    supabase
      .from('clapcheeks_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .lt('last_message_at', fortyEightHoursAgo)
      .in('stage', ACTIVE_STAGES)
      .limit(50),
    supabase
      .from('clapcheeks_dates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('scheduled_at', nowIso)
      .lte('scheduled_at', sevenDaysFromNow),
  ])

  const approvals = approvalsCount ?? 0
  const stale = staleRes.count ?? 0
  const dates = datesRes.count ?? 0

  // TODO(token-expiry): clapcheeks_user_settings has tinder_auth_token /
  // hinge_auth_token plus *_updated_at, but no *_expires_at column. When the
  // schema gains an explicit expiry timestamp, add a 4th metric here that
  // counts tokens expiring within the next 7 days and links to /device.

  const cards: Array<{
    label: string
    count: number
    href: string
    /** "alert" tone if exceeded — matches the urgency model from the sidebar */
    redAt?: number
  }> = [
    { label: 'Drafts to Approve', count: approvals, href: '/autonomy', redAt: 5 },
    { label: 'Stale Convos', count: stale, href: '/matches?filter=stale', redAt: 5 },
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => (
          <BriefingTile
            key={c.label}
            label={c.label}
            count={c.count}
            href={c.href}
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
  redAt,
}: {
  label: string
  count: number
  href: string
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
    </Link>
  )
}
