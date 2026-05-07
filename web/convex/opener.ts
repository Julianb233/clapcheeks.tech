/**
 * AI-9500 #8 — Opener A/B engine stubs.
 *
 * Full implementation tracked separately. These stubs satisfy the cron
 * scheduler references in crons.ts until the full opener module ships.
 */

import { internalMutation } from "./_generated/server";

// Scans opener_experiments rows older than 7 days and marks ghosted
// if no positive outcome recorded.
export const _markGhostedExperiments = internalMutation({
  args: {},
  handler: async (_ctx) => {
    // Stub — full implementation pending AI-9500 #8 opener module.
    return { processed: 0 };
  },
});

// Recomputes per-archetype winners from opener_experiments data.
export const _recomputeArchetypeWinners = internalMutation({
  args: {},
  handler: async (_ctx) => {
    // Stub — full implementation pending AI-9500 #8 opener module.
    return { updated: 0 };
  },
});
