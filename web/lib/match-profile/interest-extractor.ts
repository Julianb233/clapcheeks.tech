/**
 * Interest extraction — Claude AI for structured extraction,
 * keyword fallback for offline/cheap mode.
 */

export interface ExtractedInterests {
  interests: string[]
  tags: string[]         // high-level categories
  confidence: number     // 0-1
  source: 'ai' | 'keyword'
}

const INTEREST_CATEGORIES: Record<string, string[]> = {
  fitness: ['gym', 'crossfit', 'yoga', 'pilates', 'running', 'marathon', 'hiking', 'climbing', 'cycling', 'swim', 'surf', 'ski', 'snowboard', 'workout', 'lifting', 'weights', 'peloton'],
  travel: ['travel', 'backpack', 'adventure', 'exploring', 'wanderlust', 'passport', 'road trip', 'beach', 'mountain', 'europe', 'asia', 'bali', 'thailand', 'japan', 'italy', 'paris', 'london'],
  food: ['foodie', 'cook', 'baking', 'chef', 'restaurant', 'sushi', 'wine', 'coffee', 'brunch', 'taco', 'pizza', 'vegan', 'vegetarian', 'cocktail', 'whiskey', 'beer', 'mixology'],
  music: ['music', 'concert', 'festival', 'guitar', 'piano', 'singing', 'dj', 'edm', 'jazz', 'hip hop', 'indie', 'rock', 'classical', 'spotify', 'coachella', 'lollapalooza'],
  arts: ['art', 'museum', 'gallery', 'paint', 'draw', 'photography', 'film', 'cinema', 'theater', 'design', 'creative', 'writing', 'poetry', 'dance', 'ballet'],
  outdoors: ['hiking', 'camping', 'kayak', 'fishing', 'nature', 'national park', 'trail', 'backpacking', 'rock climbing', 'bouldering', 'scuba', 'diving', 'sailing'],
  tech: ['tech', 'code', 'programming', 'startup', 'crypto', 'ai', 'engineer', 'developer', 'software', 'design', 'product', 'data', 'science'],
  intellectual: ['book', 'reading', 'podcast', 'philosophy', 'documentary', 'history', 'politics', 'ted talk', 'debate', 'chess', 'puzzle', 'trivia', 'science'],
  social: ['party', 'nightlife', 'club', 'bar', 'karaoke', 'board game', 'game night', 'friends', 'social', 'networking', 'event'],
  wellness: ['meditation', 'mindful', 'therapy', 'journal', 'self-care', 'mental health', 'spiritual', 'astrology', 'tarot', 'crystals', 'manifestation'],
  pets: ['dog', 'cat', 'puppy', 'kitten', 'rescue', 'animal', 'horse', 'pet'],
  sports: ['basketball', 'football', 'soccer', 'baseball', 'tennis', 'golf', 'volleyball', 'boxing', 'mma', 'ufc', 'nba', 'nfl', 'mlb', 'f1', 'formula 1'],
}

/**
 * Build Claude prompt for structured interest extraction.
 */
export function buildExtractionPrompt(profileText: string): string {
  return `Analyze this dating profile and extract structured data. Return ONLY valid JSON.

Profile text:
---
${profileText}
---

Return JSON with these fields:
{
  "interests": ["specific interest 1", "specific interest 2", ...],
  "tags": ["high-level category 1", "category 2", ...],
  "personality_traits": ["trait 1", "trait 2", ...],
  "conversation_hooks": ["hook 1", "hook 2", ...],
  "red_flags": ["flag 1", ...] or []
}

Categories for tags: fitness, travel, food, music, arts, outdoors, tech, intellectual, social, wellness, pets, sports, fashion, gaming.
Be specific with interests (e.g. "bouldering" not just "fitness"). Extract 5-15 interests.`
}

/**
 * Parse Claude's extraction response.
 */
export function parseExtractionResponse(response: string): ExtractedInterests {
  try {
    // Try to find JSON in the response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { interests: [], tags: [], confidence: 0, source: 'ai' }

    const parsed = JSON.parse(jsonMatch[0])
    return {
      interests: Array.isArray(parsed.interests) ? parsed.interests : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      confidence: 0.85,
      source: 'ai',
    }
  } catch {
    return { interests: [], tags: [], confidence: 0, source: 'ai' }
  }
}

/**
 * Keyword-based interest extraction (offline fallback).
 */
export function extractInterestsKeyword(text: string): ExtractedInterests {
  const lower = text.toLowerCase()
  const found: string[] = []
  const tags: string[] = []

  for (const [category, keywords] of Object.entries(INTEREST_CATEGORIES)) {
    const matches = keywords.filter(kw => lower.includes(kw))
    if (matches.length > 0) {
      found.push(...matches)
      if (!tags.includes(category)) tags.push(category)
    }
  }

  // Deduplicate
  const unique = [...new Set(found)]
  return {
    interests: unique,
    tags,
    confidence: Math.min(0.7, unique.length * 0.07),
    source: 'keyword',
  }
}

/**
 * Find shared interests between user interests and match interests.
 */
export function findInterestOverlap(
  userInterests: string[],
  matchInterests: string[],
): string[] {
  const userSet = new Set(userInterests.map(i => i.toLowerCase()))
  return matchInterests.filter(i => userSet.has(i.toLowerCase()))
}
