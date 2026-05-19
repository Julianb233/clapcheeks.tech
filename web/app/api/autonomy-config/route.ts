import { NextRequest, NextResponse } from 'next/server'
import {
  getClapCheeksUserSettings,
  upsertClapCheeksUserSettings,
} from '@/lib/clapcheeks/user-settings'
import * as Sentry from '@sentry/nextjs'

const VALID_AUTONOMY_LEVELS = new Set(['supervised', 'semi_auto', 'full_auto'])

function levelPatch(level: string): Record<string, boolean> {
  if (level === 'supervised') {
    return {
      approve_openers: true,
      approve_replies: true,
      approve_date_asks: true,
      approve_bookings: true,
    }
  }
  if (level === 'semi_auto') {
    return {
      approve_openers: true,
      approve_replies: false,
      approve_date_asks: true,
      approve_bookings: true,
    }
  }
  if (level === 'full_auto') {
    return {
      approve_openers: false,
      approve_replies: false,
      approve_date_asks: false,
      approve_bookings: true,
    }
  }
  return {}
}

function configFromSettings(row: Record<string, unknown> | null) {
  const approveOpeners = Boolean(row?.approve_openers)
  const approveReplies = row?.approve_replies !== undefined ? Boolean(row.approve_replies) : true
  const approveDateAsks = row?.approve_date_asks !== undefined ? Boolean(row.approve_date_asks) : true
  const approveBookings = row?.approve_bookings !== undefined ? Boolean(row.approve_bookings) : true

  let globalLevel: 'supervised' | 'semi_auto' | 'full_auto' | 'custom' = 'custom'
  if (approveOpeners && approveReplies && approveDateAsks && approveBookings) globalLevel = 'supervised'
  if (approveOpeners && !approveReplies && approveDateAsks && approveBookings) globalLevel = 'semi_auto'
  if (!approveOpeners && !approveReplies && !approveDateAsks && approveBookings) globalLevel = 'full_auto'

  return {
    source: 'clapcheeks_user_settings',
    global_level: globalLevel,
    approve_openers: approveOpeners,
    approve_replies: approveReplies,
    approve_date_asks: approveDateAsks,
    approve_bookings: approveBookings,
    auto_respond_enabled: !approveReplies,
    require_approval_for_first_message: approveOpeners,
    ai_active: row?.ai_active ?? null,
    ai_paused_until: row?.ai_paused_until ?? null,
    ai_paused_reason: row?.ai_paused_reason ?? null,
    updated_at: row?.updated_at ?? null,
  }
}

function normalizePayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (input.global_level !== undefined || input.autonomy_level !== undefined) {
    let level = String(input.global_level)
    if (input.autonomy_level !== undefined) level = String(input.autonomy_level)
    if (level === 'semi') level = 'semi_auto'
    if (level === 'full') level = 'full_auto'
    if (!VALID_AUTONOMY_LEVELS.has(level)) {
      throw new Error('Invalid autonomy_level')
    }
    Object.assign(out, levelPatch(level))
  }

  if (input.auto_respond_enabled !== undefined) {
    out.approve_replies = !Boolean(input.auto_respond_enabled)
  }
  if (input.require_approval_for_first_message !== undefined) {
    out.approve_openers = Boolean(input.require_approval_for_first_message)
  }

  for (const key of [
    'approve_openers',
    'approve_replies',
    'approve_date_asks',
    'approve_bookings',
    'ai_active',
  ]) {
    if (input[key] !== undefined) {
      out[key] = Boolean(input[key])
    }
  }

  return out
}

export async function GET() {
  try {
    const { row } = await getClapCheeksUserSettings()
    return NextResponse.json({ config: configFromSettings(row) })
  } catch (err) {
    console.error('autonomy-config GET error:', err)
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// PUT /api/autonomy-config — update the runtime approval gates the workers read.
export async function PUT(request: NextRequest) {
  try {
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be an object' }, { status: 400 })
    }

    const updates = normalizePayload(body as Record<string, unknown>)

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No persisted runtime fields provided' }, { status: 400 })
    }

    const row = await upsertClapCheeksUserSettings(updates)
    return NextResponse.json({ config: configFromSettings(row) })
  } catch (err) {
    console.error('autonomy-config PUT error:', err)
    Sentry.captureException(err)
    const isBadRequest = err instanceof Error && err.message === 'Invalid autonomy_level'
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: isBadRequest ? 400 : 500 },
    )
  }
}
