import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateFollowupMessage,
  type FollowupKind,
} from '@/lib/followup/generate-content'
import { analyzeHerStyle, herStyleToPrompt } from '@/lib/followup/her-style'

/**
 * POST /api/scheduled-messages/[id]/regenerate
 *
 * Re-drafts the message for a scheduled row using current voice profile
 * + her per-match style + recent conversation history. Updates
 * message_text in place. Status stays where it was.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params

  const { data: row } = await (supabase as any)
    .from('clapcheeks_scheduled_messages')
    .select('id, match_id, match_name, platform, sequence_type, sequence_step')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: voice } = await (supabase as any)
    .from('clapcheeks_voice_profiles')
    .select('style_summary, sample_phrases, tone')
    .eq('user_id', user.id)
    .maybeSingle()

  let conversationHistory: Array<{ from?: string; text?: string }> = []
  let herStylePrompt: string | undefined
  if (row.match_id) {
    const { data: matchRow } = await (supabase as any)
      .from('clapcheeks_matches')
      .select('match_id')
      .eq('id', row.match_id)
      .maybeSingle()
    if (matchRow?.match_id) {
      const { data: conv } = await (supabase as any)
        .from('clapcheeks_conversations')
        .select('messages')
        .eq('user_id', user.id)
        .eq('match_id', matchRow.match_id)
        .maybeSingle()
      if (Array.isArray(conv?.messages)) {
        const all = conv.messages as Array<Record<string, unknown>>
        conversationHistory = all
          .slice(-10)
          .map((m) => ({
            from: (m.from ?? m.sender) as string | undefined,
            text: (m.text ?? m.body ?? m.content) as string | undefined,
          }))
          .filter((m) => m.text)
        const herStyle = analyzeHerStyle(all)
        herStylePrompt = herStyleToPrompt(herStyle, row.match_name) ?? undefined
      }
    }
  }

  const messageText = await generateFollowupMessage({
    kind: row.sequence_type as FollowupKind,
    matchName: row.match_name,
    platform: row.platform || 'iMessage',
    sequenceStep: row.sequence_step ?? 0,
    conversationHistory,
    voiceProfile: voice ?? undefined,
    herStylePrompt,
  })

  const { data: updated, error } = await (supabase as any)
    .from('clapcheeks_scheduled_messages')
    .update({ message_text: messageText })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    message: updated,
    her_style_used: !!herStylePrompt,
    history_size: conversationHistory.length,
  })
}
