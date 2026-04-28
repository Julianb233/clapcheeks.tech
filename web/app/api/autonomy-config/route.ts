import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as Sentry from '@sentry/nextjs'

// Whitelist of columns that exist on `clapcheeks_autonomy_config`
// (see supabase/migrations/20260420450000_autonomy_engine.sql).
//
// The dashboard sometimes sends fields that don't exist as real columns
// (legacy field names like `global_level`, `notify_on_auto_send`, etc.).
// We translate the well-known legacy aliases here, then drop anything
// else that isn't in the schema so a stray field can't 500 the call.
const ALLOWED_COLUMNS = new Set([
  'autonomy_level',
  'auto_swipe_enabled',
  'auto_respond_enabled',
  'auto_reengage_enabled',
  'auto_swipe_confidence_min',
  'auto_respond_confidence_min',
  'max_auto_swipes_per_hour',
  'max_auto_replies_per_hour',
  'stale_hours_threshold',
  'notify_on_auto_action',
  'require_approval_for_first_message',
])

const VALID_AUTONOMY_LEVELS = new Set(['supervised', 'semi_auto', 'full_auto'])

// Normalize legacy/alias field names from older dashboard versions.
function normalizePayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  // global_level -> autonomy_level (some legacy callers use 'semi'/'full' shorthand)
  if (input.global_level !== undefined && input.autonomy_level === undefined) {
    let level = String(input.global_level)
    if (level === 'semi') level = 'semi_auto'
    if (level === 'full') level = 'full_auto'
    out.autonomy_level = level
  }
  if (input.autonomy_level !== undefined) {
    out.autonomy_level = input.autonomy_level
  }

  // notify_on_auto_send -> notify_on_auto_action
  if (input.notify_on_auto_send !== undefined && input.notify_on_auto_action === undefined) {
    out.notify_on_auto_action = input.notify_on_auto_send
  }
  if (input.notify_on_auto_action !== undefined) {
    out.notify_on_auto_action = input.notify_on_auto_action
  }

  // Pass through anything else that maps to a real column
  for (const [k, v] of Object.entries(input)) {
    if (ALLOWED_COLUMNS.has(k) && out[k] === undefined) {
      out[k] = v
    }
  }

  return out
}

// PUT /api/autonomy-config — upsert the caller's autonomy config row
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
    }

    if (
      updates.autonomy_level !== undefined &&
      !VALID_AUTONOMY_LEVELS.has(String(updates.autonomy_level))
    ) {
      return NextResponse.json({ error: 'Invalid autonomy_level' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('clapcheeks_autonomy_config')
      .upsert({ user_id: user.id, ...updates }, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) {
      console.error('autonomy-config upsert error:', error)
      Sentry.captureException(error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ config: data })
  } catch (err) {
    console.error('autonomy-config PUT error:', err)
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
