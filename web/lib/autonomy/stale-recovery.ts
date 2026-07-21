// AI-8329 Phase 44 — AUTO-04: Stale conversation recovery.
//
// Finds conversations that have gone quiet and recommends what to do about
// each: re-engage, send a final bump, or mark dead. Complements the existing
// drip/followup engine — this is the "the operator went hands-off, don't let
// warm leads rot" safety net.
//
// Idle time is measured from the most recent activity we have (last inbound,
// last outbound, or last message), whichever is newest, so a conversation the
// operator just re-opened isn't flagged.

import type {
  StaleCandidate,
  StaleConfig,
  StaleConversation,
} from "./types";

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_STALE_CONFIG: StaleConfig = {
  staleAfterMs: 2 * DAY, // quiet 2 days -> worth a nudge
  deadAfterMs: 10 * DAY, // quiet 10 days -> stop chasing
};

/** Statuses that are terminal / not worth re-engaging. */
const SKIP_STATUSES = new Set(["ended", "dating", "ghosted"]);

function lastActivity(c: StaleConversation): number {
  return Math.max(
    c.last_inbound_at ?? 0,
    c.last_outbound_at ?? 0,
    c.last_message_at ?? 0,
  );
}

export function findStaleConversations(
  conversations: StaleConversation[],
  now: number,
  config: StaleConfig = DEFAULT_STALE_CONFIG,
): StaleCandidate[] {
  const out: StaleCandidate[] = [];

  for (const c of conversations) {
    if (SKIP_STATUSES.has(c.status)) continue;
    const last = lastActivity(c);
    if (last <= 0) continue; // never had activity — nothing to recover
    const idleMs = now - last;
    if (idleMs < config.staleAfterMs) continue;

    let urgency: StaleCandidate["urgency"];
    let recommendation: StaleCandidate["recommendation"];
    if (idleMs >= config.deadAfterMs) {
      urgency = "low";
      recommendation = "mark_dead";
    } else if (idleMs >= (config.staleAfterMs + config.deadAfterMs) / 2) {
      urgency = "high";
      recommendation = "final_bump";
    } else {
      urgency = "medium";
      recommendation = "reengage";
    }

    out.push({
      id: c.id,
      match_name: c.match_name,
      platform: c.platform,
      idleMs,
      urgency,
      recommendation,
    });
  }

  // Most idle (but still recoverable) first: final_bump/reengage before dead,
  // then by idle time descending.
  const rank: Record<StaleCandidate["recommendation"], number> = {
    final_bump: 0,
    reengage: 1,
    mark_dead: 2,
  };
  out.sort((a, b) => {
    if (rank[a.recommendation] !== rank[b.recommendation]) {
      return rank[a.recommendation] - rank[b.recommendation];
    }
    return b.idleMs - a.idleMs;
  });

  return out;
}
