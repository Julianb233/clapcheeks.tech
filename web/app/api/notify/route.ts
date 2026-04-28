/**
 * Operator notification dispatcher (AI-8772).
 *
 *   POST /api/notify
 *   Headers:
 *     X-Device-Token: <token from clapcheeks_agent_tokens> (preferred)
 *     OR: cookie session of an authenticated user (admin-style call)
 *   Body:
 *     {
 *       event_type: "date_booked" | "ban_detected" | "new_match" |
 *                   "draft_queued" | "token_expiring" | string,
 *       payload: {
 *         title?: string,
 *         body?: string,
 *         platform?: string,
 *         match_name?: string,
 *         [k: string]: any,
 *       },
 *       target_user_id?: uuid    // required when called with X-Device-Token
 *     }
 *
 * Looks up the operator's clapcheeks_notification_prefs.channels_per_event
 * map for this event_type and dispatches to each enabled channel:
 *   - email     -> Resend send (if RESEND_API_KEY)
 *   - imessage  -> insert into clapcheeks_outbound_notifications for the
 *                  local agent to drain on its next poll
 *   - push      -> insert into clapcheeks_push_queue for the (future) PWA
 *                  service worker to drain
 *
 * Quiet hours are respected for non-urgent events (everything except
 * `ban_detected` and `token_expiring`).
 *
 * Returns 200 with `{ ok: true, results: [{ channel, status, ... }] }`.
 * Returns 200 with `{ ok: true, results: [], skipped: "no_channels" }` if
 * the operator opted out of every channel for this event type. Returns
 * 200 with `skipped: "quiet_hours"` if suppressed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

type Channel = 'email' | 'imessage' | 'push'

interface ChannelResult {
  channel: Channel
  status: 'queued' | 'sent' | 'skipped' | 'error'
  detail?: string
}

interface NotifyBody {
  event_type: string
  payload?: Record<string, unknown> & {
    title?: string
    body?: string
  }
  target_user_id?: string
}

const URGENT_EVENTS = new Set(['ban_detected', 'token_expiring'])

function isInQuietHours(start: number, end: number, hour: number): boolean {
  // start=21, end=8 means 21..23 + 0..7 inclusive are quiet
  if (start === end) return false
  if (start < end) {
    return hour >= start && hour < end
  }
  // wraps midnight
  return hour >= start || hour < end
}

function humanizeEvent(event: string, payload: Record<string, unknown>): {
  title: string
  body: string
} {
  const title = (payload.title as string) || defaultTitle(event)
  const body = (payload.body as string) || defaultBody(event, payload)
  return { title, body }
}

function defaultTitle(event: string): string {
  switch (event) {
    case 'date_booked':
      return 'Clapcheeks: Date booked'
    case 'ban_detected':
      return 'Clapcheeks: Ban signal detected'
    case 'new_match':
      return 'Clapcheeks: New match'
    case 'draft_queued':
      return 'Clapcheeks: Draft needs your eyes'
    case 'token_expiring':
      return 'Clapcheeks: Platform token expiring'
    default:
      return `Clapcheeks: ${event}`
  }
}

function defaultBody(event: string, payload: Record<string, unknown>): string {
  const platform = (payload.platform as string) || 'a platform'
  const name = (payload.match_name as string) || 'a match'
  const slot = (payload.slot as string) || ''
  switch (event) {
    case 'date_booked':
      return `${name} on ${platform}${slot ? ` for ${slot}` : ''}.`
    case 'ban_detected': {
      const banType = (payload.ban_type as string) || 'unknown'
      return `Auto-paused on ${platform}: ${banType}.`
    }
    case 'new_match':
      return `${name} matched on ${platform}.`
    case 'draft_queued':
      return `Low-confidence draft for ${name} on ${platform} is waiting.`
    case 'token_expiring':
      return `Reauth ${platform} soon to keep the agent running.`
    default:
      return JSON.stringify(payload).slice(0, 280)
  }
}

async function resolveAuthorizedUserId(req: NextRequest, body: NotifyBody): Promise<{
  userId: string | null
  via: 'device-token' | 'session' | null
  error?: string
}> {
  // Preferred: device token (the way the local agent calls us).
  const deviceToken = req.headers.get('x-device-token') || ''
  if (deviceToken) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      return { userId: null, via: 'device-token', error: 'server_unconfigured' }
    }
    const sb = createSupabaseClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await sb
      .from('clapcheeks_agent_tokens')
      .select('user_id')
      .eq('token', deviceToken)
      .limit(1)
    if (error || !data || data.length === 0) {
      return { userId: null, via: 'device-token', error: 'invalid_device_token' }
    }
    const tokenUser = data[0].user_id as string
    // Allow target_user_id ONLY if it matches the token's owner (no
    // privilege escalation through this endpoint).
    if (body.target_user_id && body.target_user_id !== tokenUser) {
      return { userId: null, via: 'device-token', error: 'target_user_id_mismatch' }
    }
    return { userId: tokenUser, via: 'device-token' }
  }

  // Fallback: cookie session (operator hits this from the dashboard).
  try {
    const sb = await createServerSupabase()
    const {
      data: { user },
    } = await sb.auth.getUser()
    if (!user) return { userId: null, via: null, error: 'unauthorized' }
    return { userId: user.id, via: 'session' }
  } catch {
    return { userId: null, via: null, error: 'unauthorized' }
  }
}

export async function POST(req: NextRequest) {
  let body: NotifyBody
  try {
    body = (await req.json()) as NotifyBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  if (!body || !body.event_type) {
    return NextResponse.json({ ok: false, error: 'event_type required' }, { status: 400 })
  }

  const auth = await resolveAuthorizedUserId(req, body)
  if (!auth.userId) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'unauthorized' },
      { status: 401 },
    )
  }
  const userId = auth.userId

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'server_unconfigured' },
      { status: 500 },
    )
  }
  const adminSb = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // Load preferences.
  const { data: prefRow } = await adminSb
    .from('clapcheeks_notification_prefs')
    .select('email, phone_e164, channels_per_event, quiet_hours_start, quiet_hours_end')
    .eq('user_id', userId)
    .maybeSingle()

  const channelsMap = (prefRow?.channels_per_event as Record<string, Channel[]> | null) || {}
  const channels = (channelsMap[body.event_type] || []) as Channel[]

  if (channels.length === 0) {
    return NextResponse.json({ ok: true, results: [], skipped: 'no_channels' })
  }

  // Quiet-hours gate (urgent events bypass).
  if (!URGENT_EVENTS.has(body.event_type) && prefRow) {
    const hour = new Date().getUTCHours() // best-effort; UI clarifies tz
    if (
      isInQuietHours(
        prefRow.quiet_hours_start ?? 21,
        prefRow.quiet_hours_end ?? 8,
        hour,
      )
    ) {
      return NextResponse.json({ ok: true, results: [], skipped: 'quiet_hours' })
    }
  }

  const { title, body: messageBody } = humanizeEvent(
    body.event_type,
    body.payload || {},
  )

  const results: ChannelResult[] = []

  // ---- Email channel (Resend) ----
  if (channels.includes('email')) {
    if (!process.env.RESEND_API_KEY) {
      results.push({ channel: 'email', status: 'error', detail: 'resend_unconfigured' })
    } else {
      const to = prefRow?.email
      if (!to) {
        results.push({ channel: 'email', status: 'skipped', detail: 'no_email_on_file' })
      } else {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY)
          const { error } = await resend.emails.send({
            from: 'Clap Cheeks <hello@clapcheeks.tech>',
            to: [to],
            subject: title,
            html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0a0a0a;color:#fff;border-radius:12px;">
              <h2 style="color:#e879f9;margin:0 0 12px 0;font-size:18px;">${escapeHtml(title)}</h2>
              <p style="color:#fff;font-size:14px;line-height:1.5;margin:0 0 16px 0;">${escapeHtml(messageBody)}</p>
              <p style="color:#999;font-size:12px;margin:0;">Open the dashboard: <a href="https://clapcheeks.tech/dashboard" style="color:#c026d3;">clapcheeks.tech/dashboard</a></p>
            </div>`,
          })
          if (error) {
            results.push({ channel: 'email', status: 'error', detail: error.message })
          } else {
            results.push({ channel: 'email', status: 'sent' })
          }
        } catch (err) {
          results.push({
            channel: 'email',
            status: 'error',
            detail: err instanceof Error ? err.message : 'send_failed',
          })
        }
      }
    }
  }

  // ---- iMessage channel (queued for the local agent to drain) ----
  if (channels.includes('imessage')) {
    const phone = prefRow?.phone_e164
    if (!phone) {
      results.push({ channel: 'imessage', status: 'skipped', detail: 'no_phone_on_file' })
    } else {
      const { error } = await adminSb
        .from('clapcheeks_outbound_notifications')
        .insert({
          user_id: userId,
          channel: 'imessage',
          phone_e164: phone,
          body: `${title}\n${messageBody}`,
          event_type: body.event_type,
        })
      if (error) {
        results.push({ channel: 'imessage', status: 'error', detail: error.message })
      } else {
        results.push({ channel: 'imessage', status: 'queued' })
      }
    }
  }

  // ---- Push channel (queued for the future PWA SW) ----
  if (channels.includes('push')) {
    const { error } = await adminSb.from('clapcheeks_push_queue').insert({
      user_id: userId,
      title,
      body: messageBody,
      event_type: body.event_type,
      payload: body.payload || {},
    })
    if (error) {
      results.push({ channel: 'push', status: 'error', detail: error.message })
    } else {
      results.push({ channel: 'push', status: 'queued' })
    }
  }

  return NextResponse.json({ ok: true, results })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
