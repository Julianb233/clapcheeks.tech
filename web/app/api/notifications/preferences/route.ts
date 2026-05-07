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
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: migrated to Convex notification_prefs.

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
    const convex = getConvexServerClient()
    const data = await convex.query(api.notifications.getPrefs, { user_id: user.id })
    return NextResponse.json(
      data
        ? {
            email: data.email ?? '',
            phone_e164: data.phone_e164 ?? '',
            channels_per_event: data.channels_per_event ?? {},
            quiet_hours_start: data.quiet_hours_start,
            quiet_hours_end: data.quiet_hours_end,
          }
        : {
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
    try {
      const convex = getConvexServerClient()
      await convex.mutation(api.notifications.upsertPrefs, {
        user_id: user.id,
        email: clean.email ?? undefined,
        phone_e164: clean.phone_e164 ?? undefined,
        channels_per_event: clean.channels_per_event,
        quiet_hours_start: clean.quiet_hours_start,
        quiet_hours_end: clean.quiet_hours_end,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'upsert_failed'
      console.error('notif prefs upsert error', msg)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('notif prefs PUT error', err)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
