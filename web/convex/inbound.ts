/**
 * AI-9449 — Inbound interpretation pipeline.
 *
 * messages.upsertFromWebhook fires interpretInboundForOne after every inbound
 * iMessage. The action reads context (last 30 messages, person row), decides
 * if anything new should be appended to the long-term ledgers
 * (personal_details / curiosity_ledger / recent_life_events / lit topics /
 * boundaries_stated / emotional_state_recent), and asks the cadence engine
 * what to schedule next.
 *
 * The heavy LLM read happens on Mac Mini via the enrich_courtship +
 * cadence_evaluate_one agent_jobs. This module enqueues those jobs and
 * exposes the small append/get helpers the Mac Mini calls back into.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

// ---------------------------------------------------------------------------
// interpretInboundForOne — fired from messages.upsertFromWebhook.
//
// Fires two agent_jobs that the Mac Mini handles:
//   1. enrich_courtship — re-extract personal_details / curiosity / events /
//      boundaries / emotional state. Throttled to 1 run per person per 30 min
//      so a noisy thread doesn't burn LLM credits.
//   2. cadence_evaluate_one — recompute next_followup_at, time_to_ask_score,
//      conversation_temperature.
// ---------------------------------------------------------------------------
export const interpretInboundForOne = internalAction({
  args: {
    person_id: v.id("people"),
    conversation_id: v.id("conversations"),
    message_external_guid: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ enqueued: number }> => {
    const person = await ctx.runQuery(internal.inbound._getPerson, {
      person_id: args.person_id,
    });
    if (!person) return { enqueued: 0 };

    const now = Date.now();
    const last = (person as any).courtship_last_analyzed ?? 0;
    let enqueued = 0;

    // Throttle enrich_courtship to once per 30 min per person.
    if (now - last > 30 * 60 * 1000) {
      await ctx.runMutation(internal.inbound._enqueueEnrichJob, {
        user_id: person.user_id,
        person_id: args.person_id,
        conversation_id: args.conversation_id,
      });
      enqueued++;
    }

    // Always re-evaluate cadence; cheap.
    await ctx.runMutation(internal.inbound._enqueueCadenceJob, {
      user_id: person.user_id,
      person_id: args.person_id,
    });
    enqueued++;

    return { enqueued };
  },
});

// ---------------------------------------------------------------------------
// _appendInsights — Mac Mini calls this after enrich_courtship completes.
// Appends to the long-term ledgers without overwriting existing entries.
// ---------------------------------------------------------------------------
export const _appendInsights = internalMutation({
  args: {
    person_id: v.id("people"),
    personal_details: v.optional(v.array(v.any())),
    curiosity_ledger: v.optional(v.array(v.any())),
    recent_life_events: v.optional(v.array(v.any())),
    topics_that_lit_her_up: v.optional(v.array(v.any())),
    emotional_state_recent: v.optional(v.array(v.any())),
    boundaries_stated: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const person = await ctx.db.get(args.person_id);
    if (!person) return { not_found: true };
    const patch: any = { updated_at: Date.now() };
    if (args.personal_details?.length) {
      const existing = (person as any).personal_details ?? [];
      patch.personal_details = [...existing, ...args.personal_details].slice(-50);
    }
    if (args.curiosity_ledger?.length) {
      const existing = (person as any).curiosity_ledger ?? [];
      patch.curiosity_ledger = [...existing, ...args.curiosity_ledger].slice(-50);
    }
    if (args.recent_life_events?.length) {
      const existing = (person as any).recent_life_events ?? [];
      patch.recent_life_events = [...existing, ...args.recent_life_events].slice(-30);
    }
    if (args.topics_that_lit_her_up?.length) {
      patch.topics_that_lit_her_up = args.topics_that_lit_her_up;
    }
    if (args.emotional_state_recent?.length) {
      const existing = (person as any).emotional_state_recent ?? [];
      patch.emotional_state_recent = [...existing, ...args.emotional_state_recent].slice(-20);
    }
    if (args.boundaries_stated?.length) {
      const existing = (person as any).boundaries_stated ?? [];
      patch.boundaries_stated = Array.from(new Set([...existing, ...args.boundaries_stated])).slice(-15);
    }
    await ctx.db.patch(args.person_id, patch);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers used by the action above.
// ---------------------------------------------------------------------------
import { internal } from "./_generated/api";

export const _getPerson = internalQuery({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => await ctx.db.get(args.person_id),
});

export const _recentMessages = internalQuery({
  args: { person_id: v.id("people"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) => q.eq("person_id", args.person_id))
      .order("desc")
      .take(Math.min(args.limit ?? 30, 100));
    return rows.reverse();
  },
});

export const _enqueueEnrichJob = internalMutation({
  args: {
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("agent_jobs", {
      user_id: args.user_id,
      job_type: "enrich_courtship",
      payload: {
        person_id: args.person_id,
        conversation_id: args.conversation_id,
      },
      status: "queued",
      priority: 4,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    } as any);
  },
});

export const _enqueueCadenceJob = internalMutation({
  args: { user_id: v.string(), person_id: v.id("people") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("agent_jobs", {
      user_id: args.user_id,
      job_type: "cadence_evaluate_one",
      payload: { person_id: args.person_id },
      status: "queued",
      priority: 5,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    } as any);
  },
});
