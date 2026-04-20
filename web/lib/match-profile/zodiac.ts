/**
 * Zodiac calculation engine — sign from birthday, cusp detection,
 * traits, and compatibility scoring for all 144 pairings.
 */

export type ZodiacSign =
  | 'Aries' | 'Taurus' | 'Gemini' | 'Cancer'
  | 'Leo' | 'Virgo' | 'Libra' | 'Scorpio'
  | 'Sagittarius' | 'Capricorn' | 'Aquarius' | 'Pisces'

export interface ZodiacResult {
  sign: ZodiacSign
  cusp: string | null
  element: 'Fire' | 'Earth' | 'Air' | 'Water'
  modality: 'Cardinal' | 'Fixed' | 'Mutable'
  traits: string
  emoji: string
}

export interface CompatibilityResult {
  score: number
  level: 'Low' | 'Medium' | 'High' | 'Very High'
  description: string
  strengths: string[]
  challenges: string[]
}

const SIGN_RANGES: Array<{ sign: ZodiacSign; start: [number, number]; end: [number, number] }> = [
  { sign: 'Capricorn',   start: [12, 22], end: [1, 19] },
  { sign: 'Aquarius',    start: [1, 20],  end: [2, 18] },
  { sign: 'Pisces',      start: [2, 19],  end: [3, 20] },
  { sign: 'Aries',       start: [3, 21],  end: [4, 19] },
  { sign: 'Taurus',      start: [4, 20],  end: [5, 20] },
  { sign: 'Gemini',      start: [5, 21],  end: [6, 20] },
  { sign: 'Cancer',      start: [6, 21],  end: [7, 22] },
  { sign: 'Leo',         start: [7, 23],  end: [8, 22] },
  { sign: 'Virgo',       start: [8, 23],  end: [9, 22] },
  { sign: 'Libra',       start: [9, 23],  end: [10, 22] },
  { sign: 'Scorpio',     start: [10, 23], end: [11, 21] },
  { sign: 'Sagittarius', start: [11, 22], end: [12, 21] },
]

export const SIGN_ORDER: ZodiacSign[] = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
]

export const ELEMENTS: Record<ZodiacSign, 'Fire' | 'Earth' | 'Air' | 'Water'> = {
  Aries: 'Fire', Taurus: 'Earth', Gemini: 'Air', Cancer: 'Water',
  Leo: 'Fire', Virgo: 'Earth', Libra: 'Air', Scorpio: 'Water',
  Sagittarius: 'Fire', Capricorn: 'Earth', Aquarius: 'Air', Pisces: 'Water',
}

export const MODALITIES: Record<ZodiacSign, 'Cardinal' | 'Fixed' | 'Mutable'> = {
  Aries: 'Cardinal', Taurus: 'Fixed', Gemini: 'Mutable', Cancer: 'Cardinal',
  Leo: 'Fixed', Virgo: 'Mutable', Libra: 'Cardinal', Scorpio: 'Fixed',
  Sagittarius: 'Mutable', Capricorn: 'Cardinal', Aquarius: 'Fixed', Pisces: 'Mutable',
}

export const EMOJIS: Record<ZodiacSign, string> = {
  Aries: '\u2648', Taurus: '\u2649', Gemini: '\u264A', Cancer: '\u264B',
  Leo: '\u264C', Virgo: '\u264D', Libra: '\u264E', Scorpio: '\u264F',
  Sagittarius: '\u2650', Capricorn: '\u2651', Aquarius: '\u2652', Pisces: '\u2653',
}

export const TRAITS: Record<ZodiacSign, string> = {
  Aries:       'Direct, competitive, bold — responds to confidence and a little challenge',
  Taurus:      'Sensual, steady, values craft and comfort — lead with taste and specificity',
  Gemini:      'Quick-witted, loves banter and ideas — match her tempo, keep it playful',
  Cancer:      'Warm, protective, emotionally present — be sincere, ask meaningful questions',
  Leo:         'Wants to feel seen and celebrated — sincere compliments land, not flattery',
  Virgo:       'Precise, funny in a dry way, observant — small details win',
  Libra:       'Social, aesthetic, dislikes conflict — lean charming, avoid heavy topics early',
  Scorpio:     'Intense, reads subtext, values depth — be direct, mean what you say',
  Sagittarius: 'Adventurous, hates small talk — propose experiences, reference travel/stories',
  Capricorn:   'Ambitious, dry humor, respects follow-through — confidence + a clear plan',
  Aquarius:    'Independent, cerebral, original — bring ideas, skip the generic openers',
  Pisces:      'Dreamy, empathetic, artsy — emotional resonance over logic, soft landing',
}

export function signFromBirthday(birthday: string | Date | null | undefined): ZodiacResult | null {
  if (!birthday) return null
  let d: Date
  if (birthday instanceof Date) { d = birthday } else { d = new Date(birthday); if (isNaN(d.getTime())) return null }
  const month = d.getMonth() + 1, day = d.getDate()
  let matchedSign: ZodiacSign | null = null
  for (const { sign, start, end } of SIGN_RANGES) {
    if (sign === 'Capricorn') {
      if ((month === start[0] && day >= start[1]) || (month === end[0] && day <= end[1])) { matchedSign = sign; break }
    } else {
      if ((month === start[0] && day >= start[1]) || (month === end[0] && day <= end[1]) || (month > start[0] && month < end[0])) { matchedSign = sign; break }
    }
  }
  if (!matchedSign) return null
  const cusp = detectCusp(month, day, matchedSign)
  return { sign: matchedSign, cusp, element: ELEMENTS[matchedSign], modality: MODALITIES[matchedSign], traits: TRAITS[matchedSign], emoji: EMOJIS[matchedSign] }
}

function detectCusp(month: number, day: number, sign: ZodiacSign): string | null {
  const idx = SIGN_ORDER.indexOf(sign)
  const prevSign = SIGN_ORDER[(idx - 1 + 12) % 12]
  const nextSign = SIGN_ORDER[(idx + 1) % 12]
  const range = SIGN_RANGES.find(r => r.sign === sign)
  if (!range) return null
  const [startM, startD] = range.start
  const [endM, endD] = range.end
  if (month === startM && day >= startD && day <= startD + 1) return `${prevSign}-${sign}`
  if (month === endM && day >= endD - 1 && day <= endD) return `${sign}-${nextSign}`
  return null
}

export function signFromText(text: string | null | undefined): ZodiacSign | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const sign of SIGN_ORDER) { if (lower.includes(sign.toLowerCase())) return sign }
  for (const [sign, emoji] of Object.entries(EMOJIS)) { if (text.includes(emoji)) return sign as ZodiacSign }
  return null
}

// Compatibility matrix builder
function compatKey(s1: ZodiacSign, s2: ZodiacSign): string { return [s1, s2].sort().join('-') }

const COMPAT_MATRIX: Record<string, { score: number; desc: string; strengths: string[]; challenges: string[] }> = (() => {
  const m: Record<string, { score: number; desc: string; strengths: string[]; challenges: string[] }> = {}
  for (const s1 of SIGN_ORDER) {
    for (const s2 of SIGN_ORDER) {
      const key = compatKey(s1, s2)
      if (m[key]) continue
      const i1 = SIGN_ORDER.indexOf(s1), i2 = SIGN_ORDER.indexOf(s2)
      const gap = Math.abs(i1 - i2), angle = Math.min(gap, 12 - gap)
      const e1 = ELEMENTS[s1], e2 = ELEMENTS[s2]
      const m1 = MODALITIES[s1], m2 = MODALITIES[s2]
      let score: number; let desc: string; const strengths: string[] = []; const challenges: string[] = []
      if (s1 === s2) { score = 7; desc = `Two ${s1}s understand each other deeply`; strengths.push('Instant understanding', 'Shared values'); challenges.push('May amplify blind spots') }
      else if (angle === 4) { score = 8.5; desc = `${e1} meets ${e2} — natural harmony`; strengths.push('Effortless connection', 'Same element energy'); challenges.push('May get too comfortable') }
      else if (angle === 2) { score = 7.5; desc = `Easy rapport with enough difference to stay interesting`; strengths.push('Good communication', 'Complementary skills'); challenges.push('May need effort for deeper bond') }
      else if (angle === 6) { score = 6; desc = `Magnetic attraction with push-pull tension`; strengths.push('Strong attraction', 'Growth potential'); challenges.push('Power struggles', 'Needs compromise') }
      else if (angle === 3) { score = 4.5; desc = `Friction that can spark growth or conflict`; strengths.push('Dynamic energy'); challenges.push('Frequent clashes', 'Different priorities') }
      else if (angle === 1) { score = 5.5; desc = `Neighbors on the wheel, different approaches`; strengths.push('Learning from each other'); challenges.push('Different communication styles') }
      else if (angle === 5) { score = 5; desc = `Unexpected combo that needs adjustment`; strengths.push('Unique perspective'); challenges.push('Fundamental differences') }
      else { score = 6; desc = `Moderate compatibility`; strengths.push('Some common ground'); challenges.push('May require effort') }
      if (e1 === e2 && s1 !== s2) { score = Math.min(10, score + 0.5); strengths.push(`Both ${e1} signs`) }
      if ((e1 === 'Fire' && e2 === 'Air') || (e1 === 'Air' && e2 === 'Fire') || (e1 === 'Earth' && e2 === 'Water') || (e1 === 'Water' && e2 === 'Earth')) score = Math.min(10, score + 0.5)
      if ((e1 === 'Fire' && e2 === 'Water') || (e1 === 'Water' && e2 === 'Fire')) { score = Math.max(1, score - 0.5); challenges.push('Fire-Water tension') }
      if (m1 !== m2 && angle !== 3) score = Math.min(10, score + 0.3)
      score = Math.round(score * 10) / 10
      m[key] = { score, desc, strengths, challenges }
    }
  }
  return m
})()

export function getCompatibility(sign1: ZodiacSign, sign2: ZodiacSign): CompatibilityResult {
  const entry = COMPAT_MATRIX[compatKey(sign1, sign2)]
  if (!entry) return { score: 5, level: 'Medium', description: 'Data not available', strengths: [], challenges: [] }
  const level: CompatibilityResult['level'] = entry.score >= 8 ? 'Very High' : entry.score >= 6.5 ? 'High' : entry.score >= 4.5 ? 'Medium' : 'Low'
  return { score: entry.score, level, description: entry.desc, strengths: entry.strengths, challenges: entry.challenges }
}

export function getZodiacProfile(birthday: string | Date | null | undefined, userSign?: ZodiacSign | null) {
  const result = signFromBirthday(birthday)
  if (!result) return null
  if (userSign) return { ...result, compatibility: getCompatibility(result.sign, userSign) }
  return result
}
