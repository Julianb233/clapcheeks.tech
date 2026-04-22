import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signFromBirthday, signFromText, getCompatibility, TRAITS, ELEMENTS, MODALITIES, EMOJIS } from '@/lib/match-profile/zodiac'
import { buildDiscProfile } from '@/lib/match-profile/disc-profiler'
import { extractInterestsKeyword } from '@/lib/match-profile/interest-extractor'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { profile_id } = await request.json()
  if (!profile_id) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  // Fetch the profile
  const { data: profile, error: fetchError } = await supabase
    .from('clapcheeks_match_profiles')
    .select('*')
    .eq('id', profile_id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Mark as enriching
  await supabase
    .from('clapcheeks_match_profiles')
    .update({ enrichment_status: 'partial' })
    .eq('id', profile_id)

  const updates: Record<string, unknown> = {}

  try {
    // 1. Zodiac from birthday
    const zodiacResult = signFromBirthday(profile.birthday)
    if (zodiacResult) {
      updates.zodiac_sign = zodiacResult.sign
      updates.zodiac_element = zodiacResult.element
      updates.zodiac_modality = zodiacResult.modality
      updates.zodiac_cusp = zodiacResult.cusp
      updates.zodiac_traits = zodiacResult.traits
      updates.zodiac_emoji = zodiacResult.emoji
    } else if (profile.bio) {
      // Try to extract from bio text
      const signFromBio = signFromText(profile.bio)
      if (signFromBio) {
        updates.zodiac_sign = signFromBio
        updates.zodiac_element = ELEMENTS[signFromBio]
        updates.zodiac_modality = MODALITIES[signFromBio]
        updates.zodiac_traits = TRAITS[signFromBio]
        updates.zodiac_emoji = EMOJIS[signFromBio]
      }
    }

    // 2. Get user's zodiac for compatibility
    const { data: userSettings } = await supabase
      .from('clapcheeks_user_settings')
      .select('persona')
      .eq('user_id', user.id)
      .single()

    const userSign = (userSettings?.persona as Record<string, unknown>)?.zodiac_sign as string | undefined
    if (updates.zodiac_sign && userSign) {
      const zodiacSign = updates.zodiac_sign as string
      const compat = getCompatibility(
        zodiacSign as Parameters<typeof getCompatibility>[0],
        userSign as Parameters<typeof getCompatibility>[1],
      )
      updates.compat_score = compat.score
      updates.compat_level = compat.level
      updates.compat_desc = compat.description
      updates.compat_strengths = compat.strengths
      updates.compat_challenges = compat.challenges
    }

    // 3. Interest extraction (keyword mode — fast, no API call)
    const bioText = [profile.bio, profile.ig_bio].filter(Boolean).join(' ')
    if (bioText) {
      const extracted = extractInterestsKeyword(bioText)
      updates.interests = extracted.interests
      updates.interest_tags = extracted.tags
    }

    // 4. DISC profiling
    const disc = buildDiscProfile(
      bioText || null,
      (updates.interests as string[]) || [],
      (updates.zodiac_traits as string) || null,
    )
    updates.disc_type = disc.type
    updates.disc_label = disc.label
    updates.disc_scores = disc.scores
    updates.disc_strategy = disc.strategy
    updates.disc_openers = disc.openers
    updates.disc_topics = disc.topics
    updates.disc_avoid = disc.avoid

    // 5. Composite conversation strategy
    const strategyParts: string[] = []
    if (updates.zodiac_traits) strategyParts.push(`Zodiac: ${updates.zodiac_traits}`)
    if (disc.strategy) strategyParts.push(`DISC: ${disc.strategy}`)
    updates.conversation_strategy = strategyParts.join('\n\n')
    updates.opener_suggestions = disc.openers
    updates.topic_suggestions = disc.topics

    // Mark complete
    updates.enrichment_status = 'complete'
    updates.enriched_at = new Date().toISOString()
  } catch (err) {
    updates.enrichment_status = 'failed'
    updates.enrichment_error = err instanceof Error ? err.message : 'Unknown error'
  }

  const { error: updateError } = await supabase
    .from('clapcheeks_match_profiles')
    .update(updates)
    .eq('id', profile_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, enrichment_status: updates.enrichment_status })
}
