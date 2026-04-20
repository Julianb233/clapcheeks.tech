import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import MatchProfileView from './match-profile-view'

export const metadata: Metadata = {
  title: 'Match Profile - Clapcheeks',
  description: 'Detailed match intel — zodiac, DISC, interests, and conversation strategy.',
}

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: profile, error } = await supabase
    .from('clapcheeks_match_profiles')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !profile) notFound()

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <MatchProfileView profile={profile} />
      </div>
    </div>
  )
}
