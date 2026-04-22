import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signFromBirthday, signFromText, getCompatibility, TRAITS, ELEMENTS, MODALITIES, EMOJIS } from '@/lib/match-profile/zodiac'
import { buildDiscProfile } from '@/lib/match-profile/disc-profiler'
import { extractInterestsKeyword } from '@/lib/match-profile/interest-extractor'

/**
 * POST /api/match-profile/enrich
 *
 * Enriches an existing clapcheeks_matches row with:
 *   - Zodiac (only `zodiac` text goes into its column; the rest folds
 *     into match_intel.zodiac; full detail is ALSO computable at read-time
 *     from the birth_date column, so we do not duplicate-store).
 *   - Compatibility vs. user's own sign (match_intel.compat)
 *   - Keyword interests (match_intel.interests / interest_tags)
 *   - DISC profile (match_intel.disc)
 *   - Composite conversation strategy (match_intel.strategy/openers/topics)
 *
 * Status is tracked inside match_intel (enrichment_status / enrichment_error
 * / enriched_at) — there are no top-level columns for these.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { profile_id } = await request.json()
  if (!profile_id) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  // Fetch the profile
  const { data: profile, error: fetchError } = await supabase
    .from('clapcheeks_matches')
    .select('*')
    .eq('id', profile_id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const existingIntel: Record<string, unknown> = {
    ...((profile as any).match_intel ?? {}),
  }
  const existingIgIntel: Record<string, unknown> = {
    ...((profile as any).instagram_intel ?? {}),
  }

  // Mark as enriching (partial) before we start
  {
    const partialIntel = { ...existingIntel, enrichment_status: 'partial' }
    await (supabase as any)
      .from('clapcheeks_matches')
      .update({ match_intel: partialIntel })
      .eq('id', profile_id)
  }

  // Working copies — we'll write them back as a single update at the end.
  const intel: Record<string, unknown> = { ...existingIntel }
  const directUpdates: Record<string, unknown> = {}

  try {
    // 1. Zodiac from birth_date (preferred) or bio text.
    const birthDate = (profile as any).birth_date as string | null
    const bio = (profile as any).bio as string | null
    const igBio = (existingIgIntel.bio as string | undefined) ?? null

    let zodiacDetail: {
      sign: string
      element: string
      modality: string
      cusp: string | null
      traits: string
      emoji: string
    } | null = null

    const z = signFromBirthday(birthDate)
    if (z) {
      zodiacDetail = {
        sign: z.sign,
        element: z.element,
        modality: z.modality,
        cusp: z.cusp,
        traits: z.traits,
        emoji: z.emoji,
      }
    } else {
      const textSource = [bio, igBio].filter(Boolean).join(' ')
      if (textSource) {
        const sign = signFromText(textSource)
        if (sign) {
          zodiacDetail = {
            sign,
            element: ELEMENTS[sign],
            modality: MODALITIES[sign],
            cusp: null,
            traits: TRAITS[sign],
            emoji: EMOJIS[sign],
          }
        }
      }
    }

    if (zodiacDetail) {
      // Direct column — only stores the sign name.
      directUpdates.zodiac = zodiacDetail.sign
      // Extras live under match_intel.zodiac so we don't lose them.
      intel.zodiac = zodiacDetail
    }

    // 2. Get user's zodiac for compatibility
    const { data: userSettings } = await (supabase as any)
      .from('clapcheeks_user_settings')
      .select('persona')
      .eq('user_id', user.id)
      .single()

    const userSign = (userSettings?.persona as Record<string, unknown> | undefined)?.zodiac_sign as string | undefined
    if (zodiacDetail?.sign && userSign) {
      const compat = getCompatibility(
        zodiacDetail.sign as Parameters<typeof getCompatibility>[0],
        userSign as Parameters<typeof getCompatibility>[1],
      )
      intel.compat = {
        score: compat.score,
        level: compat.level,
        description: compat.description,
        strengths: compat.strengths,
        challenges: compat.challenges,
      }
    }

    // 3. Interest extraction (keyword mode — fast, no API call)
    const bioText = [bio, igBio].filter(Boolean).join(' ')
    let extractedInterests: string[] = []
    let extractedTags: string[] = []
    if (bioText) {
      const extracted = extractInterestsKeyword(bioText)
      extractedInterests = extracted.interests
      extractedTags = extracted.tags
      intel.interests = extractedInterests
      intel.interest_tags = extractedTags
    }

    // 4. DISC profiling
    const disc = buildDiscProfile(
      bioText || null,
      extractedInterests,
      zodiacDetail?.traits ?? null,
    )
    intel.disc = {
      type: disc.type,
      label: disc.label,
      scores: disc.scores,
      strategy: disc.strategy,
      openers: disc.openers,
      topics: disc.topics,
      avoid: disc.avoid,
    }

    // 5. Composite conversation strategy
    const strategyParts: string[] = []
    if (zodiacDetail?.traits) strategyParts.push(`Zodiac: ${zodiacDetail.traits}`)
    if (disc.strategy) strategyParts.push(`DISC: ${disc.strategy}`)
    intel.strategy = strategyParts.join('\n\n')
    intel.openers = disc.openers
    intel.topics = disc.topics

    // Mark complete
    intel.enrichment_status = 'complete'
    intel.enriched_at = new Date().toISOString()
    delete intel.enrichment_error
  } catch (err) {
    intel.enrichment_status = 'failed'
    intel.enrichment_error = err instanceof Error ? err.message : 'Unknown error'
  }

  const { error: updateError } = await (supabase as any)
    .from('clapcheeks_matches')
    .update({ ...directUpdates, match_intel: intel })
    .eq('id', profile_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, enrichment_status: intel.enrichment_status })
}
