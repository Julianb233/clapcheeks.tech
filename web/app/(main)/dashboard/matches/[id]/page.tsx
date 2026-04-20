import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MatchDetail from '@/components/matches/MatchDetail'
import {
  ClapcheeksMatchRow,
  ConversationMessage,
} from '@/lib/matches/types'

export const metadata: Metadata = {
  title: 'Match Detail — Clapcheeks',
}

type RouteParams = { id: string }

// Loose raw-message shape from clapcheeks_conversations.messages JSON.
type RawMsg = {
  id?: string
  direction?: 'incoming' | 'outgoing'
  from?: 'her' | 'you' | 'me' | string
  body?: string
  text?: string
  message?: string
  sent_at?: string
  created_at?: string
  timestamp?: string
}

function normalizeMessage(m: RawMsg, fallbackIndex: number): ConversationMessage {
  const dir: 'incoming' | 'outgoing' =
    m.direction === 'outgoing' || m.from === 'you' || m.from === 'me'
      ? 'outgoing'
      : 'incoming'
  return {
    id: m.id ?? `msg-${fallbackIndex}`,
    direction: dir,
    body: m.body ?? m.text ?? m.message ?? '',
    sent_at: m.sent_at ?? m.created_at ?? m.timestamp ?? new Date().toISOString(),
  }
}

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<RouteParams>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let match: ClapcheeksMatchRow | null = null
  let fetchError: string | null = null
  try {
    const { data, error } = await (supabase as any)
      .from('clapcheeks_matches')
      .select('*')
      .eq('user_id', user.id)
      .eq('id', id)
      .maybeSingle()
    if (error) fetchError = error.message
    match = (data as ClapcheeksMatchRow) ?? null
  } catch (e) {
    fetchError = (e as Error).message
  }

  if (!match) {
    if (fetchError) {
      return (
        <div className="min-h-screen bg-black text-white px-6 py-10">
          <div className="max-w-2xl mx-auto bg-amber-500/10 border border-amber-500/30 rounded-lg p-5 text-sm text-amber-200 font-mono">
            Could not load match {id}. Error: {fetchError}. The clapcheeks_matches table may not exist yet — Phase A (AI-8315) owns its migration.
          </div>
        </div>
      )
    }
    notFound()
  }

  // Pull conversation messages if clapcheeks_conversations has a row for this match.
  let messages: ConversationMessage[] = []
  try {
    if (match.external_id) {
      const { data: conv } = await supabase
        .from('clapcheeks_conversations')
        .select('messages')
        .eq('user_id', user.id)
        .eq('match_id', match.external_id)
        .maybeSingle()
      const raw: RawMsg[] = Array.isArray(conv?.messages) ? (conv!.messages as RawMsg[]) : []
      messages = raw.map(normalizeMessage)
    }
  } catch {
    // optional — detail still renders without convo
  }

  // Cluster-risk detection is owned by the scoring engine — here we just surface
  // it if match_intel.cluster_risk is set by upstream.
  const clusterRisk =
    typeof (match.match_intel as Record<string, unknown> | null)?.['cluster_risk'] === 'boolean'
      ? Boolean((match.match_intel as Record<string, unknown>)['cluster_risk'])
      : false

  return <MatchDetail match={match} messages={messages} clusterRisk={clusterRisk} />
}
