import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// POST /api/scheduled-messages/send — fire a god draft for an approved message
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Fetch the message
  const { data: msg, error: fetchErr } = await supabase
    .from('clapcheeks_scheduled_messages')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !msg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (msg.status !== 'approved') {
    return NextResponse.json({ error: 'Message must be approved before sending' }, { status: 400 })
  }

  if (!msg.phone) {
    return NextResponse.json({ error: 'Phone number required for iMessage delivery' }, { status: 400 })
  }

  // Calculate delay in minutes from now to scheduled_at
  const scheduledAt = new Date(msg.scheduled_at)
  const now = new Date()
  const delayMinutes = Math.max(0, Math.round((scheduledAt.getTime() - now.getTime()) / 60000))

  let godDraftId: string | null = null
  let godError: string | null = null

  try {
    // god draft sends an iMessage at the scheduled time
    // Format: god draft "+phone" "message" --delay <minutes>
    const escapedMessage = msg.message_text.replace(/"/g, '\\"').replace(/`/g, '\\`')
    const cmd = delayMinutes > 0
      ? `god draft "${msg.phone}" "${escapedMessage}" --delay ${delayMinutes}`
      : `god mac send "${msg.phone}" "${escapedMessage}"`

    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 })
    godDraftId = stdout.trim().match(/draft[_-]?id[:\s]+(\S+)/i)?.[1] ?? `sent-${Date.now()}`
    if (stderr && !stdout) godError = stderr.trim()
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    godError = errMsg
  }

  if (godError && !godDraftId) {
    // Log failure but don't block — update status to failed
    await supabase
      .from('clapcheeks_scheduled_messages')
      .update({ status: 'failed', rejection_reason: godError })
      .eq('id', id)

    return NextResponse.json({ error: godError }, { status: 500 })
  }

  // Update to sent
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

  return NextResponse.json({ message: updated, god_draft_id: godDraftId, delay_minutes: delayMinutes })
}
