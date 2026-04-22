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
 *
 * Storage model:
 *   - instagram_handle is a real column on clapcheeks_matches
 *   - instagram_fetched_at is the "last scraped" column
 *   - Everything else (bio, follower_count, following_count, post_count,
 *     recent_captions) folds into the `instagram_intel` JSONB blob.
 *   - interests / interest_tags fold into the `match_intel` JSONB blob.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { profile_id, extraction_result } = await request.json()
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

  const instagramHandle = (profile as any).instagram_handle as string | null
  if (!instagramHandle) {
    return NextResponse.json({ error: 'No Instagram handle on this profile' }, { status: 400 })
  }

  // If extraction_result is provided (from an external scrape), process it
  if (extraction_result) {
    const parsed = parseExtractionResult(extraction_result, instagramHandle)
    const analysisText = profileToAnalysisText(parsed)

    // Extract interests from IG content
    const bio = (profile as any).bio as string | null
    const allText = [bio, analysisText].filter(Boolean).join(' ')
    const extracted = extractInterestsKeyword(allText)

    const existingIgIntel: Record<string, unknown> = {
      ...((profile as any).instagram_intel ?? {}),
    }
    const existingMatchIntel: Record<string, unknown> = {
      ...((profile as any).match_intel ?? {}),
    }

    const nextIgIntel: Record<string, unknown> = {
      ...existingIgIntel,
      bio: parsed.bio,
      follower_count: parsed.followerCount,
      following_count: parsed.followingCount,
      post_count: parsed.postCount,
      recent_captions: parsed.recentCaptions,
      scraped_at: parsed.scrapedAt,
    }

    const nextMatchIntel: Record<string, unknown> = {
      ...existingMatchIntel,
      interests: extracted.interests,
      interest_tags: extracted.tags,
    }

    const { error: updateError } = await (supabase as any)
      .from('clapcheeks_matches')
      .update({
        instagram_intel: nextIgIntel,
        match_intel: nextMatchIntel,
        instagram_fetched_at: parsed.scrapedAt,
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
    ig_handle: instagramHandle,
    ig_url: `https://www.instagram.com/${instagramHandle.replace(/^@/, '')}/`,
  })
}
