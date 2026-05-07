// AI-9535 — Migrated to Convex outbound_scheduled_messages + followup_sequences.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import { pickOptimalSendTimeISO } from '@/lib/followup/optimal-timing'
import { generateFollowupMessage } from '@/lib/followup/generate-content'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { match_name, match_id, platform, phone, warmth_score, message_count,
          conversation_summary, last_message, override_message } = body ?? {}

  if (!match_name || !platform) {
    return NextResponse.json(
      { error: 'match_name and platform are required' }, { status: 400 },
    )
  }

  const warmth = Number(warmth_score)
  const count = Number(message_count)
  if (!Number.isFinite(warmth) || !Number.isFinite(count)) {
    return NextResponse.json(
      { error: 'warmth_score and message_count must be numbers' }, { status: 400 },
    )
  }

  const convex = getConvexServerClient()
  const config = await convex.mutation(api.drips.getOrCreateConfig, { user_id: user.id })

  if (!config?.app_to_text_enabled) {
    return NextResponse.json(
      { error: 'App-to-text transitions disabled for this user' }, { status: 400 },
    )
  }

  if (warmth < config.warmth_threshold) {
    return NextResponse.json(
      {
        error: 'Warmth below threshold — transition not triggered',
        warmth_score: warmth, threshold: config.warmth_threshold,
      },
      { status: 409 },
    )
  }

  if (count < config.min_messages_before_transition) {
    return NextResponse.json(
      {
        error: 'Not enough messages yet — transition not triggered',
        message_count: count, required: config.min_messages_before_transition,
      },
      { status: 409 },
    )
  }

  if (match_id) {
    const existing = await convex.query(
      api.outbound.findExistingAppToTextForMatch,
      { user_id: user.id, match_id },
    )
    if (existing) {
      return NextResponse.json(
        { error: 'App-to-text transition already queued', existing },
        { status: 409 },
      )
    }
  }

  const scheduledAtIso = pickOptimalSendTimeISO(1, {
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
      kind: 'app_to_text',
      matchName: match_name,
      platform,
      lastMessage: last_message,
      conversationSummary: conversation_summary,
    }))

  try {
    const inserted = await convex.mutation(api.outbound.enqueueScheduledMessage, {
      user_id: user.id,
      match_id: match_id ?? undefined,
      match_name,
      platform,
      phone: phone ?? undefined,
      message_text: messageText,
      scheduled_at: scheduledAtMs,
      sequence_type: 'app_to_text',
      sequence_step: 0,
      delay_hours: 1,
    })
    return NextResponse.json({
      message: inserted, warmth_score: warmth,
      threshold: config.warmth_threshold, scheduled_at: scheduledAtIso,
    }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
