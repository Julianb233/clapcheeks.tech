/**
 * Per-match style snapshot — used to make drafts match HER energy, not
 * just Julian's voice. Analyzes her recent inbound messages and produces
 * a short prompt fragment to inject alongside the user's voice profile.
 */

const EMOJI_RE = /\p{Extended_Pictographic}/gu

type Msg = { from?: string; text?: string; ts?: string }

export interface HerStyle {
  /** Sample size — how many of her messages we analyzed. */
  sampleSize: number
  /** avg msg length in words. */
  avgWords: number
  /** % of msgs that are entirely lowercase (signal: casual energy). */
  lowercaseRate: number
  /** % of msgs ending in '?' (signal: engaged / curious). */
  questionRate: number
  /** % of msgs ending in '!' or with an exclamation (signal: high-energy). */
  exclamationRate: number
  /** Top emojis she uses, most-frequent first (max 8). */
  topEmojis: string[]
  /** % of msgs containing at least one emoji. */
  emojiRate: number
  /** Common 1-3 word openers (lowercased), max 6. */
  topOpeners: string[]
  /** Empty if she's never replied. */
  isEmpty: boolean
}

const FILLER_OPENERS = new Set(['ok', 'okay', 'yes', 'no', 'lol', 'haha', 'k', 'yeah'])

export function analyzeHerStyle(messages: Msg[] | unknown): HerStyle {
  const empty: HerStyle = {
    sampleSize: 0,
    avgWords: 0,
    lowercaseRate: 0,
    questionRate: 0,
    exclamationRate: 0,
    topEmojis: [],
    emojiRate: 0,
    topOpeners: [],
    isEmpty: true,
  }
  if (!Array.isArray(messages)) return empty

  const hers: string[] = []
  for (const m of messages as Msg[]) {
    if (!m || typeof m !== 'object') continue
    const from = String(m.from ?? '').toLowerCase()
    if (from !== 'her' && from !== 'them' && from !== 'inbound') continue
    const t = String(m.text ?? '').trim()
    if (!t) continue
    hers.push(t)
  }
  if (hers.length === 0) return empty

  const sample = hers.slice(-50)
  const n = sample.length

  let totalWords = 0
  let lowerCount = 0
  let questionCount = 0
  let exclamCount = 0
  let emojiBearing = 0
  const emojiCounts = new Map<string, number>()
  const openerCounts = new Map<string, number>()

  for (const t of sample) {
    const words = t.split(/\s+/).filter(Boolean)
    totalWords += words.length

    if (t === t.toLowerCase() && /[a-z]/.test(t)) lowerCount += 1
    if (/\?\s*$/.test(t)) questionCount += 1
    if (/!/.test(t)) exclamCount += 1

    const emojis = t.match(EMOJI_RE) ?? []
    if (emojis.length > 0) {
      emojiBearing += 1
      for (const e of emojis) {
        emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1)
      }
    }

    const opener = words.slice(0, 2).join(' ').toLowerCase().replace(/[^\w\s]/g, '').trim()
    if (opener && opener.length >= 2 && !FILLER_OPENERS.has(opener)) {
      openerCounts.set(opener, (openerCounts.get(opener) ?? 0) + 1)
    }
  }

  const topEmojis = [...emojiCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([e]) => e)

  const topOpeners = [...openerCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([o]) => o)

  return {
    sampleSize: n,
    avgWords: Math.round((totalWords / n) * 10) / 10,
    lowercaseRate: Math.round((lowerCount / n) * 100) / 100,
    questionRate: Math.round((questionCount / n) * 100) / 100,
    exclamationRate: Math.round((exclamCount / n) * 100) / 100,
    topEmojis,
    emojiRate: Math.round((emojiBearing / n) * 100) / 100,
    topOpeners,
    isEmpty: false,
  }
}

/** Render a HerStyle into a short prompt fragment for the LLM. */
export function herStyleToPrompt(s: HerStyle, herName: string): string | null {
  if (s.isEmpty || s.sampleSize === 0) return null
  const parts: string[] = []
  parts.push(`${herName}'s style (${s.sampleSize} of her messages):`)
  parts.push(`  - typical length: ${s.avgWords} words`)
  if (s.lowercaseRate >= 0.4) parts.push(`  - mostly lowercase (${Math.round(s.lowercaseRate * 100)}%)`)
  else if (s.lowercaseRate < 0.1) parts.push(`  - usually proper-case`)
  if (s.questionRate >= 0.3) parts.push(`  - asks lots of questions (${Math.round(s.questionRate * 100)}% end in ?)`)
  if (s.exclamationRate >= 0.3) parts.push(`  - high-energy (${Math.round(s.exclamationRate * 100)}% have !)`)
  if (s.topEmojis.length > 0) {
    parts.push(`  - emojis she uses: ${s.topEmojis.slice(0, 5).join(' ')} (${Math.round(s.emojiRate * 100)}% of msgs)`)
  } else {
    parts.push(`  - rarely uses emojis`)
  }
  if (s.topOpeners.length > 0) parts.push(`  - opens with: ${s.topOpeners.slice(0, 4).join(', ')}`)

  parts.push(`\nMatch her energy. Don't over-perform if she's chill. Don't be flat if she's high-energy.`)
  return parts.join('\n')
}
