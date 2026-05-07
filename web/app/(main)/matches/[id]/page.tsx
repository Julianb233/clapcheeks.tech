import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import MatchProfileView from './match-profile-view'
import { getMatchConversationUnified } from '@/lib/matches/conversation'
import { mapConvexMatchRowToLegacy } from '@/lib/matches/convex-mapper'
import type { ChatMessage } from './conversation-thread'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9534/AI-9537: matches and memos on Convex.

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

  // AI-9534 — read from Convex. The URL `[id]` may be either a Convex doc id
  // (new matches) or the legacy Supabase UUID (existing tabs / bookmarks).
  // resolveByAnyId handles both. We also enforce ownership against the auth'd
  // Supabase user_id.
  const convex = getConvexServerClient()
  const rawMatch = (await convex.query(api.matches.resolveByAnyId, { id })) as
    | (Record<string, unknown> & { user_id?: string })
    | null
  if (!rawMatch || rawMatch.user_id !== user.id) notFound()

  // The MatchProfileView expects a wider shape than the shared legacy mapper
  // produces (it has its own MatchRow type with first_impression, attributes,
  // etc.). Build it inline from the raw Convex doc — every field is optional
  // on Convex so all unknowns become nulls.
  const legacy = mapConvexMatchRowToLegacy(rawMatch)
  const match = {
    id: legacy.id,
    match_name:
      typeof rawMatch.match_name === 'string' ? rawMatch.match_name : null,
    name: legacy.name,
    age: legacy.age,
    bio: legacy.bio,
    platform: legacy.platform as string | null,
    photos_jsonb: legacy.photos_jsonb
      ? legacy.photos_jsonb.map((p) => ({
          url: p.url,
          supabase_path: p.supabase_path,
          width: typeof p.width === 'number' ? p.width : undefined,
          height: typeof p.height === 'number' ? p.height : undefined,
        }))
      : null,
    prompts_jsonb: legacy.prompts_jsonb,
    instagram_handle: legacy.instagram_handle,
    spotify_artists: legacy.spotify_artists,
    zodiac: legacy.zodiac,
    job: legacy.job,
    school: legacy.school,
    stage: (legacy.stage as string | null) ?? null,
    status: (legacy.status as string | null) ?? null,
    health_score: legacy.health_score ?? null,
    julian_rank: legacy.julian_rank,
    first_impression:
      typeof rawMatch.first_impression === 'string'
        ? rawMatch.first_impression
        : null,
    vision_summary: legacy.vision_summary,
    match_intel: legacy.match_intel,
    instagram_intel: (legacy.instagram_intel as Record<string, unknown> | null) ?? null,
    distance_miles: null as number | null,
    final_score: legacy.final_score,
    dealbreaker_flags: null as string[] | null,
    red_flags: null as string[] | null,
    opener_sent_at:
      typeof rawMatch.opener_sent_at === 'string'
        ? rawMatch.opener_sent_at
        : null,
    created_at: legacy.created_at ?? null,
    attributes:
      (rawMatch.attributes as Record<string, unknown> | null | undefined) ?? null,
    attributes_updated_at:
      typeof rawMatch.attributes_updated_at === 'string'
        ? rawMatch.attributes_updated_at
        : null,
  }
  const externalId = legacy.external_id
  const herPhone =
    typeof rawMatch.her_phone === 'string' ? rawMatch.her_phone : null
  const platform: string | null = legacy.platform ?? null

  // Memo handle prefers E.164 phone, falls back to platform:external_id.
  let memoHandle: string | null = null
  if (herPhone) memoHandle = herPhone
  else if (externalId) memoHandle = platform ? `${platform}:${externalId}` : externalId

  // Canonical match_id for realtime subscription.
  // AI-8876 produced this for tinder/hinge/bumble (uses external_id).
  // AI-8926 extends it to imessage matches, which have no external_id but do
  // have her_phone — those rows live under `imessage:<her_phone>`.
  let conversationMatchId: string | null = null
  if (externalId) {
    conversationMatchId =
      platform && !externalId.includes(':')
        ? `${platform}:${externalId}`
        : externalId
  } else if (herPhone) {
    conversationMatchId = `imessage:${herPhone}`
  }

  // Unified cross-channel conversation fetch (AI-8807, AI-8926).
  // herPhone is the fallback when externalId is null (iMessage matches).
  const unifiedMessages = await getMatchConversationUnified(
    supabase as any,
    user.id,
    externalId,
    platform,
    herPhone,
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

  // AI-8876: fetch reactions JSONB from the conversation row (best-effort)
  type ReactionEntry = { msg_guid?: string; kind?: string; actor?: string; ts?: string }
  let conversationReactions: ReactionEntry[] | null = null
  if (conversationMatchId) {
    try {
      const { data: convRow } = await (supabase as any)
        .from('clapcheeks_conversations')
        .select('reactions')
        .eq('user_id', user.id)
        .eq('match_id', conversationMatchId)
        .maybeSingle()
      if (convRow?.reactions && Array.isArray(convRow.reactions)) {
        conversationReactions = convRow.reactions as ReactionEntry[]
      }
    } catch {
      // non-fatal — reactions are optional
    }
  }

  // Server-side initial memo fetch (best-effort; client refetches if needed).
  let memoInitial: { content: string; updated_at: string | null } | null = null
  if (memoHandle) {
    try {
      const convex = getConvexServerClient()
      const memoRow = await convex.query(api.memos.getForContact, {
        user_id: user.id,
        contact_handle: memoHandle,
      })
      memoInitial = memoRow
        ? {
            content: memoRow.content ?? '',
            updated_at: memoRow.updated_at
              ? new Date(memoRow.updated_at).toISOString()
              : null,
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
          conversationMatchId={conversationMatchId}
          conversationReactions={conversationReactions}
          memoHandle={memoHandle}
          memoInitial={memoInitial}
        />
      </div>
    </div>
  )
}
