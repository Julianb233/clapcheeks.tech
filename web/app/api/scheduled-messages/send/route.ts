// AI-9535 — Migrated to Convex outbound_scheduled_messages.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'

const execFileAsync = promisify(execFile)

const PHONE_RE = /^\+?[0-9]{8,15}$/

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const convex = getConvexServerClient()
  const msg = await convex.query(api.outbound.getById, {
    id: id as Id<'outbound_scheduled_messages'>,
    user_id: user.id,
  })

  if (!msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (msg.status !== 'approved') {
    return NextResponse.json(
      { error: 'Message must be approved before sending' },
      { status: 400 },
    )
  }

  if (!msg.phone || !PHONE_RE.test(String(msg.phone).trim())) {
    return NextResponse.json(
      { error: 'Valid E.164 phone number required for iMessage delivery' },
      { status: 400 },
    )
  }

  const scheduledAtMs = typeof msg.scheduled_at === 'number'
    ? msg.scheduled_at : new Date(msg.scheduled_at as unknown as string).getTime()
  const now = Date.now()
  const delayMinutes = Math.max(0, Math.round((scheduledAtMs - now) / 60000))

  const phone = String(msg.phone).trim()
  const messageText = String(msg.message_text)

  let godDraftId: string | null = null
  let godError: string | null = null

  try {
    const args = delayMinutes > 0
      ? ['draft', phone, messageText, '--delay', String(delayMinutes)]
      : ['mac', 'send', phone, messageText]
    const { stdout, stderr } = await execFileAsync('god', args, { timeout: 30_000 })
    godDraftId =
      stdout.trim().match(/draft[_-]?id[:\s]+(\S+)/i)?.[1] ??
      `sent-${Date.now()}`
    if (stderr && !stdout) godError = stderr.trim()
  } catch (err: unknown) {
    godError = err instanceof Error ? err.message : String(err)
  }

  if (godError && !godDraftId) {
    await convex.mutation(api.outbound.markFailed, {
      id: id as Id<'outbound_scheduled_messages'>,
      user_id: user.id,
      rejection_reason: godError,
    })
    return NextResponse.json({ error: godError }, { status: 500 })
  }

  const updated = await convex.mutation(api.outbound.markSent, {
    id: id as Id<'outbound_scheduled_messages'>,
    user_id: user.id,
    god_draft_id: godDraftId ?? undefined,
    sent_at: delayMinutes === 0 ? Date.now() : undefined,
  })

  return NextResponse.json({
    message: updated,
    god_draft_id: godDraftId,
    delay_minutes: delayMinutes,
  })
}
