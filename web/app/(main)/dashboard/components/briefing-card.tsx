import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { getFleetUserId } from '@/lib/fleet-user'
import BriefingCardLive from './briefing-card-live'

/**
 * Operator briefing card — top-of-dashboard glanceable counts that point to
 * the page the operator should open next.
 *
 * AI-10022: this used to be a pure server component that read the counts once
 * at render time and never updated — so the dashboard showed stale data
 * ("no drafts to approve") and was not real-time, which defeats the point of
 * running on Convex. We now fetch an initial snapshot here on the server (for
 * an instant first paint) and hand it to <BriefingCardLive>, a client child
 * that subscribes to the same Convex queries via `useQuery` and updates the
 * tiles live as drafts are approved / matches go stale / dates are booked.
 *
 * Metrics:
 *   - Drafts to Approve  (approval_queue, status='pending')
 *   - Stale Convos       (matches in an active stage, last activity < now-48h)
 *   - Dates This Week    (matches in stage date_proposed / date_booked)
 *
 * Each metric degrades gracefully: a query error becomes 0, never a crash.
 */

// The roster pipeline uses these "still warm" stages. Anything else (ghosted,
// archived, hooked_up, recurring, etc.) is intentionally excluded — we only
// want stale convos the operator can still salvage. Kept in sync with the
// identical set in briefing-card-live.tsx.
const ACTIVE_STAGES = new Set([
  'opened',
  'replying',
  'chatting',
  'chatting_phone',
  'conversing',
  'date_proposed',
  'new',
])

export default async function BriefingCard() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  const userId = userRes.user?.id
  if (!userId) return null

  const fortyEightHoursAgoMs = Date.now() - 48 * 60 * 60 * 1000

  // AI-9607 — Convex matches table is the authoritative source for stage +
  // activity time. Dates are derived from matches in date_proposed/date_booked.
  const convex = getConvexServerClient()
  const fleetUser = getFleetUserId()
  const [approvalsCount, matches] = await Promise.all([
    convex.query(api.queues.countPendingApprovalsForUser, { user_id: fleetUser }).catch(() => 0),
    convex.query(api.matches.listForUser, { user_id: fleetUser }).catch(() => [] as Array<Record<string, unknown>>),
  ])

  const matchRows = matches as Array<Record<string, unknown>>
  const initialApprovals = approvalsCount ?? 0
  const initialStale = matchRows.filter((m) => {
    const stage = (m.stage as string | undefined) ?? (m.status as string | undefined) ?? ''
    const last = (m.last_activity_at as number | undefined) ?? (m.updated_at as number | undefined) ?? 0
    return ACTIVE_STAGES.has(stage) && last > 0 && last < fortyEightHoursAgoMs
  }).length
  const initialDates = matchRows.filter((m) => {
    const stage = (m.stage as string | undefined) ?? (m.status as string | undefined) ?? ''
    return stage === 'date_proposed' || stage === 'date_booked'
  }).length

  return (
    <BriefingCardLive
      fleetUserId={fleetUser}
      initialApprovals={initialApprovals}
      initialStale={initialStale}
      initialDates={initialDates}
    />
  )
}
