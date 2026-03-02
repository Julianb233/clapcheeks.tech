export interface AnalyticsRow {
  swipes_right: number
  matches: number
  messages_sent: number
  conversations_replied: number
  dates_booked: number
}

/**
 * Rizz Score = reply_rate * 0.40 + date_conversion * 0.40 + match_rate * 0.20
 * Scaled 0-100, clamped.
 */
export function calculateRizzScore(rows: AnalyticsRow[]): number {
  const totals = rows.reduce(
    (acc, r) => ({
      swipes_right: acc.swipes_right + r.swipes_right,
      matches: acc.matches + r.matches,
      messages_sent: acc.messages_sent + r.messages_sent,
      conversations_replied: acc.conversations_replied + r.conversations_replied,
      dates_booked: acc.dates_booked + r.dates_booked,
    }),
    { swipes_right: 0, matches: 0, messages_sent: 0, conversations_replied: 0, dates_booked: 0 }
  )

  const replyRate = totals.messages_sent > 0
    ? totals.conversations_replied / totals.messages_sent
    : 0
  const dateConversion = totals.matches > 0
    ? totals.dates_booked / totals.matches
    : 0
  const matchRate = totals.swipes_right > 0
    ? totals.matches / totals.swipes_right
    : 0

  const raw = (replyRate * 0.4 + dateConversion * 0.4 + matchRate * 0.2) * 100
  return Math.round(Math.min(100, Math.max(0, raw)))
}

export type RizzTrend = { direction: 'up' | 'down' | 'same'; delta: number }

export function getRizzTrend(thisWeek: number, lastWeek: number): RizzTrend {
  const delta = thisWeek - lastWeek
  if (Math.abs(delta) < 2) return { direction: 'same', delta: 0 }
  return { direction: delta > 0 ? 'up' : 'down', delta }
}

export function getRizzColor(score: number): string {
  if (score < 40) return '#ef4444' // red
  if (score < 70) return '#eab308' // yellow
  return '#22c55e' // green
}
