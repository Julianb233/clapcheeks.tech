/**
 * Lightweight scoring helper used by the flake/reschedule API routes to
 * recompute close_probability + health_score on the fly. The python coach
 * has its own richer scorer; this is the on-demand bump that fires the
 * moment Julian logs an event so the UI reflects reality immediately.
 */

export interface MatchScoreInput {
  // Pulled from the match row at time of recompute.
  flake_count: number
  reschedule_count: number
  messages_total: number
  messages_7d: number
  his_to_her_ratio: number | null
  avg_reply_hours: number | null
  time_to_date_days: number | null
  sentiment_trajectory: 'positive' | 'neutral' | 'negative' | null
  stage: string | null
  // Existing values — used as the floor when applying penalties so a
  // single signal can't tank her completely.
  current_close_probability: number | null
  current_health_score: number | null
}

export interface MatchScoreOutput {
  close_probability: number
  health_score: number
  reason: string
}

const STAGE_BASE: Record<string, number> = {
  new_match: 0.30,
  chatting: 0.45,
  chatting_phone: 0.60,
  date_proposed: 0.65,
  date_booked: 0.75,
  date_attended: 0.80,
  hooked_up: 0.85,
  recurring: 0.90,
  faded: 0.10,
  ghosted: 0.05,
  archived: 0.02,
  archived_cluster_dupe: 0.02,
}

export function recomputeScore(i: MatchScoreInput): MatchScoreOutput {
  // Start from the stage base — that's the dominant signal.
  let cp = STAGE_BASE[i.stage ?? 'new_match'] ?? 0.30
  const reasons: string[] = [`stage(${i.stage ?? 'new_match'})=${cp.toFixed(2)}`]

  // Engagement boost: real back-and-forth signals interest.
  if (i.messages_7d >= 10) {
    cp += 0.10
    reasons.push('engaged 7d (+0.10)')
  } else if (i.messages_7d >= 3) {
    cp += 0.05
    reasons.push('chatting 7d (+0.05)')
  }

  // Reply-pace boost: she replies fast → high interest.
  if (i.avg_reply_hours != null && i.avg_reply_hours < 2 && i.messages_total >= 10) {
    cp += 0.05
    reasons.push('fast reply (+0.05)')
  }

  // Ratio sanity: > 1.5x his-to-her means he's chasing — penalty.
  if (i.his_to_her_ratio != null && i.his_to_her_ratio > 1.5) {
    cp -= 0.08
    reasons.push(`chasing ${i.his_to_her_ratio.toFixed(1)}× (-0.08)`)
  }

  // Flake penalty — escalating. 1st flake is forgivable, 2nd is real, 3rd is over.
  const flakes = Math.max(0, i.flake_count)
  if (flakes === 1) {
    cp -= 0.15
    reasons.push('1× flake (-0.15)')
  } else if (flakes === 2) {
    cp -= 0.30
    reasons.push('2× flake (-0.30)')
  } else if (flakes >= 3) {
    cp = Math.min(cp, 0.10) // hard ceiling
    reasons.push(`${flakes}× flake → ceiling 0.10`)
  }

  // Reschedule penalty — softer than flakes but stacks.
  const resch = Math.max(0, i.reschedule_count)
  if (resch >= 1) {
    const hit = Math.min(0.04 * resch, 0.20)
    cp -= hit
    reasons.push(`${resch}× resched (-${hit.toFixed(2)})`)
  }

  // Sentiment trajectory hard cap on the negative side.
  if (i.sentiment_trajectory === 'negative') {
    cp = Math.min(cp, 0.30)
    reasons.push('negative trajectory ≤0.30')
  }

  // Time-to-date sanity: 0-21 days is healthy. Beyond 30, decay.
  if (i.time_to_date_days != null && i.time_to_date_days > 30) {
    cp -= 0.10
    reasons.push('slow-walk >30d (-0.10)')
  }

  // Clamp.
  cp = Math.max(0, Math.min(1, cp))

  // Health score is a fast-decaying signal: how warm is the thread RIGHT NOW.
  // 0-100 scale. Mostly driven by recency + flake/resched + reply pace.
  let hs = i.current_health_score ?? 70
  // Strong floor based on flake count.
  if (flakes >= 3) hs = Math.min(hs, 10)
  else if (flakes === 2) hs = Math.min(hs, 35)
  else if (flakes === 1) hs = Math.min(hs, 55)
  // Reschedules trim 5 each.
  hs -= resch * 5
  // Stage bonuses.
  if (i.stage === 'recurring' || i.stage === 'date_booked') hs = Math.max(hs, 80)
  if (i.stage === 'faded') hs = Math.min(hs, 30)
  if (i.stage === 'ghosted') hs = Math.min(hs, 10)
  hs = Math.max(0, Math.min(100, Math.round(hs)))

  return {
    close_probability: Number(cp.toFixed(3)),
    health_score: hs,
    reason: reasons.join(' · '),
  }
}
