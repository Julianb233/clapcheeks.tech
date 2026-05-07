/**
 * AI-9449 — Daily morning digest engine.
 *
 * generateDaily runs at 9am Pacific. Produces a ranked list of conversations
 * needing attention + scheduled touches firing today + manual one-tap drafts
 * the operator can approve before BlueBubbles sends them.
 *
 * The heavy LLM-driven composition runs Mac Mini-side via the
 * send_digest_to_julian agent_job. This module enqueues the job and exposes
 * a generateNow mutation for one-shot manual triggering from the dashboard.
 */
import { v } from "convex/values";
import { internalAction, mutation, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// generateDaily — fired by the cron at 9am Pacific (17:00 UTC).
// ---------------------------------------------------------------------------
export const generateDaily = internalAction({
  args: {},
  handler: async (ctx): Promise<{ enqueued: boolean; reason?: string }> => {
    return await ctx.runMutation(internal.digest._enqueueDigestJob, {
      user_id: "fleet-julian",
      reason: "daily_cron",
    });
  },
});

// ---------------------------------------------------------------------------
// generateNow — operator-triggered (dashboard "Run digest now" button).
// ---------------------------------------------------------------------------
export const generateNow = mutation({
  args: { user_id: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await ctx.runMutation(internal.digest._enqueueDigestJob, {
      user_id: args.user_id ?? "fleet-julian",
      reason: "manual_dashboard",
    });
  },
});

// ---------------------------------------------------------------------------
// _enqueueDigestJob — internal helper, dedups in-flight digest jobs.
// ---------------------------------------------------------------------------
export const _enqueueDigestJob = internalMutation({
  args: { user_id: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_type", (q) =>
        q.eq("user_id", args.user_id).eq("job_type", "send_digest_to_julian"),
      )
      .collect();
    const inFlight = existing.find(
      (j) => j.status === "queued" || j.status === "running",
    );
    if (inFlight) return { enqueued: false, reason: "already_in_flight" };
    await ctx.db.insert("agent_jobs", {
      user_id: args.user_id,
      job_type: "send_digest_to_julian",
      payload: { user_id: args.user_id, reason: args.reason, generated_at: now },
      status: "queued",
      priority: 3,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    } as any);
    return { enqueued: true };
  },
});

// ---------------------------------------------------------------------------
// _activeConversations — read for the digest preview UI. Returns the top N
// people whose courtship is alive (active + has recent inbound or scheduled
// touch within 7 days).
// ---------------------------------------------------------------------------
export const _activeConversations = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const people = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("status", "active"),
      )
      .collect();
    const active = people
      .filter((p) =>
        (p.last_inbound_at ?? 0) > sevenDaysAgo ||
        (p.next_followup_at ?? 0) > now,
      )
      .sort((a, b) => (b.last_inbound_at ?? 0) - (a.last_inbound_at ?? 0));
    return active.slice(0, Math.min(args.limit ?? 20, 50));
  },
});

// ---------------------------------------------------------------------------
// _compose — placeholder action retained for backwards compatibility with the
// previous deployment. Mac Mini does the actual composition; this is a no-op.
// ---------------------------------------------------------------------------
export const _compose = internalAction({
  args: { user_id: v.string() },
  handler: async () => ({ ok: true, note: "Mac Mini composes via send_digest_to_julian" }),
});
