import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import MatchProfileView from './match-profile-view'
import type { ChatMessage } from './conversation-thread'

export const metadata: Metadata = {
  title: 'Match Profile - Clapcheeks',
  description: 'Photos, bio, interests, and conversation strategy.',
}

type RawMessageEntry = {
  id?: string | number
  text?: string | null
  body?: string | null
  message?: string | null
  is_from_me?: boolean | number | null
  from_me?: boolean | number | null
  direction?: string | null
  sender?: string | null
  sent_at?: string | null
  date?: string | null
  created_at?: string | null
  is_auto_sent?: boolean | null
  is_auto?: boolean | null
  is_bot?: boolean | null
  channel?: string | null
}

function coerceBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return ['1', 'true', 'yes', 'me'].includes(v.toLowerCase())
  return false
}

function entryToMessage(
  entry: RawMessageEntry,
  fallbackId: string,
  rowChannel?: string | null,
): ChatMessage {
  const text = entry.text ?? entry.body ?? entry.message ?? ''
  let isFromMe: boolean
  if (entry.is_from_me != null) {
    isFromMe = coerceBool(entry.is_from_me)
  } else if (entry.from_me != null) {
    isFromMe = coerceBool(entry.from_me)
  } else if (entry.direction) {
    isFromMe = entry.direction === 'outgoing' || entry.direction === 'out'
  } else if (entry.sender) {
    const s = entry.sender.toLowerCase()
    isFromMe = s === 'me' || s === 'self' || s === 'julian' || s === 'operator'
  } else {
    isFromMe = false
  }
  const sentAt = entry.sent_at ?? entry.date ?? entry.created_at ?? null
  return {
    id: String(entry.id ?? fallbackId),
    text: typeof text === 'string' ? text : '',
    is_from_me: isFromMe,
    sent_at: sentAt,
    is_auto_sent: coerceBool(entry.is_auto_sent ?? entry.is_auto ?? entry.is_bot),
    channel: entry.channel ?? rowChannel ?? null,
  }
}

async function loadConversationMessages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  externalId: string | null | undefined,
): Promise<ChatMessage[]> {
  if (!externalId) return []
  // Pull every conversation row for this match — there may be one per
  // platform/channel (tinder + imessage etc).
  const { data, error } = await (supabase as any)
    .from('clapcheeks_conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('match_id', externalId)
    .order('last_message_at', { ascending: true, nullsFirst: true })
  if (error || !Array.isArray(data)) return []

  const out: ChatMessage[] = []
  for (let r = 0; r < data.length; r++) {
    const row = data[r] as Record<string, unknown>
    const channel = (row.channel as string | null | undefined) ?? null

    // Shape A: row has a `messages` JSONB array of entries.
    const msgs = row.messages
    if (Array.isArray(msgs)) {
      msgs.forEach((m, i) => {
        if (!m || typeof m !== 'object') return
        out.push(entryToMessage(m as RawMessageEntry, `${row.id}-${i}`, channel))
      })
    }

    // Shape B: row IS a single message (body/direction/sent_at columns).
    if (typeof row.body === 'string' && row.body) {
      out.push(
        entryToMessage(
          {
            id: row.id as string | undefined,
            text: row.body as string,
            direction: row.direction as string | null | undefined,
            sent_at:
              (row.sent_at as string | null | undefined) ??
              (row.last_message_at as string | null | undefined) ??
              (row.created_at as string | null | undefined) ??
              null,
            channel,
          },
          `${row.id ?? r}-row`,
          channel,
        ),
      )
    }
  }
  return out
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

  const conversation = await loadConversationMessages(
    supabase,
    user.id,
    externalId,
  )

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
