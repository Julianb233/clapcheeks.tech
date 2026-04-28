/**
 * Operator notification preferences (AI-8772).
 *
 *   GET  /api/notifications/preferences  -> returns the current row or defaults
 *   PUT  /api/notifications/preferences  -> upserts {email, phone_e164,
 *                                            channels_per_event, quiet_hours_*}
 *
 * Cookie-session auth (the operator hits this from the dashboard).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_CHANNELS = new Set(['email', 'imessage', 'push'])
const ALLOWED_EVENTS = new Set([
  'date_booked',
  'ban_detected',
  'new_match',
  'draft_queued',
  'token_expiring',
])

interface PrefsBody {
  email?: string
  phone_e164?: string
  channels_per_event?: Record<string, string[]>
  quiet_hours_start?: number
  quiet_hours_end?: number
}

function sanitize(body: PrefsBody) {
  const channels: Record<string, string[]> = {}
  const incoming = body.channels_per_event || {}
  for (const [event, list] of Object.entries(incoming)) {
    if (!ALLOWED_EVENTS.has(event)) continue
    if (!Array.isArray(list)) continue
    channels[event] = Array.from(
      new Set(list.filter((c) => typeof c === 'string' && ALLOWED_CHANNELS.has(c))),
    )
  }
  const start = Number.isFinite(body.quiet_hours_start)
    ? Math.max(0, Math.min(23, Math.trunc(body.quiet_hours_start as number)))
    : 21
  const end = Number.isFinite(body.quiet_hours_end)
    ? Math.max(0, Math.min(23, Math.trunc(body.quiet_hours_end as number)))
    : 8
  return {
    email: typeof body.email === 'string' ? body.email.slice(0, 320) : null,
    phone_e164:
      typeof body.phone_e164 === 'string'
        ? body.phone_e164.replace(/[^\d+]/g, '').slice(0, 32)
        : null,
    channels_per_event: channels,
    quiet_hours_start: start,
    quiet_hours_end: end,
  }
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const { data } = await supabase
      .from('clapcheeks_notification_prefs')
      .select('email, phone_e164, channels_per_event, quiet_hours_start, quiet_hours_end')
      .eq('user_id', user.id)
      .maybeSingle()
    return NextResponse.json(
      data || {
        email: user.email ?? '',
        phone_e164: '',
        channels_per_event: {},
        quiet_hours_start: 21,
        quiet_hours_end: 8,
      },
    )
  } catch (err) {
    console.error('notif prefs GET error', err)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    let body: PrefsBody
    try {
      body = (await req.json()) as PrefsBody
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }
    const clean = sanitize(body)
    const { error } = await supabase
      .from('clapcheeks_notification_prefs')
      .upsert(
        {
          user_id: user.id,
          ...clean,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
    if (error) {
      console.error('notif prefs upsert error', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('notif prefs PUT error', err)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
