// AI-9535 — Posting queue read API. Returns pending + in_progress for current user.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { getFleetUserId } from '@/lib/fleet-user'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const convex = getConvexServerClient()
    const [pending, inProgress] = await Promise.all([
      convex.query(api.queues.listPostsForUser, {
        user_id: getFleetUserId(), status: 'pending', limit: 100,
      }),
      convex.query(api.queues.listPostsForUser, {
        user_id: getFleetUserId(), status: 'in_progress', limit: 100,
      }),
    ])
    const queue = [...(pending ?? []), ...(inProgress ?? [])]
      .map((r) => ({
        id: String(r._id),
        content_library_id: r.content_library_id,
        scheduled_for: new Date(r.scheduled_for).toISOString(),
        status: r.status,
        posted_at: r.posted_at ? new Date(r.posted_at).toISOString() : null,
        error: r.error ?? null,
      }))
      .sort(
        (a, b) =>
          new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime(),
      )
      .slice(0, 100)
    return NextResponse.json({ queue })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
