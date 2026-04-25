import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/matches/[id]/cached-replies
 *
 * Reads pre-generated reply drafts from match_intel.suggested_replies.
 * These are produced by the Mac Mini local worker (mac_local_worker.py)
 * which runs Ollama llama3.1:8b every ~2 min and refreshes drafts the
 * moment a new inbound message arrives. So clicking "✨ Draft reply" is
 * instant, costs nothing, and the suggestions are always at most 2 min
 * stale relative to her latest message.
 */
export async function GET(
  _req: Request,
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

  const { data: match } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('id, user_id, match_intel')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!match) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }
  const intel =
    (match.match_intel && typeof match.match_intel === 'object'
      ? (match.match_intel as Record<string, unknown>)
      : {}) || {}
  const cached = Array.isArray(intel.suggested_replies)
    ? (intel.suggested_replies as Array<{
        text?: string
        model?: string
        generated_at?: string
      }>)
    : []
  return NextResponse.json({
    suggestions: cached
      .map((s) => ({
        text: s.text ?? '',
        model: s.model ?? 'unknown',
        generated_at: s.generated_at ?? null,
      }))
      .filter((s) => s.text),
    generated_at: intel.suggestion_generated_at ?? null,
  })
}
