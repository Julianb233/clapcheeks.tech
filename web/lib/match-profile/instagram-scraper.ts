/**
 * Instagram profile scraper via Browserbase Stagehand.
 * Extracts bio, follower counts, and recent post captions.
 */

export interface InstagramProfile {
  username: string
  bio: string | null
  followerCount: number | null
  followingCount: number | null
  postCount: number | null
  recentCaptions: string[]
  scrapedAt: string
}

export interface ScrapeStep {
  action: 'navigate' | 'extract' | 'observe'
  url?: string
  instruction?: string
  schema?: Record<string, unknown>
}

export function buildInstagramScrapeSteps(handle: string): ScrapeStep[] {
  const cleanHandle = handle.replace(/^@/, '').trim()
  return [
    {
      action: 'navigate',
      url: `https://www.instagram.com/${cleanHandle}/`,
    },
    {
      action: 'extract',
      instruction: `Extract this Instagram profile information:
- Username
- Bio text (the text below the name)
- Number of posts
- Number of followers
- Number of following
- The captions/text of the most recent 3-6 visible posts (if available)

Return as JSON with keys: username, bio, postCount, followerCount, followingCount, recentCaptions (array of strings)`,
      schema: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          bio: { type: 'string' },
          postCount: { type: 'number' },
          followerCount: { type: 'number' },
          followingCount: { type: 'number' },
          recentCaptions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  ]
}

export function parseExtractionResult(raw: Record<string, unknown>, handle: string): InstagramProfile {
  return {
    username: (raw.username as string) || handle.replace(/^@/, ''),
    bio: (raw.bio as string) || null,
    followerCount: typeof raw.followerCount === 'number' ? raw.followerCount : null,
    followingCount: typeof raw.followingCount === 'number' ? raw.followingCount : null,
    postCount: typeof raw.postCount === 'number' ? raw.postCount : null,
    recentCaptions: Array.isArray(raw.recentCaptions)
      ? raw.recentCaptions.filter((c): c is string => typeof c === 'string')
      : [],
    scrapedAt: new Date().toISOString(),
  }
}

/**
 * Combine all IG data into a single text block for analysis.
 */
export function profileToAnalysisText(profile: InstagramProfile): string {
  const parts: string[] = []
  if (profile.bio) parts.push(`Bio: ${profile.bio}`)
  if (profile.followerCount !== null) parts.push(`Followers: ${profile.followerCount}`)
  if (profile.recentCaptions.length > 0) {
    parts.push(`Recent posts:\n${profile.recentCaptions.map((c, i) => `${i + 1}. ${c}`).join('\n')}`)
  }
  return parts.join('\n\n')
}
