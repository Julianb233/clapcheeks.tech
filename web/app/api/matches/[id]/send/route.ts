import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/matches/[id]/send
 *   body: { text: string }
 *
 * Queues an outbound iMessage to the match's `her_phone`. The actual
 * `god mac send` call lives on the VPS (the Vercel function can't shell
 * out to god). We append to clapcheeks_outbound_queue so the VPS cron
 * (scripts/send_pending_outbound.py, runs every minute) picks it up.
 *
 * Side effects:
 *   - Optimistically appends the new message to clapcheeks_conversations
 *     so the UI sees it immediately
 *   - Clears match_intel.suggested_replies (drafts are stale once one
 *     is used) so the local Ollama worker generates fresh ones for the
 *     next inbound message
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { text?: string }
  const text = (body.text || '').trim()
  if (!text) {
    return NextResponse.json({ error: 'text required' }, { status: 400 })
  }
  if (text.length > 1500) {
    return NextResponse.json(
      { error: 'message too long (max 1500 chars)' },
      { status: 400 },
    )
  }

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, name, her_phone, match_id, match_intel, stage')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!match) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }
  if (!match.her_phone) {
    return NextResponse.json(
      { error: 'no phone on file for this match' },
      { status: 400 },
    )
  }

  const now = new Date().toISOString()

  // Optimistic append to the conversation so UI sees it immediately
  const { data: conv } = await (supabase as any)
    .from('clapcheeks_conversations')
    .select('messages')
    .eq('user_id', user.id)
    .eq('match_id', match.match_id)
    .maybeSingle()
  const prev = Array.isArray(conv?.messages) ? conv!.messages : []
  const next = [
    ...prev,
    { ts: now, from: 'him', text, source: 'one-tap-send' },
  ].slice(-100)
  await (supabase as any)
    .from('clapcheeks_conversations')
    .update({ messages: next, last_message_at: now })
    .eq('user_id', user.id)
    .eq('match_id', match.match_id)

  // Append to match_intel.outbound_queue so the VPS sender cron picks it up
  // (status='pending' → 'sent' once god mac send succeeds). Also clear stale
  // drafts + bump activity so health/cadence stays accurate.
  const intel =
    (match.match_intel && typeof match.match_intel === 'object'
      ? (match.match_intel as Record<string, unknown>)
      : {}) || {}
  const existingQueue = Array.isArray(intel.outbound_queue)
    ? (intel.outbound_queue as Array<Record<string, unknown>>)
    : []
  intel.outbound_queue = [
    ...existingQueue,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      her_phone: match.her_phone,
      queued_at: now,
      status: 'pending',
    },
  ]
  delete (intel as any).suggested_replies
  delete (intel as any).suggestion_generated_at
  await (supabase as any)
    .from('clapcheeks_matches')
    .update({
      match_intel: intel,
      last_activity_at: now,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true, queued: true })
}
