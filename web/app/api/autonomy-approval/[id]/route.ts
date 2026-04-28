import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as Sentry from '@sentry/nextjs'

const VALID_STATUSES = new Set(['approved', 'rejected'])

// PATCH /api/autonomy-approval/[id] — approve or reject a queued action
//
// Body: { status: 'approved' | 'rejected', edited_text?: string }
//
// On approval: also writes a row to clapcheeks_auto_actions logging the
// operator's decision so the action log shows what the user okayed.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { status?: string; edited_text?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { status, edited_text } = body || {}

    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: 'status must be "approved" or "rejected"' },
        { status: 400 },
      )
    }

    // Build update payload — `proposed_text` is overridable when caller
    // edits the AI's suggestion before approving.
    const updates: Record<string, unknown> = {
      status,
      decided_at: new Date().toISOString(),
    }
    if (status === 'approved' && typeof edited_text === 'string' && edited_text.trim()) {
      updates.proposed_text = edited_text.trim()
    }

    const { data: updated, error: updateError } = await supabase
      .from('clapcheeks_approval_queue')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (updateError) {
      // PostgREST returns a specific code for "no rows" — surface as 404.
      if (updateError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      console.error('approval update error:', updateError)
      Sentry.captureException(updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // On approval, also append to the auto-actions log so the operator's
    // okay is visible in the action history. We don't fail the request if
    // the log insert errors — the approval itself already succeeded.
    if (status === 'approved') {
      const { error: logError } = await supabase
        .from('clapcheeks_auto_actions')
        .insert({
          user_id: user.id,
          action_type: updated.action_type,
          match_id: updated.match_id ?? null,
          match_name: updated.match_name ?? '',
          platform: updated.platform ?? '',
          proposed_text: updated.proposed_text ?? null,
          proposed_data: updated.proposed_data ?? {},
          confidence: updated.confidence ?? 0,
          status: 'approved',
          ai_reasoning: updated.ai_reasoning ?? '',
        })

      if (logError) {
        console.error('auto-action log insert error (non-fatal):', logError)
        Sentry.captureException(logError)
      }
    }

    return NextResponse.json({ approval: updated })
  } catch (err) {
    console.error('autonomy-approval PATCH error:', err)
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
