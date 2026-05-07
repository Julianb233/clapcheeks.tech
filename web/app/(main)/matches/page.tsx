import type { Metadata } from 'next'
import { ConvexHttpClient } from 'convex/browser'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MatchesPageClient from '@/components/matches/MatchesPageClient'
import { api } from '@/convex/_generated/api'
import type { MatchWithAttributes } from '@/lib/matches/attribute-filter'
import { getFleetUserId } from '@/lib/fleet-user'

export const metadata: Metadata = {
  title: 'Matches - Clapcheeks',
  description:
    'Every match across every platform, ranked and filterable by AI-extracted attributes — photos, bios, conversation strategy.',
}

// AI-9526 — Matches data now lives on Convex. Auth still on Supabase.
//
// During the migration window the Supabase column shape is preserved as a
// rollback safety net; we read from Convex first and only show an empty
// state if the user truly has no matches there. Photos render from
// `_storage` via getPhotoUrl OR direct `url` (legacy Supabase Storage URLs
// are kept on each photo as `url` until the next cleanup PR).
export default async function MatchesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!convexUrl) {
    return (
      <MatchesPageClient
        matches={[]}
        errorMessage="NEXT_PUBLIC_CONVEX_URL not set on server."
      />
    )
  }

  let matches: MatchWithAttributes[] = []
  let errorMessage: string | null = null
  try {
    const convex = new ConvexHttpClient(convexUrl)
    const rows = await convex.query(api.matches.listForUser, {
      user_id: getFleetUserId(),
      limit: 200,
    })
    matches = mapConvexRowsToMatchWithAttributes(rows)
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
  }

  return <MatchesPageClient matches={matches} errorMessage={errorMessage} />
}

// Convex stores `external_match_id` and `created_at` as a number (ms);
// the legacy ClapcheeksMatchRow shape (and the components that consume it)
// expect ISO strings + an `id` string. Map the Convex doc into the legacy
// shape so MatchesPageClient + child components stay untouched.
function mapConvexRowsToMatchWithAttributes(
  rows: Awaited<ReturnType<ConvexHttpClient['query']>>,
): MatchWithAttributes[] {
  if (!Array.isArray(rows)) return []
  return rows.map((r) => {
    const platform = (r.platform ?? 'tinder') as MatchWithAttributes['platform']
    return {
      id: (r.supabase_match_id ?? r._id) as string,
      user_id: r.user_id,
      platform,
      external_id: r.external_match_id ?? null,
      name: r.name ?? null,
      age: r.age ?? null,
      bio: r.bio ?? null,
      photos_jsonb: Array.isArray(r.photos)
        ? r.photos.map((p: Record<string, unknown>) => ({
            url: typeof p.url === 'string' ? p.url : '',
            supabase_path:
              typeof p.supabase_path === 'string' ? p.supabase_path : null,
            width: typeof p.width === 'number' ? p.width : null,
            height: typeof p.height === 'number' ? p.height : null,
          }))
        : null,
      prompts_jsonb: null,
      job: r.job ?? null,
      school: r.school ?? null,
      instagram_handle: r.instagram_handle ?? null,
      spotify_artists: null,
      birth_date: null,
      zodiac: r.zodiac ?? null,
      match_intel: r.match_intel ?? null,
      vision_summary: null,
      instagram_intel: null,
      status: (r.status ?? 'new') as MatchWithAttributes['status'],
      last_activity_at: numberToIso(r.last_activity_at),
      created_at: numberToIso(r.created_at) ?? new Date().toISOString(),
      updated_at: numberToIso(r.updated_at) ?? new Date().toISOString(),
      final_score: typeof r.final_score === 'number' ? r.final_score : null,
      location_score: null,
      criteria_score: null,
      scoring_reason: null,
      julian_rank: typeof r.julian_rank === 'number' ? r.julian_rank : null,
      stage: r.stage ?? null,
      health_score:
        typeof r.health_score === 'number' ? r.health_score : null,
      attributes: r.attributes ?? null,
    } as MatchWithAttributes
  })
}

function numberToIso(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return new Date(n).toISOString()
}
