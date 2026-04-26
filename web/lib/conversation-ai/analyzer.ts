/**
 * Conversation Intelligence — TS port of Phase 41 (AI-8326).
 *
 * Mirrors agent/clapcheeks/conversation/{analyzer,strategy,red_flags}.py.
 * Pure functions, no DB/LLM calls — safe to use anywhere on the server.
 *
 * Used by /api/conversation/analyze for browser-driven analysis and by
 * generate-replies.ts to inject strategy into the LLM system prompt.
 */

// -------- Topic taxonomy (mirrors analyzer.py) ----------
const TOPIC_KEYWORDS: Record<string, string[]> = {
  travel: ['travel', 'trip', 'vacation', 'flight', 'tokyo', 'paris', 'europe', 'mexico', 'bali', 'thailand', 'japan', 'italy', 'spain', 'passport', 'airport', 'hotel', 'airbnb'],
  fitness: ['gym', 'workout', 'lifting', 'crossfit', 'yoga', 'pilates', 'run', 'running', 'marathon', 'hike', 'hiking', 'climb', 'rock climbing', 'bouldering', 'swim', 'surf', 'surfing'],
  food: ['food', 'eat', 'ate', 'dinner', 'lunch', 'brunch', 'cook', 'recipe', 'restaurant', 'ramen', 'sushi', 'pizza', 'tacos', 'coffee', 'matcha'],
  drinks: ['drink', 'beer', 'wine', 'cocktail', 'bar', 'brewery', 'tequila', 'whiskey', 'margarita', 'happy hour'],
  music: ['music', 'song', 'album', 'concert', 'festival', 'spotify', 'playlist', 'band', 'edm', 'rap', 'indie'],
  movies_tv: ['movie', 'film', 'show', 'netflix', 'hbo', 'series', 'season', 'episode', 'documentary'],
  work: ['work', 'job', 'office', 'boss', 'client', 'meeting', 'project', 'career', 'startup', 'founder', 'ceo'],
  school: ['school', 'college', 'university', 'class', 'professor', 'exam', 'degree', 'major', 'phd', 'thesis'],
  family: ['family', 'mom', 'dad', 'sister', 'brother', 'parents', 'siblings', 'cousin', 'kids', 'grandma', 'grandpa'],
  pets: ['dog', 'puppy', 'cat', 'kitten', 'pet', 'vet'],
  weekend_plans: ['weekend', 'saturday', 'sunday', 'friday night', 'tonight', 'tomorrow'],
  date_proposal: ['meet up', 'meet you', 'grab a', 'grab drinks', 'grab coffee', "let's meet", 'should meet', 'wanna grab', 'wanna hang'],
  sex_flirt: ['kiss', 'kissing', 'naughty', 'tease', 'spicy', 'lingerie', 'sleep over', 'stay over', 'in bed', 'naked'],
  future_plans: ['future', 'long term', 'looking for', 'kids someday', 'marriage', 'settle down'],
  san_diego_local: ['san diego', 'la jolla', 'encinitas', 'north park', 'pacific beach', 'ocean beach', 'del mar', 'balboa park', 'gaslamp', 'coronado', 'carlsbad', 'oceanside'],
  instagram: ['instagram', 'follow you', 'follow me', 'stories', 'reel'],
}

const HIGH_ENGAGEMENT_WORDS = new Set([
  'love', 'obsessed', 'literally', 'omg', 'amazing', 'haha', 'lol', 'lmao',
  'tell me more', 'what about you', 'no way', 'hell yeah', 'for sure',
])
const LOW_EFFORT_REPLIES = new Set(['k', 'ok', 'lol', 'haha', 'yeah', 'yea', 'no', 'nah', 'cool', 'nice', 'lmao', 'idk', 'maybe', 'good'])

const POSITIVE_LEX = new Set(['love', 'great', 'amazing', 'awesome', 'fun', 'happy', 'excited', 'haha', 'lol', 'lmao', 'perfect', 'yes', 'best', 'nice', 'cute', 'down', 'obsessed'])
const NEGATIVE_LEX = new Set(['hate', 'annoying', 'tired', 'stressed', 'ugh', 'sad', 'bored', 'no', 'nope', 'bad', 'awful', 'terrible', 'lame', 'sucks', 'boring'])
const NEGATION = new Set(['not', 'never', "don't", 'dont', "didn't", 'didnt'])

const FLIRT_HIGH = ['kiss', 'lingerie', 'tease', 'naughty', 'in bed', 'shower', 'spicy', 'naked', 'sleep over']
const FLIRT_MID = ['cute', 'handsome', 'pretty', 'sexy', 'hot', 'gorgeous']
const FLIRT_LOW_EMOJI = ['😉', '😘', '😏', '🥵', '🔥', '💋', '😈']

const HER_ROLES = new Set(['user', 'her', 'contact', 'match'])
const US_ROLES = new Set(['assistant', 'us', 'julian', 'me'])

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu

// -------- Types ----------

export interface IncomingMessage {
  role?: string
  sender?: string
  content?: string
  text?: string
  sent_at?: string | number | null
  ts?: string | number | null
}

interface NormMsg { side: 'her' | 'us'; text: string; ts: Date | null }

export interface ResponseTimeStats {
  her_median_seconds: number | null
  us_median_seconds: number | null
  her_fastest_seconds: number | null
  her_slowest_seconds: number | null
  her_response_count: number
  us_response_count: number
}

export interface ConversationAnalysis {
  message_count: number
  her_message_count: number
  us_message_count: number
  topics: Record<string, number>
  primary_topic: string | null
  sentiment_score: number
  sentiment_trend: 'rising' | 'flat' | 'falling'
  engagement_level: 'cold' | 'warm' | 'hot'
  engagement_per_topic: Record<string, 'cold' | 'warm' | 'hot'>
  engagement_peaks: number[]
  response_time: ResponseTimeStats
  emoji_frequency: number
  question_to_statement_ratio: { her: number; us: number }
  flirtation_level: number
}

export interface ConversationStrategy {
  try_topics: string[]
  avoid_topics: string[]
  suggested_tone: 'playful' | 'warm' | 'direct' | 'flirty'
  ideal_message_length: 'short' | 'medium' | 'long'
  best_send_window: 'morning' | 'afternoon' | 'evening' | 'late_night'
  move_to_text_score: number
  rationale: string
}

export interface RedFlag {
  code: string
  severity: 'info' | 'warn' | 'critical'
  description: string
  evidence: string[]
}

// -------- Helpers ----------

function parseTs(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    const d = new Date(value * (value < 1e12 ? 1000 : 1))
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string' && value) {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function normalize(messages: IncomingMessage[]): NormMsg[] {
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const role = (m.role || m.sender || '').toLowerCase()
      let side: 'her' | 'us' = 'her'
      if (HER_ROLES.has(role)) side = 'her'
      else if (US_ROLES.has(role)) side = 'us'
      else side = 'her'
      const text = (m.content || m.text || '').toString().trim()
      const ts = parseTs(m.sent_at ?? m.ts ?? null)
      return { side, text, ts }
    })
}

function topicHits(text: string): string[] {
  const low = text.toLowerCase()
  const hits: string[] = []
  for (const [topic, cues] of Object.entries(TOPIC_KEYWORDS)) {
    for (const c of cues) {
      if (low.includes(c)) {
        hits.push(topic)
        break
      }
    }
  }
  return hits
}

function sentimentScore(text: string): number {
  if (!text) return 0
  const tokens = (text.toLowerCase().match(/[a-z']+/g) || [])
  if (!tokens.length) return 0
  let score = 0
  let matches = 0
  tokens.forEach((tok, i) => {
    const sign = i > 0 && NEGATION.has(tokens[i - 1]) ? -1 : 1
    if (POSITIVE_LEX.has(tok)) {
      score += 1 * sign
      matches += 1
    } else if (NEGATIVE_LEX.has(tok)) {
      score -= 1 * sign
      matches += 1
    }
  })
  if (matches === 0) return 0
  return Math.max(-1, Math.min(1, score / matches))
}

function sentimentTrend(scores: number[]): 'rising' | 'flat' | 'falling' {
  if (scores.length < 4) return 'flat'
  const mid = Math.floor(scores.length / 2)
  const a = scores.slice(0, mid).reduce((s, x) => s + x, 0) / mid
  const b = scores.slice(mid).reduce((s, x) => s + x, 0) / (scores.length - mid)
  const delta = b - a
  if (delta >= 0.15) return 'rising'
  if (delta <= -0.15) return 'falling'
  return 'flat'
}

function engagementForText(text: string): 'cold' | 'warm' | 'hot' {
  if (!text.trim()) return 'cold'
  const low = text.toLowerCase().trim()
  const wordCount = low.split(/\s+/).filter(Boolean).length
  if (wordCount <= 1 && LOW_EFFORT_REPLIES.has(low)) return 'cold'
  let highHits = 0
  for (const w of HIGH_ENGAGEMENT_WORDS) if (low.includes(w)) highHits += 1
  const hasQ = text.includes('?')
  if (wordCount >= 12 && (hasQ || highHits >= 1)) return 'hot'
  if (wordCount >= 6 || highHits >= 1 || hasQ) return 'warm'
  return 'cold'
}

function engagementOverall(per: ('cold' | 'warm' | 'hot')[]): 'cold' | 'warm' | 'hot' {
  if (!per.length) return 'cold'
  const counts = { cold: 0, warm: 0, hot: 0 }
  per.forEach((l) => { counts[l] += 1 })
  const total = per.length
  if (counts.hot / total >= 0.3) return 'hot'
  if (counts.cold / total >= 0.6) return 'cold'
  return 'warm'
}

function flirtationLevel(herTexts: string[]): number {
  if (!herTexts.length) return 0
  let score = 0
  for (const t of herTexts) {
    const low = t.toLowerCase()
    for (const w of FLIRT_HIGH) if (low.includes(w)) score += 0.5
    for (const w of FLIRT_MID) if (low.includes(w)) score += 0.25
    for (const e of FLIRT_LOW_EMOJI) if (t.includes(e)) score += 0.15
  }
  return Math.max(0, Math.min(1, score / herTexts.length))
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function responseTimes(messages: NormMsg[]): ResponseTimeStats {
  const herGaps: number[] = []
  const usGaps: number[] = []
  for (let i = 0; i < messages.length - 1; i += 1) {
    const prev = messages[i]
    const cur = messages[i + 1]
    if (!prev.ts || !cur.ts) continue
    if (prev.side === cur.side) continue
    const gap = (cur.ts.getTime() - prev.ts.getTime()) / 1000
    if (gap < 0) continue
    if (cur.side === 'her') herGaps.push(gap)
    else usGaps.push(gap)
  }
  return {
    her_median_seconds: median(herGaps),
    us_median_seconds: median(usGaps),
    her_fastest_seconds: herGaps.length ? Math.min(...herGaps) : null,
    her_slowest_seconds: herGaps.length ? Math.max(...herGaps) : null,
    her_response_count: herGaps.length,
    us_response_count: usGaps.length,
  }
}

function questionToStatement(texts: string[]): number {
  if (!texts.length) return 0
  const q = texts.filter((t) => t.includes('?')).length
  const s = texts.filter((t) => t.trim() && !t.includes('?')).length
  if (s === 0) return q ? q : 0
  return q / s
}

// -------- Public: analyze ----------

export function analyzeConversation(messages: IncomingMessage[]): ConversationAnalysis {
  const norm = normalize(messages)
  const her = norm.filter((m) => m.side === 'her')
  const us = norm.filter((m) => m.side === 'us')
  const herTexts = her.map((m) => m.text).filter(Boolean)
  const usTexts = us.map((m) => m.text).filter(Boolean)

  const topicCounts: Record<string, number> = {}
  const perTopicEng: Record<string, ('cold' | 'warm' | 'hot')[]> = {}
  const perMsgEng: ('cold' | 'warm' | 'hot')[] = []
  const sentHer: number[] = []
  const peaks: number[] = []

  norm.forEach((m, idx) => {
    if (!m.text) return
    const hits = topicHits(m.text)
    hits.forEach((t) => { topicCounts[t] = (topicCounts[t] || 0) + 1 })
    const eng = engagementForText(m.text)
    perMsgEng.push(eng)
    hits.forEach((t) => { (perTopicEng[t] ||= []).push(eng) })
    if (eng === 'hot') peaks.push(idx)
    if (m.side === 'her') sentHer.push(sentimentScore(m.text))
  })

  const sortedTopics = Object.entries(topicCounts).sort(([, a], [, b]) => b - a)
  const topics = Object.fromEntries(sortedTopics)
  const primaryTopic = sortedTopics.length ? sortedTopics[0][0] : null

  const engagementPerTopic: Record<string, 'cold' | 'warm' | 'hot'> = {}
  for (const [t, levels] of Object.entries(perTopicEng)) {
    engagementPerTopic[t] = engagementOverall(levels)
  }

  const emojiTotal = herTexts.reduce((s, t) => s + (t.match(EMOJI_RE) || []).length, 0)

  return {
    message_count: norm.length,
    her_message_count: her.length,
    us_message_count: us.length,
    topics,
    primary_topic: primaryTopic,
    sentiment_score: sentHer.length ? sentHer.reduce((s, x) => s + x, 0) / sentHer.length : 0,
    sentiment_trend: sentimentTrend(sentHer),
    engagement_level: engagementOverall(perMsgEng),
    engagement_per_topic: engagementPerTopic,
    engagement_peaks: peaks,
    response_time: responseTimes(norm),
    emoji_frequency: herTexts.length ? emojiTotal / herTexts.length : 0,
    question_to_statement_ratio: {
      her: questionToStatement(herTexts),
      us: questionToStatement(usTexts),
    },
    flirtation_level: flirtationLevel(herTexts),
  }
}

// -------- Strategy ----------

const HANDOFF_REQUEST_RE = /\b(give me your number|what'?s? your number|send (me )?your (number|digits|whatsapp|insta|ig)|text me|hit me up|let'?s (meet|grab|get)|we should (meet|grab|get)|want to (meet|grab|get)|i'?ll text you|add me on (ig|insta|whatsapp))\b/i

function herExplicitHandoff(messages: IncomingMessage[]): boolean {
  const norm = normalize(messages)
  return norm.some((m) => m.side === 'her' && HANDOFF_REQUEST_RE.test(m.text))
}

const GENERIC_TOPICS = ['weekend_plans', 'food', 'travel', 'music', 'movies_tv']
const LOW_VALUE_TOPICS = new Set(['work', 'school', 'family'])
const RED_FLAG_TO_AVOID: Record<string, string[]> = {
  no_hookups: ['sex_flirt', 'future_plans'],
  gym_required: ['food'],
  height_requirement: ['work'],
}

function interestsFromProfile(profile: Record<string, unknown> | null | undefined): string[] {
  if (!profile) return []
  const pool: string[] = []
  const push = (xs: unknown) => {
    if (Array.isArray(xs)) xs.forEach((x) => typeof x === 'string' && pool.push(x))
  }
  push((profile as { interests?: unknown }).interests)
  const ig = (profile as { instagram_intel?: { hashtags?: unknown; topics?: unknown } }).instagram_intel
  if (ig && typeof ig === 'object') {
    push(ig.hashtags)
    push(ig.topics)
  }
  const vision = (profile as { vision_summary?: { activities?: unknown; scenes?: unknown } }).vision_summary
  if (vision && typeof vision === 'object') {
    push(vision.activities)
    push(vision.scenes)
  }
  push((profile as { prompt_themes?: unknown }).prompt_themes)
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of pool) {
    const norm = x.trim().toLowerCase().replace(/^#/, '')
    if (norm && !seen.has(norm)) {
      seen.add(norm)
      out.push(norm)
    }
  }
  return out
}

function moveToTextScore(
  analysis: ConversationAnalysis,
  conversation: IncomingMessage[],
): { score: number; rationale: string } {
  let score = 0
  const parts: string[] = []
  if (herExplicitHandoff(conversation)) {
    score += 25
    parts.push('she asked for the move')
  }
  const n = analysis.message_count
  if (n >= 14) { score += 30; parts.push(`${n} msgs (plenty)`) }
  else if (n >= 10) { score += 24; parts.push(`${n} msgs (enough)`) }
  else if (n >= 6) { score += 18; parts.push(`${n} msgs (warming)`) }
  else if (n >= 3) { score += 8; parts.push(`${n} msgs (early)`) }
  else { parts.push(`${n} msgs (too early)`) }

  const s = analysis.sentiment_score
  if (s >= 0.3) { score += 15; parts.push(`sentiment +${s.toFixed(2)}`) }
  else if (s >= 0) { score += 8; parts.push(`sentiment ~${s.toFixed(2)}`) }
  else { parts.push(`sentiment ${s.toFixed(2)} (cool)`) }

  if (analysis.engagement_level === 'hot') { score += 20; parts.push('hot engagement') }
  else if (analysis.engagement_level === 'warm') { score += 12; parts.push('warm engagement') }
  else { parts.push('cold engagement') }

  if (analysis.flirtation_level >= 0.5) { score += 15; parts.push('clearly flirty') }
  else if (analysis.flirtation_level >= 0.2) { score += 8; parts.push('some flirtation') }

  if (analysis.question_to_statement_ratio.her >= 0.4) { score += 10; parts.push('she asks back') }
  else if (analysis.question_to_statement_ratio.her >= 0.2) { score += 5 }

  const rt = analysis.response_time.her_median_seconds
  if (rt !== null && rt < 60 * 10) { score += 5; parts.push('quick replies') }

  return { score: Math.max(0, Math.min(100, Math.round(score))), rationale: parts.join(', ') || 'limited signal' }
}

export function generateStrategy(
  matchProfile: Record<string, unknown> | null | undefined,
  conversation: IncomingMessage[],
  analysis?: ConversationAnalysis,
): ConversationStrategy {
  const profile = matchProfile || {}
  const a = analysis || analyzeConversation(conversation)

  // try_topics
  const interests = interestsFromProfile(profile)
  const tryTopics: string[] = []
  for (const x of interests) {
    if (!tryTopics.includes(x)) tryTopics.push(x)
    if (tryTopics.length >= 5) break
  }
  for (const t of GENERIC_TOPICS) {
    if (tryTopics.length >= 5) break
    if (!tryTopics.includes(t)) tryTopics.push(t)
  }

  // avoid_topics
  const avoid: string[] = []
  for (const [topic, level] of Object.entries(a.engagement_per_topic)) {
    if (level === 'cold' && !avoid.includes(topic)) avoid.push(topic)
  }
  const redFlags = (profile as { red_flags?: string[] }).red_flags || []
  for (const flag of redFlags) {
    for (const t of RED_FLAG_TO_AVOID[flag] || []) {
      if (!avoid.includes(t)) avoid.push(t)
    }
  }
  for (const t of LOW_VALUE_TOPICS) if (!avoid.includes(t)) avoid.push(t)

  // tone
  let tone: ConversationStrategy['suggested_tone']
  if (a.flirtation_level >= 0.4) tone = 'flirty'
  else if (a.sentiment_score > 0.3 && a.engagement_level === 'hot') tone = 'playful'
  else if (a.sentiment_score < -0.1 || a.engagement_level === 'cold') tone = 'warm'
  else tone = a.message_count >= 4 ? 'playful' : 'warm'

  // length
  const style = (profile as { style_profile?: { avg_message_length?: number; avg_words?: number } }).style_profile || {}
  const avg = style.avg_message_length ?? style.avg_words
  let length: ConversationStrategy['ideal_message_length'] = 'medium'
  if (typeof avg === 'number') {
    if (avg < 8) length = 'short'
    else if (avg > 18) length = 'long'
  }

  // window
  const rt = a.response_time.her_median_seconds
  let window: ConversationStrategy['best_send_window'] = 'evening'
  if (rt !== null) {
    if (rt < 60 * 5) window = 'evening'
    else if (rt > 60 * 60 * 6) window = 'morning'
  }

  const { score, rationale } = moveToTextScore(a, conversation)

  return {
    try_topics: tryTopics.slice(0, 5),
    avoid_topics: avoid.slice(0, 3),
    suggested_tone: tone,
    ideal_message_length: length,
    best_send_window: window,
    move_to_text_score: score,
    rationale,
  }
}

export function renderStrategyForPrompt(strategy: ConversationStrategy): string {
  const lines = ['=== CONVERSATION STRATEGY ===']
  if (strategy.try_topics.length) lines.push('- Topics to lean into: ' + strategy.try_topics.join(', '))
  if (strategy.avoid_topics.length) lines.push('- Topics to avoid: ' + strategy.avoid_topics.join(', '))
  lines.push(`- Suggested tone: ${strategy.suggested_tone}.`)
  lines.push(`- Ideal length: ${strategy.ideal_message_length}.`)
  if (strategy.move_to_text_score >= 70) {
    lines.push(`- Move-to-text readiness: ${strategy.move_to_text_score}/100 (GOOD - this turn or next, ask for the number / suggest meeting).`)
  } else if (strategy.move_to_text_score >= 40) {
    lines.push(`- Move-to-text readiness: ${strategy.move_to_text_score}/100 (BUILDING - keep escalating, do not ask yet).`)
  } else {
    lines.push(`- Move-to-text readiness: ${strategy.move_to_text_score}/100 (NOT READY - stay light, build rapport).`)
  }
  return lines.join('\n')
}

// -------- Red flags ----------

const FINANCIAL_RE = /\b(venmo|cashapp|cash\s?app|zelle|paypal|wire (me|the)|send (me )?(money|funds|cash|btc|crypto|bitcoin)|gift\s?cards?|steam\s?cards?|google\s?play\s?cards?|can you (help|cover|pay|loan|spot)|need (money|cash|help with rent|to borrow)|emergency (money|cash|funds))\b/i
const LOVE_BOMB_RE = /\b(soulmate|soul mate|the one|obsessed with you|never felt this way|my future (husband|wife)|i love you|in love with you|destined|my everything|made for each other)\b/i
const CATFISH_RE = /\b(can'?t (do |meet|video|facetime|talk on the phone)|don'?t (show my face|do video calls|do photos)|my camera (is broken|doesn'?t work)|phone is broken|out of the country|stationed overseas|deployed (overseas|abroad)|oil rig|on a (rig|ship|deployment))\b/i
const SOB_RE = /\b(my (husband|wife|partner) (died|passed|left)|widow|widowed|sick (mother|father|kid|dad|mom)|stuck in (airport|customs|hotel)|can'?t access my account|frozen account|inheritance|hospital bill)\b/i
const REDIRECT_RE = /\b(telegram|signal|whatsapp|kik|snap me|snapchat|wechat|add me on|find me at|my (website|site|onlyfans|of))\b/i
const SCAM_DOMAINS = ['tinychat', 'cashapp.me', 'venmo.me', 'linktr.ee', 'beacons.ai']
const URL_RE = /https?:\/\/\S+|\bbit\.ly\S+|\bt\.co\S+/gi

const SEVERITY_RANK: Record<RedFlag['severity'], number> = { info: 0, warn: 1, critical: 2 }

function isLowEffort(text: string): boolean {
  if (!text) return true
  const low = text.trim().toLowerCase()
  if (low.length <= 3) return true
  const words = (low.match(/[a-z']+/g) || [])
  if (!words.length) return true
  if (words.length === 1) return true
  if (words.length <= 2 && words.every((w) => LOW_EFFORT_REPLIES.has(w))) return true
  return false
}

function detectInconsistency(herTexts: string[]): string[] {
  const ages: number[] = []
  const cities: string[] = []
  const ageRe = /\b(?:i'?m|im)\s+(\d{2})\b/gi
  const cityRe = /\b(?:i live in|im from|i'?m from|im in|i'?m in)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})/g
  for (const t of herTexts) {
    let m: RegExpExecArray | null
    while ((m = ageRe.exec(t))) {
      const age = parseInt(m[1], 10)
      if (age >= 18 && age <= 80) ages.push(age)
    }
    while ((m = cityRe.exec(t))) cities.push(m[1].trim())
  }
  const evidence: string[] = []
  if (ages.length && new Set(ages).size > 1) evidence.push(`stated ages: ${[...new Set(ages)].sort((a, b) => a - b).join(', ')}`)
  if (cities.length && new Set(cities.map((c) => c.toLowerCase())).size > 1) {
    evidence.push(`stated cities: ${[...new Set(cities)].join(', ')}`)
  }
  return evidence
}

export function detectRedFlags(messages: IncomingMessage[]): RedFlag[] {
  const norm = normalize(messages)
  const her = norm.filter((m) => m.side === 'her')
  const herTexts = her.map((m) => m.text).filter(Boolean)
  const flags: RedFlag[] = []

  if (her.length >= 3) {
    const low = herTexts.filter((t) => isLowEffort(t)).length
    const share = low / her.length
    if (share >= 0.7) {
      flags.push({
        code: 'low_effort',
        severity: 'warn',
        description: `${Math.floor(share * 100)}% of her replies are 1-2 words. Conversation isn't going anywhere.`,
        evidence: herTexts.slice(-3),
      })
    }
  }

  if (norm.length >= 16 && norm[0].side === 'us' && her.length >= 1) {
    let initiated = false
    for (let i = 0; i < norm.length - 1; i += 1) {
      if (norm[i].side === 'her' && norm[i + 1].side === 'her') { initiated = true; break }
    }
    if (!initiated) {
      flags.push({
        code: 'never_initiates',
        severity: 'info',
        description: 'Across 16+ messages she has never double-sent or initiated.',
        evidence: [],
      })
    }
  }

  const fin = herTexts.filter((t) => FINANCIAL_RE.test(t))
  if (fin.length) flags.push({ code: 'financial_request', severity: 'critical', description: "She's asking for money or payment apps - high scam likelihood.", evidence: fin })

  const love = her.find((m) => LOVE_BOMB_RE.test(m.text))
  if (love && her.length <= 6) {
    flags.push({ code: 'love_bombing', severity: 'warn', description: "Premature intensity - 'soulmate'/'the one' very early.", evidence: [love.text] })
  }

  const catfish = herTexts.filter((t) => CATFISH_RE.test(t))
  if (catfish.length) flags.push({ code: 'catfish_indicators', severity: 'warn', description: "She's refusing video / photo / meeting in person. Possible catfish or scam.", evidence: catfish })

  const incons = detectInconsistency(herTexts)
  if (incons.length) flags.push({ code: 'inconsistent', severity: 'warn', description: 'Stated facts have changed across messages (age / city).', evidence: incons })

  const redirect: string[] = []
  for (const t of herTexts) {
    if (REDIRECT_RE.test(t)) { redirect.push(t); continue }
    const urls = t.match(URL_RE) || []
    for (const u of urls) {
      if (SCAM_DOMAINS.some((d) => u.toLowerCase().includes(d))) { redirect.push(t); break }
    }
  }
  if (redirect.length) {
    const sev: RedFlag['severity'] = redirect.some((t) => SCAM_DOMAINS.some((d) => t.toLowerCase().includes(d))) ? 'critical' : 'warn'
    flags.push({ code: 'external_redirect', severity: sev, description: 'Pushing to off-platform comm (Telegram / WhatsApp / sketchy URL).', evidence: redirect.slice(0, 3) })
  }

  const sob = herTexts.filter((t) => SOB_RE.test(t))
  if (sob.length) flags.push({ code: 'sob_story', severity: 'warn', description: 'Pity-pitch patterns common in romance scams (deceased partner, stuck abroad, sick relative, frozen account).', evidence: sob })

  flags.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  return flags
}

export function redFlagSummary(flags: RedFlag[]) {
  if (!flags.length) return { flagged: false, count: 0, max_severity: null as RedFlag['severity'] | null, flags: [] as RedFlag[] }
  const max = flags.reduce((acc, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc), 'info' as RedFlag['severity'])
  return { flagged: true, count: flags.length, max_severity: max, flags }
}
