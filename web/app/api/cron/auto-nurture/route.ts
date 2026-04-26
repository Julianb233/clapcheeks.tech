import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { generateFollowupMessage, type FollowupKind } from '@/lib/followup/generate-content'
import { pickOptimalSendTimeISO } from '@/lib/followup/optimal-timing'
import { DEFAULT_FOLLOWUP_CONFIG } from '@/lib/followup/types'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/auto-nurture
 *
 * Hourly sweep that enqueues nurture messages based on match state:
 *   - upcoming_date: row in clapcheeks_dates within next 24-30h →
 *     pre_date_confirm
 *   - just_dated: clapcheeks_dates with attended_at in last 6-18h →
 *     post_date_thank
 *   - faded: stage='faded' with last_activity_at 4-8d ago →
 *     ghost_reengage (one-shot, never repeats)
 *   - quiet: stage='chatting' but no inbound for 36-96h →
 *     follow_up (uses sequence config delays for cadence)
 *
 * Skips matches that already have a pending/approved scheduled_message of the
 * same sequence_type, so this is idempotent — running every hour won't spam.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  const vercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
  if (!vercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const julian = '9c848c51-8996-4f1f-9dbf-50128e3408ea'

  const { data: cfg } = await (supabase as any)
    .from('clapcheeks_followup_sequences')
    .select('*')
    .eq('user_id', julian)
    .maybeSingle()
  const config = cfg ?? { ...DEFAULT_FOLLOWUP_CONFIG, user_id: julian }

  if (!config.enabled) {
    return NextResponse.json({ ok: true, skipped: 'sequences disabled' })
  }

  type EnqueueIntent = {
    kind: FollowupKind
    match_id: string
    match_name: string
    phone: string | null
    delayHours: number
    context?: string
    dateContext?: { what?: string; when?: string; where?: string }
    sequence_step: number
  }
  const intents: EnqueueIntent[] = []

  // 1. Upcoming dates → pre_date_confirm (~24h before)
  const { data: upcomingDates } = await (supabase as any)
    .from('clapcheeks_dates')
    .select('id, match_id, scheduled_at, title, venue_name')
    .eq('user_id', julian)
    .in('status', ['scheduled', 'planned', 'confirmed'])
    .gte('scheduled_at', new Date(Date.now() + 22 * 3600_000).toISOString())
    .lte('scheduled_at', new Date(Date.now() + 30 * 3600_000).toISOString())

  for (const d of upcomingDates ?? []) {
    const { data: match } = await (supabase as any)
      .from('clapcheeks_matches')
      .select('id, name, her_phone')
      .eq('id', d.match_id)
      .maybeSingle()
    if (!match) continue
    intents.push({
      kind: 'pre_date_confirm',
      match_id: match.id,
      match_name: match.name,
      phone: match.her_phone,
      delayHours: 0,  // send now (24h before date)
      dateContext: {
        what: d.title ?? 'our plans',
        when: 'tomorrow',
        where: d.venue_name ?? undefined,
      },
      sequence_step: 0,
    })
  }

  // 2. Recent attended dates → post_date_thank (status='attended', 6-18h ago)
  const { data: recentDates } = await (supabase as any)
    .from('clapcheeks_dates')
    .select('id, match_id, scheduled_at, title')
    .eq('user_id', julian)
    .eq('status', 'attended')
    .gte('scheduled_at', new Date(Date.now() - 18 * 3600_000).toISOString())
    .lte('scheduled_at', new Date(Date.now() - 6 * 3600_000).toISOString())

  for (const d of recentDates ?? []) {
    const { data: match } = await (supabase as any)
      .from('clapcheeks_matches')
      .select('id, name, her_phone')
      .eq('id', d.match_id)
      .maybeSingle()
    if (!match) continue
    intents.push({
      kind: 'post_date_thank',
      match_id: match.id,
      match_name: match.name,
      phone: match.her_phone,
      delayHours: 0,
      dateContext: { what: d.title ?? 'last night' },
      sequence_step: 0,
    })
  }

  // 3. Faded matches → ghost_reengage (one shot, never repeated)
  const { data: faded } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, name, her_phone, last_activity_at, match_intel')
    .eq('user_id', julian)
    .eq('stage', 'faded')
    .gte('last_activity_at', new Date(Date.now() - 8 * 86400_000).toISOString())
    .lte('last_activity_at', new Date(Date.now() - 4 * 86400_000).toISOString())

  for (const m of faded ?? []) {
    const intel = (m.match_intel ?? {}) as Record<string, unknown>
    if (intel.ghost_reengage_sent) continue  // never twice
    const days = Math.round(
      (Date.now() - new Date(m.last_activity_at).getTime()) / 86400_000,
    )
    intents.push({
      kind: 'ghost_reengage',
      match_id: m.id,
      match_name: m.name,
      phone: m.her_phone,
      delayHours: 0,
      sequence_step: days,
    })
  }

  // 4. Quiet chatting matches → follow_up
  const delays: number[] = Array.isArray(config.delays_hours)
    ? (config.delays_hours as number[])
    : [24, 72, 168]
  const oldestDelay = delays[delays.length - 1] ?? 168
  const { data: quiet } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, name, her_phone, last_activity_at, match_intel')
    .eq('user_id', julian)
    .eq('stage', 'chatting')
    .lte('last_activity_at', new Date(Date.now() - 36 * 3600_000).toISOString())
    .gte('last_activity_at', new Date(Date.now() - oldestDelay * 3600_000 * 1.5).toISOString())

  for (const m of quiet ?? []) {
    const { count } = await (supabase as any)
      .from('clapcheeks_scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', julian)
      .eq('match_id', m.id)
      .eq('sequence_type', 'follow_up')
    const step = count ?? 0
    if (step >= delays.length || step >= config.max_followups) continue
    intents.push({
      kind: 'follow_up',
      match_id: m.id,
      match_name: m.name,
      phone: m.her_phone,
      delayHours: delays[step] ?? 24,
      sequence_step: step,
    })
  }

  // De-dupe: skip if already a pending/approved row for this match+kind
  const enqueued: Array<{ match_name: string; kind: FollowupKind; scheduled_at: string }> = []
  for (const intent of intents) {
    const { data: existing } = await (supabase as any)
      .from('clapcheeks_scheduled_messages')
      .select('id')
      .eq('user_id', julian)
      .eq('match_id', intent.match_id)
      .eq('sequence_type', intent.kind)
      .in('status', ['pending', 'approved'])
      .limit(1)
    if (Array.isArray(existing) && existing.length > 0) continue

    const messageText = await generateFollowupMessage({
      kind: intent.kind,
      matchName: intent.match_name,
      platform: 'iMessage',
      sequenceStep: intent.sequence_step,
      dateContext: intent.dateContext,
    })

    const scheduledAt = pickOptimalSendTimeISO(intent.delayHours, {
      timezone: config.timezone,
      optimal_send_start_hour: config.optimal_send_start_hour,
      optimal_send_end_hour: config.optimal_send_end_hour,
      quiet_hours_start: config.quiet_hours_start,
      quiet_hours_end: config.quiet_hours_end,
    })

    const { error } = await (supabase as any)
      .from('clapcheeks_scheduled_messages')
      .insert({
        user_id: julian,
        match_id: intent.match_id,
        match_name: intent.match_name,
        platform: 'iMessage',
        phone: intent.phone,
        message_text: messageText,
        scheduled_at: scheduledAt,
        status: 'approved',  // auto-approved; user can edit/cancel before send
        sequence_type: intent.kind,
        sequence_step: intent.sequence_step,
        delay_hours: intent.delayHours,
      })

    if (!error) {
      enqueued.push({
        match_name: intent.match_name,
        kind: intent.kind,
        scheduled_at: scheduledAt,
      })
      // Mark ghost_reengage as fired so we never repeat
      if (intent.kind === 'ghost_reengage') {
        await (supabase as any)
          .from('clapcheeks_matches')
          .update({
            match_intel: {
              ghost_reengage_sent: new Date().toISOString(),
            },
          })
          .eq('id', intent.match_id)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    intents: intents.length,
    enqueued: enqueued.length,
    detail: enqueued,
  })
}
