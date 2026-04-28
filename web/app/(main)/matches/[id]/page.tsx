import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import MatchProfileView from './match-profile-view'
import { getMatchConversationUnified } from '@/lib/matches/conversation'
import type { ChatMessage } from './conversation-thread'

export const metadata: Metadata = {
  title: 'Match Profile - Clapcheeks',
  description: 'Photos, bio, interests, and conversation strategy.',
}

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: match, error } = await (supabase as any)
    .from('clapcheeks_matches')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !match) notFound()

  const externalId =
    (match as { external_id?: string | null }).external_id ?? null
  const herPhone = (match as { her_phone?: string | null }).her_phone ?? null
  const platform = (match as { platform?: string | null }).platform ?? null

  // Memo handle prefers E.164 phone, falls back to platform:external_id.
  let memoHandle: string | null = null
  if (herPhone) memoHandle = herPhone
  else if (externalId) memoHandle = platform ? `${platform}:${externalId}` : externalId

  // Unified cross-channel conversation fetch (AI-8807)
  const unifiedMessages = await getMatchConversationUnified(
    supabase as any,
    user.id,
    externalId,
    platform,
  )

  // Map UnifiedMessage -> ChatMessage (compatible type)
  const conversation: ChatMessage[] = unifiedMessages.map((m) => ({
    id: m.id,
    text: m.text,
    is_from_me: m.is_from_me,
    sent_at: m.sent_at,
    is_auto_sent: m.is_auto_sent,
    channel: m.channel,
  }))

  // Server-side initial memo fetch (best-effort; client refetches if needed).
  let memoInitial: { content: string; updated_at: string | null } | null = null
  if (memoHandle) {
    try {
      const { data: memoRow } = await (supabase as any)
        .from('clapcheeks_memos')
        .select('content, updated_at')
        .eq('user_id', user.id)
        .eq('contact_handle', memoHandle)
        .maybeSingle()
      memoInitial = memoRow
        ? {
            content: (memoRow.content as string) ?? '',
            updated_at: (memoRow.updated_at as string | null) ?? null,
          }
        : { content: '', updated_at: null }
    } catch {
      memoInitial = null
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <MatchProfileView
          match={match}
          conversation={conversation}
          memoHandle={memoHandle}
          memoInitial={memoInitial}
        />
      </div>
    </div>
  )
}
