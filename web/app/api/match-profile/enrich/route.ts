import { NextRequest, NextResponse } from 'next/server'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { getConvexServerClient } from '@/lib/convex/server'
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

  // AI-9534 — Convex-backed read/write. profile_id may be a Convex doc id or
  // legacy Supabase UUID; resolveByAnyId handles both.
  const convex = getConvexServerClient()
  const profile = (await convex.query(api.matches.resolveByAnyId, {
    id: profile_id as string,
  })) as
    | (Record<string, unknown> & {
        _id?: Id<'matches'>
        user_id?: string
        match_intel?: Record<string, unknown> | null
        instagram_intel?: Record<string, unknown> | null
        bio?: string | null
        birth_date?: string | null
      })
    | null

  if (!profile || !profile._id || profile.user_id !== user.id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }
  const profileConvexId = profile._id

  const existingIntel: Record<string, unknown> = {
    ...((profile.match_intel ?? {}) as Record<string, unknown>),
  }
  const existingIgIntel: Record<string, unknown> = {
    ...((profile.instagram_intel ?? {}) as Record<string, unknown>),
  }

  // Mark as enriching (partial) before we start
  {
    const partialIntel = { ...existingIntel, enrichment_status: 'partial' }
    try {
      await convex.mutation(api.matches.patchByUser, {
        id: profileConvexId,
        user_id: user.id,
        match_intel: partialIntel,
      })
    } catch {
      // best-effort; the final write below is what matters
    }
  }

  // Working copies — we'll write them back as a single update at the end.
  const intel: Record<string, unknown> = { ...existingIntel }
  const directUpdates: Record<string, unknown> = {}

  try {
    // 1. Zodiac from birth_date (preferred) or bio text.
    const birthDate = profile.birth_date ?? null
    const bio = profile.bio ?? null
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

  try {
    await convex.mutation(api.matches.patchByUser, {
      id: profileConvexId,
      user_id: user.id,
      match_intel: intel,
      ...((directUpdates.zodiac !== undefined
        ? { zodiac: directUpdates.zodiac as string }
        : {}) as Record<string, unknown>),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'update failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, enrichment_status: intel.enrichment_status })
}
