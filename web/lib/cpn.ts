/**
 * CPN — Cost Per Nut
 *
 * The only metric that matters. Calculates the TRUE all-in cost of each
 * successful outcome by factoring in money, time, and travel — not just
 * what you swiped on Tinder Gold.
 *
 * Formula:
 *   CPN = (MoneySpent + TimeCost + TravelCost) / Nuts
 *
 * Where:
 *   MoneySpent  = app subscriptions + date spending (drinks, dinner, gifts, etc.)
 *   TimeCost    = (swipingHours + messagingHours + dateHours) × hourlyRate
 *   TravelCost  = datesBooked × avgTravelCostPerDate
 *   Nuts        = user-reported count, or estimated as datesBooked × nutConversionRate
 */

// ── Defaults (user can override in settings) ────────────────────────
const DEFAULTS = {
  /** How much your time is worth per hour ($) */
  hourlyRate: 50,

  /** Estimated swipes you can do per hour on one platform */
  swipesPerHour: 300,

  /** Messages you can send/manage per hour */
  messagesPerHour: 30,

  /** Average date duration in hours (including getting ready) */
  avgDateHours: 3,

  /** Average travel cost per date (Uber, gas, parking) */
  avgTravelCostPerDate: 15,

  /**
   * If the user hasn't manually logged nuts, estimate from dates.
   * Default: ~33% of dates convert (1 in 3). Adjust based on your rizz.
   */
  nutConversionRate: 0.33,
}

// ── Input types ─────────────────────────────────────────────────────

export interface CPNInput {
  /** Total money spent on apps, dates, boosts, gifts, etc. */
  moneySpent: number

  /** Total right-swipes across all platforms */
  totalSwipes: number

  /** Total messages sent */
  totalMessagesSent: number

  /** Number of dates booked */
  datesBooked: number

  /** User-reported nut count (if they track it). null = estimate from dates. */
  nutsReported: number | null

  /** User overrides for default assumptions */
  overrides?: Partial<typeof DEFAULTS>
}

export interface CPNResult {
  /** The CPN — headline number */
  cpn: number

  /** Total all-in investment */
  totalInvestment: number

  /** Breakdown */
  breakdown: {
    moneySpent: number
    timeCost: number
    travelCost: number
    swipingHours: number
    messagingHours: number
    dateHours: number
  }

  /** Number of nuts used in calculation */
  nuts: number

  /** Whether nuts were estimated or user-reported */
  nutsEstimated: boolean

  /** Efficiency grade (S/A/B/C/D/F) */
  grade: string

  /** One-liner verdict */
  verdict: string
}

// ── Core calculation ────────────────────────────────────────────────

export function calculateCPN(input: CPNInput): CPNResult {
  const config = { ...DEFAULTS, ...input.overrides }

  // Time breakdown
  const swipingHours = input.totalSwipes / config.swipesPerHour
  const messagingHours = input.totalMessagesSent / config.messagesPerHour
  const dateHours = input.datesBooked * config.avgDateHours
  const totalHours = swipingHours + messagingHours + dateHours
  const timeCost = totalHours * config.hourlyRate

  // Travel
  const travelCost = input.datesBooked * config.avgTravelCostPerDate

  // Total investment
  const totalInvestment = input.moneySpent + timeCost + travelCost

  // Nuts
  const nutsEstimated = input.nutsReported === null || input.nutsReported === undefined
  const nuts = nutsEstimated
    ? Math.round(input.datesBooked * config.nutConversionRate)
    : input.nutsReported!

  // CPN
  const cpn = nuts > 0 ? totalInvestment / nuts : 0

  // Grade
  const grade = getGrade(cpn, nuts)
  const verdict = getVerdict(cpn, nuts)

  return {
    cpn: Math.round(cpn * 100) / 100,
    totalInvestment: Math.round(totalInvestment * 100) / 100,
    breakdown: {
      moneySpent: input.moneySpent,
      timeCost: Math.round(timeCost * 100) / 100,
      travelCost: Math.round(travelCost * 100) / 100,
      swipingHours: Math.round(swipingHours * 10) / 10,
      messagingHours: Math.round(messagingHours * 10) / 10,
      dateHours: Math.round(dateHours * 10) / 10,
    },
    nuts,
    nutsEstimated,
    grade,
    verdict,
  }
}

// ── Trend calculation (week-over-week) ──────────────────────────────

export function getCPNTrend(
  currentCPN: number,
  previousCPN: number
): { direction: 'up' | 'down' | 'same'; delta: number } {
  if (previousCPN === 0) {
    return {
      direction: currentCPN > 0 ? 'down' : 'same', // having a CPN at all is progress
      delta: 0,
    }
  }
  const pct = Math.round(((currentCPN - previousCPN) / previousCPN) * 100)
  if (Math.abs(pct) < 2) return { direction: 'same', delta: 0 }
  // NOTE: For CPN, DOWN is good (cheaper per nut), UP is bad
  return { direction: pct > 0 ? 'up' : 'down', delta: pct }
}

// ── Grading system ──────────────────────────────────────────────────

function getGrade(cpn: number, nuts: number): string {
  if (nuts === 0) return '--'
  if (cpn <= 25) return 'S'     // God tier. Under $25/nut.
  if (cpn <= 50) return 'A'     // Elite. $25-50/nut.
  if (cpn <= 100) return 'B'    // Solid. $50-100/nut.
  if (cpn <= 200) return 'C'    // Average. $100-200/nut.
  if (cpn <= 500) return 'D'    // Needs work. $200-500/nut.
  return 'F'                     // Down bad. $500+/nut.
}

function getVerdict(cpn: number, nuts: number): string {
  if (nuts === 0) return 'No data yet. Get out there.'
  if (cpn <= 25) return 'Machine-level efficiency. You barely spend anything.'
  if (cpn <= 50) return 'Elite operator. Most men wish they had your numbers.'
  if (cpn <= 100) return 'Solid game. Room to optimize but you\'re winning.'
  if (cpn <= 200) return 'Average. Time to cut the expensive dinner dates.'
  if (cpn <= 500) return 'Your wallet is hurting. Let the AI handle more.'
  return 'Down astronomical. Automate everything immediately.'
}
