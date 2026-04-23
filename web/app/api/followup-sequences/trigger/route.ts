import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_FOLLOWUP_CONFIG } from '@/lib/followup/types'
import { pickOptimalSendTimeISO } from '@/lib/followup/optimal-timing'
import { generateFollowupMessage } from '@/lib/followup/generate-content'

/**
 * POST /api/followup-sequences/trigger
 *
 * Create a pending follow-up scheduled message for a match.
 *
 * Body:
 *   - match_name (required)
 *   - match_id (optional — if present, used to compute next sequence step)
 *   - platform (optional, default 'iMessage')
 *   - phone (optional)
 *   - conversation_summary (optional — text to ground the AI)
 *   - last_message (optional — fallback context)
 *   - sequence_step (optional — explicit step, else derived from prior follow_ups for this match)
 *   - override_message (optional — skip AI and use this text)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    match_name,
    match_id,
    platform,
    phone,
    conversation_summary,
    last_message,
    sequence_step,
    override_message,
  } = body ?? {}

  if (!match_name) {
    return NextResponse.json({ error: 'match_name is required' }, { status: 400 })
  }

  // Load config (create default if missing).
  let { data: config } = await supabase
    .from('clapcheeks_followup_sequences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!config) {
    const { data: created } = await supabase
      .from('clapcheeks_followup_sequences')
      .insert({ user_id: user.id, ...DEFAULT_FOLLOWUP_CONFIG })
      .select()
      .single()
    config = created
  }

  if (!config?.enabled) {
    return NextResponse.json(
      { error: 'Follow-up sequences are disabled for this user' },
      { status: 400 },
    )
  }

  const delays: number[] = Array.isArray(config.delays_hours)
    ? (config.delays_hours as number[])
    : DEFAULT_FOLLOWUP_CONFIG.delays_hours

  // Determine sequence step.
  let step = typeof sequence_step === 'number' ? sequence_step : 0
  if (typeof sequence_step !== 'number' && match_id) {
    const { count } = await supabase
      .from('clapcheeks_scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('match_id', match_id)
      .eq('sequence_type', 'follow_up')
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
  const scheduledAt = pickOptimalSendTimeISO(delayHours, {
    timezone: config.timezone,
    optimal_send_start_hour: config.optimal_send_start_hour,
    optimal_send_end_hour: config.optimal_send_end_hour,
    quiet_hours_start: config.quiet_hours_start,
    quiet_hours_end: config.quiet_hours_end,
  })

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

  const { data: inserted, error } = await supabase
    .from('clapcheeks_scheduled_messages')
    .insert({
      user_id: user.id,
      match_id: match_id ?? null,
      match_name,
      platform: platform ?? 'iMessage',
      phone: phone ?? null,
      message_text: messageText,
      scheduled_at: scheduledAt,
      sequence_type: 'follow_up',
      sequence_step: step,
      delay_hours: delayHours,
      status: 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    message: inserted,
    step,
    delay_hours: delayHours,
    scheduled_at: scheduledAt,
  }, { status: 201 })
}
