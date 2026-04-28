import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MatchesPageClient from '@/components/matches/MatchesPageClient'
import type { MatchWithAttributes } from '@/lib/matches/attribute-filter'

export const metadata: Metadata = {
  title: 'Matches - Clapcheeks',
  description:
    'Every match across every platform, ranked and filterable by AI-extracted attributes — photos, bios, conversation strategy.',
}

export default async function MatchesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data, error } = await supabase
    .from('clapcheeks_matches')
    .select(
      'id, user_id, match_name, name, age, bio, platform, status, photos_jsonb, instagram_handle, zodiac, job, school, stage, health_score, final_score, julian_rank, match_intel, attributes, created_at, updated_at, last_activity_at'
    )
    .eq('user_id', user.id)
    .order('julian_rank', { ascending: false, nullsFirst: false })
    .order('final_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)

  const matches = (data ?? []) as unknown as MatchWithAttributes[]

  return <MatchesPageClient matches={matches} errorMessage={error?.message ?? null} />
}
