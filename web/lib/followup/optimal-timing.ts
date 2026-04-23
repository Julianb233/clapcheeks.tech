/**
 * Optimal send timing for scheduled messages.
 *
 * Given a config (timezone, preferred window, quiet hours) and a target delay
 * in hours, pick an ISO datetime that:
 *   1. is at least `delayHours` away from now,
 *   2. falls inside the preferred window when possible, and
 *   3. never lands inside quiet hours.
 *
 * Deterministic — no randomness — so the approval queue is reproducible.
 */

export type OptimalTimingConfig = {
  timezone: string
  optimal_send_start_hour: number
  optimal_send_end_hour: number
  quiet_hours_start: number
  quiet_hours_end: number
}

const DEFAULT_CONFIG: OptimalTimingConfig = {
  timezone: 'America/Los_Angeles',
  optimal_send_start_hour: 18,
  optimal_send_end_hour: 21,
  quiet_hours_start: 23,
  quiet_hours_end: 8,
}

function localHour(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date)
  const hourPart = parts.find(p => p.type === 'hour')
  return hourPart ? parseInt(hourPart.value, 10) % 24 : date.getUTCHours()
}

function isInRange(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  // wraps midnight
  return hour >= start || hour < end
}

/**
 * Advance a date by whole hours.
 */
function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3600_000)
}

/**
 * Move `candidate` forward until it sits inside [startHour, endHour) in the
 * configured timezone. Stops after 48 iterations so we can never loop forever.
 */
function slideIntoWindow(
  candidate: Date,
  timezone: string,
  startHour: number,
  endHour: number,
): Date {
  let cursor = candidate
  for (let i = 0; i < 48; i++) {
    const h = localHour(cursor, timezone)
    if (isInRange(h, startHour, endHour)) return cursor
    cursor = addHours(cursor, 1)
  }
  return cursor
}

/**
 * Pick the next time inside the preferred window that is NOT inside quiet
 * hours. `delayHours` is the minimum offset from now.
 */
export function pickOptimalSendTime(
  delayHours: number,
  config: Partial<OptimalTimingConfig> = {},
  now: Date = new Date(),
): Date {
  const c = { ...DEFAULT_CONFIG, ...config }
  const earliest = addHours(now, Math.max(0, delayHours))

  // 1. slide into preferred window
  let picked = slideIntoWindow(
    earliest,
    c.timezone,
    c.optimal_send_start_hour,
    c.optimal_send_end_hour,
  )

  // 2. if landed in quiet hours, push past quiet window
  for (let i = 0; i < 48; i++) {
    const h = localHour(picked, c.timezone)
    if (!isInRange(h, c.quiet_hours_start, c.quiet_hours_end)) break
    picked = addHours(picked, 1)
  }

  // 3. final sanity check — if still outside preferred window, re-slide
  const finalHour = localHour(picked, c.timezone)
  if (!isInRange(finalHour, c.optimal_send_start_hour, c.optimal_send_end_hour)) {
    picked = slideIntoWindow(
      picked,
      c.timezone,
      c.optimal_send_start_hour,
      c.optimal_send_end_hour,
    )
  }

  return picked
}

/**
 * Convenience wrapper that returns an ISO string.
 */
export function pickOptimalSendTimeISO(
  delayHours: number,
  config: Partial<OptimalTimingConfig> = {},
  now: Date = new Date(),
): string {
  return pickOptimalSendTime(delayHours, config, now).toISOString()
}
