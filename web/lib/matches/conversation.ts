/**
 * Unified cross-channel conversation fetcher (AI-8807)
 *
 * Merges messages from clapcheeks_conversations across all channels
 * (tinder, hinge, bumble, instagram, imessage) into a single sorted,
 * deduped list. Handles two storage shapes:
 *   1. Row has a `messages` JSONB array of { text, is_from_me, sent_at, ... }
 *   2. Row IS a single message with body/direction/sent_at columns
 */

// All possible channel labels emitted by the unified fetcher
export type MessageChannel =
  | 'tinder'
  | 'hinge'
  | 'bumble'
  | 'instagram'
  | 'imessage'
  | 'platform'  // legacy / unknown platform

export type UnifiedMessage = {
  id: string
  text: string
  is_from_me: boolean
  sent_at: string | null
  is_auto_sent?: boolean
  channel: MessageChannel
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

/**
 * Map a conversation row's channel + match platform to a typed MessageChannel.
 * If the conversation channel is 'imessage', always return 'imessage'.
 * Otherwise use the match's platform (tinder/hinge/bumble/instagram).
 */
function resolveChannel(
  rowChannel: string | null | undefined,
  matchPlatform: string | null | undefined,
): MessageChannel {
  if (rowChannel === 'imessage') return 'imessage'
  if (rowChannel === 'instagram') return 'instagram'
  const p = (matchPlatform ?? '').toLowerCase()
  if (p === 'tinder') return 'tinder'
  if (p === 'hinge') return 'hinge'
  if (p === 'bumble') return 'bumble'
  if (p === 'instagram') return 'instagram'
  // Platform messages from a match that has no specific platform mapping
  return 'platform'
}

function entryToMessage(
  entry: RawMessageEntry,
  fallbackId: string,
  channel: MessageChannel,
): UnifiedMessage {
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
    channel,
  }
}

/**
 * Fetch + normalize all conversation messages for a match across all channels.
 * @param supabase  Supabase client (server or browser)
 * @param matchId   The match's UUID (clapcheeks_matches.id)
 * @param userId    Auth user UUID
 * @param externalId  The match's external_id (used by clapcheeks_conversations)
 * @param matchPlatform  The match's platform ('tinder'|'hinge'|'bumble'|...)
 * @param herPhone  E.164 phone for imessage matches (AI-8926: used when externalId is null)
 * @returns Sorted, deduped list of up to 500 messages
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMatchConversationUnified(
  supabase: any,
  userId: string,
  externalId: string | null | undefined,
  matchPlatform?: string | null,
  herPhone?: string | null,
): Promise<UnifiedMessage[]> {
  // AI-8926: build candidate match_id list. iMessage matches are stored with
  // `match_id = imessage:<her_phone>` and have no external_id, so derive the
  // canonical id from her_phone when externalId is missing.
  const candidates: string[] = []
  if (externalId) {
    const canonicalId =
      matchPlatform && !externalId.includes(':')
        ? `${matchPlatform}:${externalId}`
        : externalId
    candidates.push(canonicalId)
    if (canonicalId !== externalId) candidates.push(externalId)
  }
  if (herPhone) {
    const phoneId = `imessage:${herPhone}`
    if (!candidates.includes(phoneId)) candidates.push(phoneId)
  }
  if (candidates.length === 0) return []

  const matchIdFilter = candidates.map((id) => `match_id.eq.${id}`).join(',')

  const { data, error } = await supabase
    .from('clapcheeks_conversations')
    .select('*')
    .eq('user_id', userId)
    .or(matchIdFilter)
    .order('last_message_at', { ascending: true, nullsFirst: true })

  if (error || !Array.isArray(data)) return []

  const out: UnifiedMessage[] = []
  const seen = new Set<string>()

  for (let r = 0; r < data.length; r++) {
    const row = data[r] as Record<string, unknown>
    const rowChannel = (row.channel as string | null | undefined) ?? null
    const channel = resolveChannel(rowChannel, matchPlatform)

    // Shape A: row has a `messages` JSONB array
    const msgs = row.messages
    if (Array.isArray(msgs)) {
      msgs.forEach((m, i) => {
        if (!m || typeof m !== 'object') return
        const msg = entryToMessage(m as RawMessageEntry, `${row.id}-${i}`, channel)
        if (!seen.has(msg.id)) {
          seen.add(msg.id)
          out.push(msg)
        }
      })
    }

    // Shape B: row IS a single message (body/direction/sent_at columns)
    if (typeof row.body === 'string' && row.body) {
      const rowId = String(row.id ?? `${r}-row`)
      if (!seen.has(rowId)) {
        seen.add(rowId)
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
              channel: rowChannel,
            },
            `${rowId}`,
            channel,
          ),
        )
      }
    }
  }

  // Sort chronologically; messages with no date go to front
  out.sort((a, b) => {
    const aT = a.sent_at ? new Date(a.sent_at).getTime() : 0
    const bT = b.sent_at ? new Date(b.sent_at).getTime() : 0
    return aT - bT
  })

  // Cap at 500 (most recent)
  return out.length > 500 ? out.slice(out.length - 500) : out
}
