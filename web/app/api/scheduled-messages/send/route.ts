import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Phones must be E.164-ish: optional leading + then 8-15 digits. Blocks shell
// metachars from ever reaching god's argv.
const PHONE_RE = /^\+?[0-9]{8,15}$/

// POST /api/scheduled-messages/send — fire a god draft for an approved message.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: msg, error: fetchErr } = await supabase
    .from('clapcheeks_scheduled_messages')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

  const scheduledAt = new Date(msg.scheduled_at)
  const now = new Date()
  const delayMinutes = Math.max(
    0,
    Math.round((scheduledAt.getTime() - now.getTime()) / 60000),
  )

  const phone = String(msg.phone).trim()
  const messageText = String(msg.message_text)

  let godDraftId: string | null = null
  let godError: string | null = null

  try {
    // execFile: each argv is passed literally, no shell interpretation, so
    // message body cannot inject commands regardless of contents.
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
    await supabase
      .from('clapcheeks_scheduled_messages')
      .update({ status: 'failed', rejection_reason: godError })
      .eq('id', id)

    return NextResponse.json({ error: godError }, { status: 500 })
  }

  const { data: updated, error: updateErr } = await supabase
    .from('clapcheeks_scheduled_messages')
    .update({
      status: 'sent',
      sent_at: delayMinutes === 0 ? new Date().toISOString() : null,
      god_draft_id: godDraftId,
    })
    .eq('id', id)
    .select()
    .single()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({
    message: updated,
    god_draft_id: godDraftId,
    delay_minutes: delayMinutes,
  })
}
