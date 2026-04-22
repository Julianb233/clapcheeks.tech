import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseExtractionResult, profileToAnalysisText } from '@/lib/match-profile/instagram-scraper'
import { extractInterestsKeyword } from '@/lib/match-profile/interest-extractor'

/**
 * POST /api/match-profile/scrape-instagram
 * Scrapes an Instagram profile via Browserbase and updates the match profile.
 *
 * NOTE: Actual Browserbase calls would be done server-side via the MCP tools
 * or a dedicated scraping service. This route handles the data processing
 * after extraction is complete.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { profile_id, extraction_result } = await request.json()
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

  if (!profile.ig_handle) {
    return NextResponse.json({ error: 'No Instagram handle on this profile' }, { status: 400 })
  }

  // If extraction_result is provided (from an external scrape), process it
  if (extraction_result) {
    const parsed = parseExtractionResult(extraction_result, profile.ig_handle)
    const analysisText = profileToAnalysisText(parsed)

    // Extract interests from IG content
    const allText = [profile.bio, analysisText].filter(Boolean).join(' ')
    const extracted = extractInterestsKeyword(allText)

    const { error: updateError } = await supabase
      .from('clapcheeks_match_profiles')
      .update({
        ig_bio: parsed.bio,
        ig_follower_count: parsed.followerCount,
        ig_following_count: parsed.followingCount,
        ig_post_count: parsed.postCount,
        ig_recent_captions: parsed.recentCaptions,
        ig_scraped_at: parsed.scrapedAt,
        interests: extracted.interests,
        interest_tags: extracted.tags,
      })
      .eq('id', profile_id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, profile: parsed })
  }

  // If no extraction_result, return scrape instructions for the client
  // (Browserbase scraping happens via MCP tools, not HTTP)
  return NextResponse.json({
    message: 'Use Browserbase MCP tools to scrape, then POST the result back here',
    ig_handle: profile.ig_handle,
    ig_url: `https://www.instagram.com/${profile.ig_handle.replace(/^@/, '')}/`,
  })
}
