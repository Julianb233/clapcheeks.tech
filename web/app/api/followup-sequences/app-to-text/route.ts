import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_FOLLOWUP_CONFIG } from '@/lib/followup/types'
import { pickOptimalSendTimeISO } from '@/lib/followup/optimal-timing'
import { generateFollowupMessage } from '@/lib/followup/generate-content'

/**
 * POST /api/followup-sequences/app-to-text
 *
 * Create a pending "move to text" transition message when conversation warmth
 * has crossed the user's threshold.
 *
 * Body:
 *   - match_name (required)
 *   - platform (required — source platform, e.g. Tinder, Bumble, Hinge)
 *   - warmth_score (required — 0..1)
 *   - message_count (required — total messages so far)
 *   - match_id (optional)
 *   - phone (optional — destination for text)
 *   - conversation_summary / last_message (optional context)
 *   - override_message (optional)
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
    warmth_score,
    message_count,
    conversation_summary,
    last_message,
    override_message,
  } = body ?? {}

  if (!match_name || !platform) {
    return NextResponse.json(
      { error: 'match_name and platform are required' },
      { status: 400 },
    )
  }

  const warmth = Number(warmth_score)
  const count = Number(message_count)
  if (!Number.isFinite(warmth) || !Number.isFinite(count)) {
    return NextResponse.json(
      { error: 'warmth_score and message_count must be numbers' },
      { status: 400 },
    )
  }

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

  if (!config?.app_to_text_enabled) {
    return NextResponse.json(
      { error: 'App-to-text transitions disabled for this user' },
      { status: 400 },
    )
  }

  if (warmth < config.warmth_threshold) {
    return NextResponse.json(
      {
        error: 'Warmth below threshold — transition not triggered',
        warmth_score: warmth,
        threshold: config.warmth_threshold,
      },
      { status: 409 },
    )
  }

  if (count < config.min_messages_before_transition) {
    return NextResponse.json(
      {
        error: 'Not enough messages yet — transition not triggered',
        message_count: count,
        required: config.min_messages_before_transition,
      },
      { status: 409 },
    )
  }

  // Skip if an app_to_text is already pending/approved for this match.
  if (match_id) {
    const { data: existing } = await supabase
      .from('clapcheeks_scheduled_messages')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('match_id', match_id)
      .eq('sequence_type', 'app_to_text')
      .in('status', ['pending', 'approved'])
      .limit(1)
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'App-to-text transition already queued', existing: existing[0] },
        { status: 409 },
      )
    }
  }

  // Deliver in the next preferred window, no long delay.
  const scheduledAt = pickOptimalSendTimeISO(1, {
    timezone: config.timezone,
    optimal_send_start_hour: config.optimal_send_start_hour,
    optimal_send_end_hour: config.optimal_send_end_hour,
    quiet_hours_start: config.quiet_hours_start,
    quiet_hours_end: config.quiet_hours_end,
  })

  const messageText =
    override_message ??
    (await generateFollowupMessage({
      kind: 'app_to_text',
      matchName: match_name,
      platform,
      lastMessage: last_message,
      conversationSummary: conversation_summary,
    }))

  const { data: inserted, error } = await supabase
    .from('clapcheeks_scheduled_messages')
    .insert({
      user_id: user.id,
      match_id: match_id ?? null,
      match_name,
      platform,
      phone: phone ?? null,
      message_text: messageText,
      scheduled_at: scheduledAt,
      sequence_type: 'app_to_text',
      sequence_step: 0,
      delay_hours: 1,
      status: 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    message: inserted,
    warmth_score: warmth,
    threshold: config.warmth_threshold,
    scheduled_at: scheduledAt,
  }, { status: 201 })
}
