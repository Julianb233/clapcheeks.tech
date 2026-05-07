import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Billing on Convex.
//
// Replaces Supabase tables clapcheeks_subscriptions + dunning_events.
// During the parallel-write window, the Stripe webhook + dunning helper
// writes BOTH Supabase and Convex; reads continue from Supabase until
// parity is verified, then reads flip to Convex.

const PLAN = v.union(
  v.literal("starter"),
  v.literal("pro"),
  v.literal("elite"),
);

const DUNNING_EVENT_TYPE = v.union(
  v.literal("payment_failed"),
  v.literal("payment_recovered"),
  v.literal("grace_period_expired"),
  v.literal("manual_retry"),
  v.literal("subscription_canceled"),
);

// ---------------------------------------------------------------------------
// upsertSubscription — write path. Idempotent on (user_id) OR (stripe_subscription_id).
// Used by Stripe webhook + admin tooling.
// ---------------------------------------------------------------------------
export const upsertSubscription = mutation({
  args: {
    user_id: v.string(),
    stripe_subscription_id: v.optional(v.string()),
    plan: PLAN,
    status: v.string(),
    current_period_start: v.optional(v.number()),
    current_period_end: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Prefer match on stripe_subscription_id (when present), else user_id.
    let existing = null as Awaited<ReturnType<typeof ctx.db.query>>["first"] extends () => Promise<infer R> ? R : never;
    if (args.stripe_subscription_id) {
      existing = await ctx.db
        .query("subscriptions")
        .withIndex("by_stripe_id", (q) => q.eq("stripe_subscription_id", args.stripe_subscription_id))
        .first();
    }
    if (!existing) {
      existing = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
        .first();
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        user_id: args.user_id,
        stripe_subscription_id: args.stripe_subscription_id,
        plan: args.plan,
        status: args.status,
        current_period_start: args.current_period_start,
        current_period_end: args.current_period_end,
        updated_at: now,
      });
      return { ok: true as const, action: "updated" as const, id: existing._id };
    }
    const id = await ctx.db.insert("subscriptions", {
      user_id: args.user_id,
      stripe_subscription_id: args.stripe_subscription_id,
      plan: args.plan,
      status: args.status,
      current_period_start: args.current_period_start,
      current_period_end: args.current_period_end,
      created_at: now,
      updated_at: now,
    });
    return { ok: true as const, action: "inserted" as const, id };
  },
});

// ---------------------------------------------------------------------------
// updateStatusByStripeId — narrow patch used by webhook flows that only
// know the Stripe subscription id.
// ---------------------------------------------------------------------------
export const updateStatusByStripeId = mutation({
  args: {
    stripe_subscription_id: v.string(),
    status: v.string(),
    plan: v.optional(PLAN),
    current_period_start: v.optional(v.number()),
    current_period_end: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_id", (q) => q.eq("stripe_subscription_id", args.stripe_subscription_id))
      .first();
    if (!row) return { ok: false as const, reason: "not_found" as const };
    const patch: Record<string, unknown> = {
      status: args.status,
      updated_at: Date.now(),
    };
    if (args.plan) patch.plan = args.plan;
    if (args.current_period_start !== undefined) patch.current_period_start = args.current_period_start;
    if (args.current_period_end !== undefined) patch.current_period_end = args.current_period_end;
    await ctx.db.patch(row._id, patch);
    return { ok: true as const, id: row._id };
  },
});

// ---------------------------------------------------------------------------
// getByUser / listActiveUserIds — read paths.
// ---------------------------------------------------------------------------
export const getByUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
  },
});

export const listActiveUserIds = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return rows.map((r) => r.user_id);
  },
});

// ---------------------------------------------------------------------------
// insertDunningEvent — append-only audit log.
// ---------------------------------------------------------------------------
export const insertDunningEvent = mutation({
  args: {
    user_id: v.optional(v.string()),
    stripe_customer_id: v.optional(v.string()),
    stripe_invoice_id: v.optional(v.string()),
    event_type: DUNNING_EVENT_TYPE,
    attempt_number: v.optional(v.number()),
    grace_period_end: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("dunning_events", {
      user_id: args.user_id,
      stripe_customer_id: args.stripe_customer_id,
      stripe_invoice_id: args.stripe_invoice_id,
      event_type: args.event_type,
      attempt_number: args.attempt_number,
      grace_period_end: args.grace_period_end,
      metadata: args.metadata,
      created_at: Date.now(),
    });
    return { ok: true as const, id };
  },
});

export const recentDunningForUser = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 25;
    return await ctx.db
      .query("dunning_events")
      .withIndex("by_user_ts", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(limit);
  },
});
