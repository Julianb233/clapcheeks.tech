import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

/**
 * Phase L (AI-8340) - fill the user's 7-day posting queue.
 *
 *   POST /api/content-library/auto-fill
 *
 * Runs a best-effort JS port of the Python ``build_weekly_plan`` so the
 * dashboard can rebuild the plan synchronously on demand. The daemon
 * also rebuilds daily via ``_content_scheduler_worker`` - this route
 * is just for the "Auto-fill this week" button and new-user setup.
 */

const DEFAULT_RATIO: Record<string, number> = {
  beach_house_work_from_home: 0.3,
  dog_faith: 0.3,
  beach_active: 0.2,
  entrepreneur_behind_scenes: 0.1,
  food_drinks_mission_beach: 0.1,
  ted_talk_speaking: 0.0,
}

const THIRSTY = ['entrepreneur_behind_scenes', 'ted_talk_speaking'] as const

const TIME_HOURS_LOCAL: Record<string, number> = {
  golden_hour: 18,
  workday: 11,
  evening: 20,
  anytime: 12,
}

const LA_OFFSET_HOURS = -7

function buildPlan(
  library: Array<{
    id: string
    category: string
    target_time_of_day: string | null
  }>,
  ratio: Record<string, number>,
  existingIds: Set<string>,
  days = 7,
): Array<{ content_library_id: string; scheduled_for: string; category: string }> {
  const buckets: Record<string, typeof library> = {}
  for (const row of library) {
    if (existingIds.has(row.id)) continue
    const cat = row.category || 'entrepreneur_behind_scenes'
    if (!buckets[cat]) buckets[cat] = []
    buckets[cat].push(row)
  }

  const total = days
  const target: Record<string, number> = {}
  for (const [cat, frac] of Object.entries(ratio)) {
    target[cat] = Math.round(frac * total)
  }

  // Thirst cap.
  const cap = Math.max(1, Math.floor(total / 7))
  let combined = THIRSTY.reduce((s, c) => s + (target[c] || 0), 0)
  if (combined > cap) {
    let reduceBy = combined - cap
    for (const c of THIRSTY) {
      if (reduceBy <= 0) break
      const take = Math.min(reduceBy, target[c] || 0)
      target[c] = (target[c] || 0) - take
      reduceBy -= take
    }
  }

  // Rebalance with non-thirsty.
  const nonThirsty = Object.entries(ratio)
    .filter(([c]) => !THIRSTY.includes(c as any))
    .sort((a, b) => b[1] - a[1])
    .map((kv) => kv[0])

  let current = Object.values(target).reduce((a, b) => a + b, 0)
  let guard = 0
  while (current < total && guard < 50) {
    for (const cat of nonThirsty) {
      if (current >= total) break
      const inv = (buckets[cat] || []).length
      if (inv > (target[cat] || 0)) {
        target[cat] = (target[cat] || 0) + 1
        current += 1
      }
    }
    guard += 1
  }

  // Build sequence respecting diversity.
  const remaining: Record<string, number> = { ...target }
  const sequence: string[] = []
  let lastCat: string | null = null
  for (let i = 0; i < total; i++) {
    const candidates = Object.entries(remaining)
      .filter(([c, left]) => left > 0 && (buckets[c] || []).length > 0)
      .sort((a, b) => b[1] - a[1])
    if (candidates.length === 0) break
    const nonRepeat = candidates.find(([c]) => c !== lastCat)
    const chosen = (nonRepeat || candidates[0])[0]
    sequence.push(chosen)
    remaining[chosen] -= 1
    lastCat = chosen
  }

  const now = new Date()
  const plan: Array<{ content_library_id: string; scheduled_for: string; category: string }> = []
  for (let i = 0; i < sequence.length; i++) {
    const cat = sequence[i]
    const row = buckets[cat].shift()
    if (!row) continue
    const tod = row.target_time_of_day || 'anytime'
    const localHour = TIME_HOURS_LOCAL[tod] ?? 12
    const utcHour = (localHour - LA_OFFSET_HOURS) % 24
    const dayShift = Math.floor((localHour - LA_OFFSET_HOURS) / 24)
    const dt = new Date(now)
    dt.setUTCDate(dt.getUTCDate() + i + dayShift)
    dt.setUTCHours(utcHour, 0, 0, 0)
    plan.push({
      content_library_id: row.id,
      scheduled_for: dt.toISOString(),
      category: cat,
    })
  }
  return plan
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: 'server_unconfigured' }, { status: 500 })
  }
  const admin = createAdminClient()

  // Load persona ratio.
  const { data: settingsRows } = await admin
    .from('clapcheeks_user_settings')
    .select('persona')
    .eq('user_id', user.id)
    .limit(1)
  const persona: any = settingsRows?.[0]?.persona || {}
  const ratio: Record<string, number> =
    persona?.content_library?.ratio || DEFAULT_RATIO

  // Normalize ratio.
  const sum = Object.values(ratio).reduce((a: number, b: any) => a + (Number(b) || 0), 0) || 1
  const normalized: Record<string, number> = {}
  for (const [k, v] of Object.entries(ratio)) {
    normalized[k] = Math.max(0, Number(v) || 0) / sum
  }

  // Pull unposted library + existing queue.
  const { data: library } = await admin
    .from('clapcheeks_content_library')
    .select('id, category, target_time_of_day')
    .eq('user_id', user.id)
    .is('posted_at', null)
    .eq('post_type', 'story')
    .limit(500)

  // AI-9535 — Convex posting_queue. Pending rows for the user.
  const convex = getConvexServerClient()
  const existing = await convex.query(api.queues.listPostsForUser, {
    user_id: user.id,
    status: 'pending',
    limit: 200,
  })
  const existingIds = new Set<string>(
    (existing || []).map(
      (r: { content_library_id: string }) => r.content_library_id,
    ),
  )

  const plan = buildPlan(library || [], normalized, existingIds, 7)
  if (plan.length === 0) {
    return NextResponse.json({ inserted: 0, plan: [] })
  }

  let inserted = 0
  for (const p of plan) {
    try {
      const dupe = await convex.query(api.queues.findPendingPostForLibraryItem, {
        user_id: user.id,
        content_library_id: p.content_library_id,
      })
      if (dupe) continue
      await convex.mutation(api.queues.enqueuePost, {
        user_id: user.id,
        content_library_id: p.content_library_id,
        scheduled_for: typeof p.scheduled_for === 'number'
          ? p.scheduled_for
          : new Date(p.scheduled_for).getTime(),
      })
      inserted += 1
    } catch {
      // ignore per-row failures
    }
  }

  return NextResponse.json({ inserted, plan })
}
