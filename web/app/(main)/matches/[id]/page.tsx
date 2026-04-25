import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import MatchProfileView from './match-profile-view'
import { ConversationPanel } from './ConversationPanel'

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

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <MatchProfileView match={match} />
        <div className="mt-8">
          <ConversationPanel
            matchId={match.id as string}
            matchName={(match.name || match.match_name || 'Match') as string}
            platform={(match.platform || 'imessage') as string}
            stage={(match.stage as string) ?? null}
          />
        </div>
      </div>
    </div>
  )
}
