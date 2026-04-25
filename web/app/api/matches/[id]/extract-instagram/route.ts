import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findHandleInMessages } from '@/lib/instagram-extractor'

// POST /api/matches/[id]/extract-instagram
// Walks the match's conversation, parses every inbound message for an
// Instagram handle, saves the highest-confidence one to the match's
// instagram_handle column (only if it's currently empty or lower
// confidence). Idempotent.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, match_id, instagram_handle, match_intel')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!match) return NextResponse.json({ error: 'match not found' }, { status: 404 })

  const { data: conv } = await (supabase as any)
    .from('clapcheeks_conversations')
    .select('messages')
    .eq('user_id', user.id)
    .eq('match_id', match.match_id)
    .maybeSingle()

  const found = findHandleInMessages(conv?.messages)
  if (!found) {
    return NextResponse.json({ ok: true, found: null, message: 'no handle in messages' })
  }

  // Don't overwrite if user manually set a handle (presence on the column,
  // even with low-confidence parser run later, means they typed it).
  // Only overwrite if our new find is higher confidence than the previous
  // parser-set value (tracked in match_intel.instagram_handle_confidence).
  const intel = (match.match_intel ?? {}) as Record<string, unknown>
  const prevConfidence = (intel.instagram_handle_confidence as number) ?? 0
  const wasManual = intel.instagram_handle_source === 'manual'

  if (wasManual && match.instagram_handle) {
    return NextResponse.json({
      ok: true,
      found,
      saved: false,
      reason: 'manual handle already set, not overwriting',
    })
  }
  if (match.instagram_handle === found.handle) {
    return NextResponse.json({ ok: true, found, saved: false, reason: 'already current' })
  }
  if (found.confidence < prevConfidence) {
    return NextResponse.json({ ok: true, found, saved: false, reason: 'lower confidence than current' })
  }

  await (supabase as any)
    .from('clapcheeks_matches')
    .update({
      instagram_handle: found.handle,
      instagram_fetched_at: new Date().toISOString(),
      match_intel: {
        ...intel,
        instagram_handle_source: 'message_parser',
        instagram_handle_confidence: found.confidence,
        instagram_handle_matched_text: found.matched_text,
      },
    })
    .eq('id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true, found, saved: true })
}
