import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'

// PATCH /api/scheduled-messages/[id] — approve, reject, or update
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { status, rejection_reason, message_text, scheduled_at } = body

  // Validate status transitions
  if (status && !['approved', 'rejected', 'pending'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (status) updates.status = status
  if (rejection_reason) updates.rejection_reason = rejection_reason
  if (message_text) updates.message_text = message_text
  if (scheduled_at) updates.scheduled_at = scheduled_at

  const { data, error } = await convex
    .from('clapcheeks_scheduled_messages')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ message: data })
}

// DELETE /api/scheduled-messages/[id]
// Convex currently exposes status transitions, not a hard-delete mutation.
// Treat dashboard deletion as a safe cancel so the row leaves active queues
// without losing audit history.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await convex
    .from('clapcheeks_scheduled_messages')
    .update({ status: 'failed', rejection_reason: 'deleted_from_dashboard' })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true, message: data })
}
