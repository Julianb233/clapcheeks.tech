/**
 * DISC communication profiler — estimates personality type from bio text,
 * interests, and zodiac, then generates conversation strategy + openers.
 */

export interface DiscScores {
  D: number  // Dominance
  I: number  // Influence
  S: number  // Steadiness
  C: number  // Conscientiousness
}

export interface DiscProfile {
  type: string           // "D", "DI", "IS", etc.
  label: string          // "Driver", "Influencer", etc.
  scores: DiscScores
  strategy: string       // how to approach
  openers: string[]      // suggested openers
  topics: string[]       // good conversation topics
  avoid: string[]        // things to avoid
}

const SIGNAL_KEYWORDS: Record<keyof DiscScores, string[]> = {
  D: [
    'ambitious', 'competitive', 'driven', 'hustle', 'boss', 'ceo', 'founder',
    'startup', 'grind', 'winning', 'goal', 'leader', 'direct', 'bold', 'risk',
    'challenge', 'achieve', 'power', 'strong', 'fierce', 'dominate', 'conquer',
    'gym', 'crossfit', 'marathon', 'ironman', 'mba', 'entrepreneur',
  ],
  I: [
    'fun', 'party', 'social', 'adventure', 'travel', 'laugh', 'friends',
    'outgoing', 'spontaneous', 'creative', 'music', 'dance', 'festival',
    'vibes', 'energy', 'optimistic', 'enthusiastic', 'storytell', 'perform',
    'comedy', 'karaoke', 'concert', 'brunch', 'foodie', 'explore',
    'experience', 'bucket list', 'yolo',
  ],
  S: [
    'loyal', 'family', 'home', 'cozy', 'stable', 'calm', 'patient',
    'supportive', 'reliable', 'trust', 'comfort', 'peace', 'gentle',
    'kind', 'caring', 'nurturing', 'cooking', 'baking', 'garden', 'dog mom',
    'cat', 'netflix', 'introvert', 'quiet', 'simple', 'genuine', 'down to earth',
  ],
  C: [
    'detail', 'organize', 'plan', 'research', 'data', 'analytics', 'engineer',
    'developer', 'code', 'science', 'phd', 'thesis', 'precise', 'perfect',
    'quality', 'standard', 'system', 'logic', 'rational', 'chess', 'puzzle',
    'read', 'book', 'philosophy', 'museum', 'documentary', 'podcast',
    'mindful', 'journal',
  ],
}

const TYPE_LABELS: Record<string, string> = {
  D: 'Driver', DI: 'Commander', DC: 'Architect', DIS: 'Captain',
  I: 'Influencer', ID: 'Persuader', IS: 'Encourager', IC: 'Creative',
  S: 'Supporter', SI: 'Harmonizer', SD: 'Coordinator', SC: 'Analyst',
  C: 'Thinker', CD: 'Strategist', CI: 'Innovator', CS: 'Planner',
  DISC: 'Balanced',
}

const TYPE_STRATEGIES: Record<string, { strategy: string; openers: string[]; topics: string[]; avoid: string[] }> = {
  D: {
    strategy: 'Be direct and confident. Skip small talk — get to the point. Show ambition and suggest concrete plans.',
    openers: ['What\'s the most ambitious thing on your plate right now?', 'You seem like someone who goes after what they want.', 'I\'m guessing you have a 5-year plan — am I right?'],
    topics: ['goals', 'career wins', 'competition', 'fitness', 'travel destinations'],
    avoid: ['being wishy-washy', 'excessive small talk', 'vague plans'],
  },
  I: {
    strategy: 'Match their energy and enthusiasm. Be playful, tell stories, suggest fun experiences. Keep it light and exciting.',
    openers: ['What\'s the craziest adventure you\'ve been on recently?', 'You have festival energy — what\'s next on your list?', 'I bet you have a great story about that trip.'],
    topics: ['travel stories', 'music/concerts', 'food spots', 'upcoming events', 'dreams'],
    avoid: ['being too serious too early', 'heavy topics', 'over-planning'],
  },
  S: {
    strategy: 'Be warm, sincere, and patient. Show genuine interest in who they are. Don\'t rush — build trust through authenticity.',
    openers: ['What does a perfect Sunday look like for you?', 'You seem like someone who really values the people in your life.', 'I love that you [specific thing from bio]. What got you into that?'],
    topics: ['family', 'pets', 'comfort activities', 'meaningful memories', 'values'],
    avoid: ['being pushy', 'rushing to meet', 'bragging', 'being too flashy'],
  },
  C: {
    strategy: 'Show intellectual depth. Ask thoughtful questions. Be specific, not generic. Demonstrate that you actually read their profile.',
    openers: ['I noticed you\'re into [X] — have you come across [related thing]?', 'What\'s the most interesting thing you\'ve read/watched recently?', 'You seem like someone who thinks deeply about things.'],
    topics: ['books', 'ideas', 'science/tech', 'philosophy', 'documentaries', 'puzzles'],
    avoid: ['generic openers', 'surface-level chat', 'being overly emotional early'],
  },
}

export function estimateDiscScores(
  bio: string | null | undefined,
  interests: string[] = [],
  zodiacTraits: string | null = null,
): DiscScores {
  const text = [bio ?? '', interests.join(' '), zodiacTraits ?? ''].join(' ').toLowerCase()
  const raw: DiscScores = { D: 0, I: 0, S: 0, C: 0 }

  for (const [dim, keywords] of Object.entries(SIGNAL_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) raw[dim as keyof DiscScores] += 1
    }
  }

  // Normalize to 0-1
  const total = raw.D + raw.I + raw.S + raw.C || 1
  return {
    D: Math.round((raw.D / total) * 100) / 100,
    I: Math.round((raw.I / total) * 100) / 100,
    S: Math.round((raw.S / total) * 100) / 100,
    C: Math.round((raw.C / total) * 100) / 100,
  }
}

export function buildDiscProfile(
  bio: string | null | undefined,
  interests: string[] = [],
  zodiacTraits: string | null = null,
): DiscProfile {
  const scores = estimateDiscScores(bio, interests, zodiacTraits)

  // Determine dominant dimensions (above 0.25 threshold)
  const sorted = (Object.entries(scores) as [keyof DiscScores, number][])
    .sort(([, a], [, b]) => b - a)
  const threshold = 0.25
  const dominant = sorted.filter(([, v]) => v >= threshold).map(([k]) => k)
  const type = dominant.length > 0 ? dominant.join('') : sorted[0][0]

  // Get label
  const label = TYPE_LABELS[type] ?? TYPE_LABELS[type[0]] ?? 'Balanced'

  // Get strategy from primary type
  const primary = type[0] as keyof typeof TYPE_STRATEGIES
  const strat = TYPE_STRATEGIES[primary] ?? TYPE_STRATEGIES.I

  // Mix in secondary type elements if present
  let strategy = strat.strategy
  const openers = [...strat.openers]
  const topics = [...strat.topics]
  const avoid = [...strat.avoid]

  if (type.length > 1) {
    const secondary = type[1] as keyof typeof TYPE_STRATEGIES
    const sec = TYPE_STRATEGIES[secondary]
    if (sec) {
      strategy += ` Also blend in some ${secondary}-energy: ${sec.strategy.split('.')[0].toLowerCase()}.`
      openers.push(sec.openers[0])
      topics.push(...sec.topics.slice(0, 2))
      avoid.push(sec.avoid[0])
    }
  }

  return { type, label, scores, strategy, openers, topics, avoid }
}
