import { internalAction, internalQuery } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";

// AI-9449 — Enrichment sweeps: courtship intelligence, fatigue detection.
//
// All functions here are internalAction (not exposed to clients) so they can
// issue Convex queries + mutations safely from within server-side logic.
//
// Linear: AI-9449 / AI-9500-F (conversation-fatigue + pattern-interrupt scheduler)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ms in 3 days — silence threshold for fatigue detection */
const SILENCE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

/** Minimum engagement slope to consider "declining". Negative means declining.
 *  Units: engagement_score (0-1) change per message position (1-5). */
const FATIGUE_SLOPE_THRESHOLD = -0.05;

/** How far back (ms) to look for "CC TECH" people whose last inbound was silent */
const SWEEP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// DISC → sub-style mapping
// ---------------------------------------------------------------------------
// Pattern-interrupt sub-styles and when to use them:
//
//  callback          — references something she said earlier; universal safe choice.
//                      Best for: neutral/unknown DISC, ongoing/pre_date stage.
//  meme_reference    — playful, culture-hook; re-establishes fun vibe.
//                      Best for: high-I (Influence), early_chat / phone_swap stage.
//  low_pressure_check_in — super-soft, gives her an easy on-ramp back.
//                      Best for: high-S (Steadiness), ghosted/dormant, sensitive stage.
//  bold_direct       — direct, confident re-opener; slight challenge energy.
//                      Best for: high-D (Dominance), first_date_done / ongoing.
//  seasonal_hook     — ties into a current season, event, or holiday; feels timely.
//                      Best for: high-C (Conscientiousness), cold/cool conversations.
//
// DISC primary codes: D=Dominance, I=Influence, S=Steadiness, C=Conscientiousness

const SUBSTYLE_BY_DISC: Record<string, string> = {
  D: "bold_direct",
  I: "meme_reference",
  S: "low_pressure_check_in",
  C: "seasonal_hook",
};

/** Courtship-stage override — some stages call for a specific style
 *  regardless of DISC. These take priority over the DISC map. */
const SUBSTYLE_BY_STAGE: Record<string, string> = {
  ghosted: "low_pressure_check_in",
  ended:   "low_pressure_check_in",
  matched: "meme_reference",          // early low-stakes re-opener
};

/**
 * Determine the best pattern-interrupt sub-style for a person.
 *
 * Resolution order:
 *   1. courtship_stage override (ghosted/ended/matched → fixed style)
 *   2. disc_primary → DISC map
 *   3. disc_inference field (optional, string like "D/I" or "I")
 *   4. default → "callback"
 */
function _pickSubstyle(person: Record<string, unknown>): string {
  const stage = (person.courtship_stage as string | undefined) ?? "";
  if (stage in SUBSTYLE_BY_STAGE) {
    return SUBSTYLE_BY_STAGE[stage]!;
  }

  // DISC primary from operator-set or inferred field
  const disc =
    (person.disc_primary as string | undefined) ||
    (person.disc_inference as string | undefined) || "";
  const discUpper = disc.toUpperCase().trim();

  // Handle composite "D/I" → take first letter
  const primary = discUpper.length > 0 ? discUpper[0]! : "";
  if (primary in SUBSTYLE_BY_DISC) {
    return SUBSTYLE_BY_DISC[primary]!;
  }

  return "callback";
}

// ---------------------------------------------------------------------------
// Linear slope computation
// ---------------------------------------------------------------------------

/**
 * Fit a simple linear slope on `y` values (one per index 0..N-1).
 * Uses least-squares regression.
 * Returns the slope (dy/d_position). Negative = declining.
 *
 * With N=5 and positions 0-4 this is very fast — no library needed.
 */
function _linearSlope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const xs = y.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - xMean) * (y[i]! - yMean);
    den += (xs[i]! - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// ---------------------------------------------------------------------------
// sweepFatigueDetection
// ---------------------------------------------------------------------------

/**
 * AI-9500-F — Conversation-fatigue detection sweep.
 *
 * Scans the `people` table for CC TECH members who:
 *   (a) have been silent for >3 days (last_inbound_at older than now − 3d), AND
 *   (b) show a declining engagement trend over their last 5 messages
 *       (linear slope of engagement_score < FATIGUE_SLOPE_THRESHOLD), OR
 *       their last 5 messages have declining word-count if engagement_score is unset.
 *
 * For each qualifying person, enqueues an agent_job of type `send_imessage`
 * with prompt_template=pattern_interrupt and the sub-style chosen by
 * _pickSubstyle(). Skips persons that already have a pending `send_imessage`
 * agent_job in the queue (anti-spam).
 *
 * Runs every 12h via crons.ts.
 */
export const sweepFatigueDetection = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    scanned: number;
    qualified: number;
    scheduled: number;
    skipped_pending: number;
  }> => {
    const now = Date.now();
    const silenceCutoff = now - SILENCE_THRESHOLD_MS;
    const lookbackCutoff = now - SWEEP_LOOKBACK_MS;

    // Collect all "active" / "paused" people (skip ghosted/ended who are terminal).
    // We filter CC TECH membership in-loop since Convex can't filter inside arrays.
    const people = await ctx.runQuery(internal.enrichment._listPeopleForFatigueSweep, {
      lookback_cutoff: lookbackCutoff,
    });

    let scanned = 0;
    let qualified = 0;
    let scheduled = 0;
    let skippedPending = 0;

    for (const person of people) {
      scanned++;

      // 1. Must be a CC TECH member.
      const labels: string[] = (person.google_contacts_labels as string[] | undefined) ?? [];
      if (!labels.includes("CC TECH")) {
        continue;
      }

      // 2. Must be silent > 3d.
      const lastInbound = (person.last_inbound_at as number | undefined) ?? 0;
      if (lastInbound > silenceCutoff) {
        // Inbound is recent enough — not fatigued yet.
        continue;
      }

      // 3. Compute engagement slope over last 5 messages.
      const personId = person._id as string;
      const recentMsgs = await ctx.runQuery(
        internal.enrichment._recentMessagesForPerson,
        { person_id: personId, limit: 5 },
      );

      if (recentMsgs.length < 2) {
        // Not enough history to compute slope — still check plain silence criterion.
        // 5+ days of silence (stricter) counts even without slope.
        const EXTENDED_SILENCE_MS = 5 * 24 * 60 * 60 * 1000;
        if (lastInbound > now - EXTENDED_SILENCE_MS) {
          continue;
        }
        // Falls through to scheduling.
      } else {
        // Build the y-series: prefer engagement_score, fall back to word count.
        const ySeries = recentMsgs.map((m) => {
          const es = m.engagement_score as number | undefined;
          if (es != null && es >= 0) return es;
          const body = (m.body as string | undefined) ?? "";
          return body.trim().split(/\s+/).filter(Boolean).length;
        });
        // Normalise word counts to [0,1] range so slope threshold is comparable.
        const useEngagement = recentMsgs.some(
          (m) => (m.engagement_score as number | undefined) != null,
        );
        let yNorm = ySeries;
        if (!useEngagement) {
          const maxLen = Math.max(...ySeries, 1);
          yNorm = ySeries.map((v) => v / maxLen);
        }
        const slope = _linearSlope(yNorm);
        if (slope >= FATIGUE_SLOPE_THRESHOLD) {
          // Trending flat or positive — conversation is healthy.
          continue;
        }
      }

      // 4. Skip if a pending touch (agent_job) already exists for this person.
      const hasPending = await ctx.runQuery(
        internal.enrichment._hasPendingTouchForPerson,
        { person_id: personId },
      );
      if (hasPending) {
        skippedPending++;
        continue;
      }

      // 5. Pick the sub-style and enqueue.
      qualified++;
      const substyle = _pickSubstyle(person as Record<string, unknown>);

      await ctx.runMutation(api.agent_jobs.enqueue, {
        user_id: person.user_id as string,
        job_type: "send_imessage",
        payload: {
          person_id: personId,
          prompt_template: "pattern_interrupt",
          template_id: substyle,        // sub-style selection carried through to _draft_with_template
          touch_type: "pattern_interrupt",
          generate_at_fire_time: true,  // draft at job-claim time using latest context
          fatigue_sweep: true,          // tag for analytics / audit
          fatigue_slope_substyle: substyle,
        },
        priority: 1,       // slightly elevated — these are time-sensitive re-engagements
        max_attempts: 2,
      });
      scheduled++;
    }

    return { scanned, qualified, scheduled, skipped_pending: skippedPending };
  },
});

// ---------------------------------------------------------------------------
// Helper queries (called via ctx.runQuery from sweepFatigueDetection above)
// ---------------------------------------------------------------------------

/**
 * Returns people rows that are candidates for fatigue detection:
 * - status in (active, paused, lead) — not ghosted/ended
 * - last_inbound_at is non-null and within the lookback window
 *   (people who never had an inbound are out-of-scope)
 *
 * CC TECH label filter is applied in the calling action because Convex
 * can't query inside array fields.
 */
export const _listPeopleForFatigueSweep = internalQuery({
  args: { lookback_cutoff: v.number() },
  handler: async (ctx, args) => {
    // Collect active/paused/lead people. The by_next_followup index doesn't
    // cover all status values, so we scan by user status and filter.
    // At human-scale (<10k rows) this is fine.
    const active = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) => q.eq("status", "active"))
      .collect();
    const paused = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) => q.eq("status", "paused"))
      .collect();
    const leads = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) => q.eq("status", "lead"))
      .collect();

    return [...active, ...paused, ...leads].filter(
      (p) =>
        p.last_inbound_at != null &&
        (p.last_inbound_at as number) > args.lookback_cutoff,
    );
  },
});

/**
 * Returns the N most recent messages associated with a person, sorted
 * oldest-first (so index 0 is oldest, index N-1 is most recent).
 *
 * Uses the by_person_recent index added in AI-9449.
 */
export const _recentMessagesForPerson = internalQuery({
  args: {
    person_id: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    // by_person_recent index: ["person_id", "sent_at"]
    // Take the last N by sent_at descending, then reverse so oldest-first.
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) =>
        q.eq("person_id", args.person_id as any),
      )
      .order("desc")
      .take(args.limit);
    return rows.reverse(); // oldest first for slope computation
  },
});

/**
 * Returns true if there is already a pending/running send_imessage or
 * pattern_interrupt agent_job for this person in the queue.
 * Prevents the sweep from double-scheduling.
 */
export const _hasPendingTouchForPerson = internalQuery({
  args: { person_id: v.string() },
  handler: async (ctx, args) => {
    // Scan queued + running jobs for this person_id in the payload.
    // We can't index by payload contents — scan recent queued jobs and filter.
    const queued = await ctx.db
      .query("agent_jobs")
      .withIndex("by_status_priority", (q) => q.eq("status", "queued"))
      .order("desc")
      .take(100);
    const running = await ctx.db
      .query("agent_jobs")
      .withIndex("by_status_priority", (q) => q.eq("status", "running"))
      .order("desc")
      .take(20);

    const allPending = [...queued, ...running];
    return allPending.some((job) => {
      const p = job.payload as Record<string, unknown> | undefined;
      return (
        (job.job_type === "send_imessage" || job.job_type === "pattern_interrupt") &&
        p?.person_id === args.person_id &&
        p?.touch_type === "pattern_interrupt"
      );
    });
  },
});
