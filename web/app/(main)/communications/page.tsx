import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/convex/server'
import { getClapCheeksUserSettings } from '@/lib/clapcheeks/user-settings'
import CommunicationsConsole, {
  type CommunicationMessage,
  type CommunicationThread,
} from './communications-console'

export const metadata: Metadata = {
  title: 'Communications — Clapcheeks',
  description: 'Unified Hinge, Tinder, and Instagram inbox for the dating operator.',
}

const TARGET_PLATFORMS = new Set(['hinge', 'tinder', 'instagram'])

type ConversationRow = Record<string, any>

function normalizePlatform(value: unknown) {
  const platform = String(value || '').trim().toLowerCase()
  if (platform === 'ig') return 'instagram'
  return platform
}

function normalizeTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return null
}

function normalizeMessages(row: ConversationRow): CommunicationMessage[] {
  const rawMessages = Array.isArray(row.messages)
    ? row.messages
    : Array.isArray(row.messages_jsonb)
      ? row.messages_jsonb
      : []

  const messages = rawMessages
    .map((message: Record<string, any>, index: number): CommunicationMessage | null => {
      const text = String(
        message.text ??
        message.body ??
        message.message ??
        message.content ??
        '',
      ).trim()
      if (!text) return null
      const direction = String(message.direction || '').toLowerCase()
      const isFromMe =
        message.is_from_me === true ||
        message.from_me === true ||
        direction === 'outbound' ||
        direction === 'sent'
      return {
        id: String(message.id || message._id || `${row.id || row._id || 'message'}-${index}`),
        text,
        is_from_me: isFromMe,
        sent_at: normalizeTime(message.sent_at || message.created_at || message.timestamp || message.date),
        is_auto_sent: Boolean(message.is_auto_sent || message.auto_sent),
      }
    })
    .filter((message: CommunicationMessage | null): message is CommunicationMessage => Boolean(message))

  const rowText = String(row.last_message || row.body || row.text || '').trim()
  if (messages.length === 0 && rowText) {
    messages.push({
      id: String(row.id || row._id || `${row.platform || 'thread'}-last`),
      text: rowText,
      is_from_me: Boolean(row.is_from_me || row.direction === 'outbound'),
      sent_at: normalizeTime(row.last_message_at || row.created_at || row._creationTime),
      is_auto_sent: Boolean(row.is_auto_sent),
    })
  }

  return messages.sort((a, b) => {
    const aTime = a.sent_at ? new Date(a.sent_at).getTime() : 0
    const bTime = b.sent_at ? new Date(b.sent_at).getTime() : 0
    return aTime - bTime
  })
}

function normalizeThread(row: ConversationRow): CommunicationThread | null {
  const platform = normalizePlatform(row.platform || row.channel || row.inbound_channel)
  if (!TARGET_PLATFORMS.has(platform)) return null
  const messages = normalizeMessages(row)
  const lastMessage =
    String(row.last_message || '').trim() ||
    messages[messages.length - 1]?.text ||
    null
  const lastMessageAt =
    normalizeTime(row.last_message_at || row.updated_at || row.created_at || row._creationTime) ||
    messages[messages.length - 1]?.sent_at ||
    null
  return {
    id: String(row.id || row._id || `${platform}:${row.match_id || row.external_id || row.match_name || lastMessage || 'thread'}`),
    match_id: row.match_id ? String(row.match_id) : null,
    match_name: String(row.match_name || row.name || row.sender_name || row.handle || 'Unknown'),
    platform,
    last_message: lastMessage,
    last_message_at: lastMessageAt,
    messages,
  }
}

function isDisplayableCommunicationThread(thread: CommunicationThread): boolean {
  const name = thread.match_name.trim().toLowerCase()
  const hasMessage = Boolean(thread.last_message?.trim()) || thread.messages.length > 0
  const isGenericTransportName =
    !name ||
    name === 'unknown' ||
    name === 'hinge chat' ||
    name === 'group channel'

  return hasMessage || !isGenericTransportName
}

function sortThreads(a: CommunicationThread, b: CommunicationThread) {
  const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
  const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
  return bTime - aTime
}

function configFromSettings(row: Record<string, any> | null) {
  const approveReplies = row?.approve_replies !== undefined ? Boolean(row.approve_replies) : true
  return {
    auto_respond_enabled: !approveReplies,
    approve_replies: approveReplies,
    ai_active: row?.ai_active ?? null,
  }
}

export default async function CommunicationsPage() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()
  if (!user) redirect('/auth/login')

  const [conversationRes, settingsRes] = await Promise.all([
    convex
      .from('clapcheeks_conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('last_message_at', { ascending: false })
      .limit(500),
    getClapCheeksUserSettings().catch((error) => ({ row: null, error })),
  ])

  const rows = Array.isArray(conversationRes.data) ? conversationRes.data : []
  const threads = rows
    .map(normalizeThread)
    .filter((thread): thread is CommunicationThread => Boolean(thread))
    .filter(isDisplayableCommunicationThread)
    .sort(sortThreads)

  return (
    <CommunicationsConsole
      initialThreads={threads}
      initialConfig={configFromSettings(settingsRes.row)}
    />
  )
}
