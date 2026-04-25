/**
 * Pull Instagram handles out of free-text messages.
 *
 * Matches she sends in plain text:
 *   "@sarahlovesyoga"
 *   "my ig is sarahlovesyoga"
 *   "find me on insta @sarahlovesyoga"
 *   "instagram.com/sarahlovesyoga"
 *   "https://www.instagram.com/sarahlovesyoga/"
 *   "yea its sarahlovesyoga lol on ig"
 *
 * Returns deduped list of candidate handles in confidence order.
 * Filter rules:
 *  - 1-30 chars, [a-z0-9._]
 *  - Cannot start/end with a period, no double-periods
 *  - Drops obviously-generic words ("yes", "no", "ok", emails, URLs unrelated)
 */

// @username — must be preceded by whitespace/start AND followed by word boundary.
const IG_USERNAME_RE = /(?:^|[\s.,!?:;])@([a-z0-9_][a-z0-9._]{1,28}[a-z0-9_])(?=[\s.,!?:;]|$)/gi
// instagram.com/username
const IG_URL_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-z0-9_][a-z0-9._]{1,28}[a-z0-9_])/gi
// "my ig is X" / "ig: X" / "instagram is X" — REQUIRES the connector
// (is/:/=) so we don't match "ig" as a noun in the middle of a sentence.
const IG_PHRASE_RE = /\b(?:my\s+)?(?:ig|insta(?:gram)?)(?:\s+(?:handle|username|name))?\s*(?:is|:|=|->)\s*@?([a-z0-9_][a-z0-9._]{1,28}[a-z0-9_])\b/gi
// "find me on ig X" / "follow me on insta @X" / "dm me on insta X"
const IG_FIND_ME_RE = /\b(?:find|follow|add|dm)\s+me\s+(?:on\s+)?(?:ig|insta(?:gram)?)\s*(?:@|at|:)?\s*([a-z0-9_][a-z0-9._]{1,28}[a-z0-9_])\b/gi
// "it's @X on ig" — handle followed by "on ig/insta" (stronger than bare @)
const IG_TRAILING_RE = /(?:^|[\s.,])@?([a-z0-9_][a-z0-9._]{1,28}[a-z0-9_])\s+on\s+(?:ig|insta(?:gram)?)\b/gi

const FALSE_POSITIVES = new Set([
  // common short replies that look like handles
  'yes', 'no', 'ok', 'okay', 'yeah', 'sure', 'maybe', 'lol', 'lmao', 'haha',
  'hahaha', 'omg', 'wtf', 'idk', 'me', 'you', 'him', 'her', 'us', 'we',
  'this', 'that', 'one', 'two', 'three', 'first', 'last', 'next',
  // mail providers
  'gmail', 'hotmail', 'yahoo', 'outlook', 'icloud',
  // url chunks
  'http', 'https', 'www', 'com', 'org', 'net',
  // platform names that get caught as bare words
  'ig', 'insta', 'gram', 'instagram', 'facebook', 'fb', 'twitter', 'tiktok', 'snap', 'snapchat',
  // generic everyday words / slang that pass the [a-z]+ filter
  'good', 'great', 'nice', 'cool', 'sweet', 'sounds', 'works', 'sure',
  'today', 'tomorrow', 'tonight', 'morning', 'night', 'weekend',
  'lit', 'fire', 'dope', 'mood', 'vibe', 'fr', 'bet', 'bruh',
  'bae', 'bro', 'sis', 'fam', 'tbh', 'imo', 'imho', 'ily',
  'hot', 'cute', 'pretty', 'fine', 'good', 'bad',
])

function isValidHandle(raw: string): boolean {
  if (!raw) return false
  const h = raw.toLowerCase()
  if (h.length < 2 || h.length > 30) return false
  if (h.startsWith('.') || h.endsWith('.')) return false
  if (h.includes('..')) return false
  if (FALSE_POSITIVES.has(h)) return false
  // Must contain at least one letter (drop pure-numeric like "12345")
  if (!/[a-z]/.test(h)) return false
  return true
}

export interface InstagramExtraction {
  handle: string
  source: 'url' | 'at_mention' | 'phrase' | 'find_me'
  confidence: number  // 0-1
  matched_text: string
}

export function extractInstagramHandles(text: string): InstagramExtraction[] {
  if (!text) return []
  const found: InstagramExtraction[] = []
  const seen = new Set<string>()

  function add(handle: string, source: InstagramExtraction['source'], confidence: number, matched: string) {
    const h = handle.toLowerCase().trim()
    if (!isValidHandle(h)) return
    if (seen.has(h)) {
      // Bump confidence if we hit the same handle from multiple sources
      const existing = found.find(f => f.handle === h)
      if (existing) existing.confidence = Math.max(existing.confidence, confidence)
      return
    }
    seen.add(h)
    found.push({ handle: h, source, confidence, matched_text: matched })
  }

  // 1. Full IG URLs are highest confidence
  for (const m of text.matchAll(IG_URL_RE)) {
    add(m[1], 'url', 0.98, m[0])
  }

  // 2. "find me on ig @x" / "follow me on insta x"
  for (const m of text.matchAll(IG_FIND_ME_RE)) {
    add(m[1], 'find_me', 0.92, m[0])
  }

  // 3. "my ig is x" / "instagram: x"
  for (const m of text.matchAll(IG_PHRASE_RE)) {
    add(m[1], 'phrase', 0.88, m[0])
  }

  // 4. "X on ig" trailing pattern
  for (const m of text.matchAll(IG_TRAILING_RE)) {
    add(m[1], 'phrase', 0.85, m[0])
  }

  // 5. Bare @mentions (lowest confidence — could be a tweet handle, etc.)
  // Only honor these if context suggests IG (mentions of "ig" / "insta" /
  // "instagram" anywhere in the message).
  const hasIgContext = /\b(ig|insta(?:gram)?|gram)\b/i.test(text)
  if (hasIgContext) {
    for (const m of text.matchAll(IG_USERNAME_RE)) {
      add(m[1], 'at_mention', 0.70, m[0])
    }
  }

  // Sort by confidence desc, then by length desc (longer = usually more specific)
  found.sort((a, b) => b.confidence - a.confidence || b.handle.length - a.handle.length)
  return found
}

/**
 * Walk a JSONB messages array and find the best IG handle she mentioned.
 * Skips outbound messages (from === 'him').
 *
 * Context-aware: if Julian asked for her insta in his message right before
 * her reply, even a bare @handle in her reply gets honored (because the
 * conversation context makes it unambiguous).
 */
export function findHandleInMessages(messages: unknown): InstagramExtraction | null {
  if (!Array.isArray(messages)) return null
  let best: InstagramExtraction | null = null
  let priorIgContext = false  // sticky window — once Julian asks, next reply gets the boost

  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    const msg = m as Record<string, unknown>
    const from = (msg.from ?? msg.sender ?? '') as string
    const text = (msg.text ?? msg.body ?? msg.content ?? '') as string
    if (!text) continue

    // Outbound: detect IG-asking and set sticky context for the next inbound.
    if (from === 'him' || from === 'me' || from === 'self') {
      if (/\b(?:what(?:'?s)?|do\s+you\s+have|drop|share|send|whats)\s+(?:your\s+)?(?:ig|insta(?:gram)?|gram)\b/i.test(text)
          || /\b(?:can\s+i\s+have|gimme|give\s+me)\s+(?:your\s+)?(?:ig|insta(?:gram)?|gram)\b/i.test(text)) {
        priorIgContext = true
      }
      continue
    }

    // Inbound: parse normally. If Julian just asked, also try a context-relaxed parse.
    const found = extractInstagramHandles(text)
    if (found.length > 0) {
      for (const f of found) {
        if (!best || f.confidence > best.confidence) best = f
      }
      priorIgContext = false  // context consumed
      continue
    }

    if (priorIgContext) {
      // Try a permissive bare-@ scan since Julian's prior message established context.
      const bare = text.match(/@([a-z0-9_][a-z0-9._]{1,28}[a-z0-9_])\b/i)
      if (bare && isValidHandle(bare[1])) {
        const f: InstagramExtraction = {
          handle: bare[1].toLowerCase(),
          source: 'at_mention',
          confidence: 0.80,  // higher than bare @ in isolation because we know he asked
          matched_text: bare[0],
        }
        if (!best || f.confidence > best.confidence) best = f
        priorIgContext = false
      }
    }
  }
  return best
}
