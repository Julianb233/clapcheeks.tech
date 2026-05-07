// AI-9535 — Migrated to Convex approval_queue. Auto-actions log still on Supabase.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as Sentry from '@sentry/nextjs'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { getFleetUserId } from '@/lib/fleet-user'

const VALID_STATUSES = new Set(['approved', 'rejected'])

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

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: { status?: string; edited_text?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { status, edited_text } = body || {}

    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: 'status must be "approved" or "rejected"' }, { status: 400 },
      )
    }

    let updated
    try {
      updated = await getConvexServerClient().mutation(api.queues.decideApproval, {
        id: id as Id<'approval_queue'>,
        user_id: getFleetUserId(),
        status: status as 'approved' | 'rejected',
        edited_text: edited_text ?? undefined,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'Not found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (msg === 'Forbidden') return NextResponse.json({ error: 'Not found' }, { status: 404 })
      console.error('approval update error:', err)
      Sentry.captureException(err)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
