// AI-9535 — Migrated to Convex outbound_scheduled_messages + followup_sequences.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { DEFAULT_FOLLOWUP_CONFIG } from '@/lib/followup/types'
import { pickOptimalSendTimeISO } from '@/lib/followup/optimal-timing'
import { generateFollowupMessage } from '@/lib/followup/generate-content'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { match_name, match_id, platform, phone, conversation_summary,
          last_message, sequence_step, override_message } = body ?? {}

  if (!match_name) {
    return NextResponse.json({ error: 'match_name is required' }, { status: 400 })
  }

  const convex = getConvexServerClient()
  const config = await convex.mutation(api.drips.getOrCreateConfig, { user_id: user.id })

  if (!config?.enabled) {
    return NextResponse.json(
      { error: 'Follow-up sequences are disabled for this user' },
      { status: 400 },
    )
  }

  const delays: number[] = Array.isArray(config.delays_hours)
    ? (config.delays_hours as number[])
    : DEFAULT_FOLLOWUP_CONFIG.delays_hours

  let step = typeof sequence_step === 'number' ? sequence_step : 0
  if (typeof sequence_step !== 'number' && match_id) {
    const count = await convex.query(api.outbound.countFollowupsForMatch, {
      user_id: user.id, match_id,
    })
    step = count ?? 0
  }

  if (step >= delays.length || step >= config.max_followups) {
    return NextResponse.json(
      {
        error: 'Max follow-ups reached for this match',
        step,
        max: Math.min(delays.length, config.max_followups),
      },
      { status: 409 },
    )
  }

  const delayHours = delays[step] ?? delays[delays.length - 1]
  const scheduledAtIso = pickOptimalSendTimeISO(delayHours, {
    timezone: config.timezone,
    optimal_send_start_hour: config.optimal_send_start_hour,
    optimal_send_end_hour: config.optimal_send_end_hour,
    quiet_hours_start: config.quiet_hours_start,
    quiet_hours_end: config.quiet_hours_end,
  })
  const scheduledAtMs = new Date(scheduledAtIso).getTime()

  const messageText =
    override_message ??
    (await generateFollowupMessage({
      kind: 'follow_up',
      matchName: match_name,
      platform: platform ?? 'iMessage',
      lastMessage: last_message,
      conversationSummary: conversation_summary,
      sequenceStep: step,
    }))

  try {
    const inserted = await convex.mutation(api.outbound.enqueueScheduledMessage, {
      user_id: user.id,
      match_id: match_id ?? undefined,
      match_name,
      platform: platform ?? 'iMessage',
      phone: phone ?? undefined,
      message_text: messageText,
      scheduled_at: scheduledAtMs,
      sequence_type: 'follow_up',
      sequence_step: step,
      delay_hours: delayHours,
    })
    return NextResponse.json({
      message: inserted, step, delay_hours: delayHours, scheduled_at: scheduledAtIso,
    }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
