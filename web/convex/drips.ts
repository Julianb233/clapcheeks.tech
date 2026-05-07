// AI-9535 outbound migration — Convex functions for followup_sequences.
//
// Replaces the Supabase clapcheeks_followup_sequences CRUD that lived in:
//   - web/app/api/followup-sequences/route.ts
//   - web/app/api/followup-sequences/trigger/route.ts (config read)
//   - web/app/api/followup-sequences/app-to-text/route.ts (config read)
//
// Note: this is the per-user drip *config* (cadence, quiet hours, warmth
// threshold). The actual scheduled outbound rows live in
// outbound_scheduled_messages and are managed by outbound.ts.
//
// `drip_states` (per-conversation cadence state) already exists in schema.ts
// (AI-9196) and is managed by drip.ts — left untouched here.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Defaults must mirror DEFAULT_FOLLOWUP_CONFIG in web/lib/followup/types.ts.
const DEFAULTS = {
  enabled: true,
  delays_hours: [24, 72, 168] as number[],
  max_followups: 3,
  app_to_text_enabled: true,
  warmth_threshold: 0.7,
  min_messages_before_transition: 12,
  optimal_send_start_hour: 18,
  optimal_send_end_hour: 21,
  quiet_hours_start: 23,
  quiet_hours_end: 8,
  timezone: "America/Los_Angeles",
};

// Get-or-create the user's followup config. Insert defaults if no row exists.
export const getOrCreateConfig = mutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("followup_sequences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (existing) return existing;
    const now = Date.now();
    const id = await ctx.db.insert("followup_sequences", {
      user_id: args.user_id,
      ...DEFAULTS,
      created_at: now,
      updated_at: now,
    });
    return await ctx.db.get(id);
  },
});

// Read-only — returns null if no config exists yet (caller decides whether to
// create one).
export const getConfig = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("followup_sequences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
  },
});

export const updateConfig = mutation({
  args: {
    user_id: v.string(),
    enabled: v.optional(v.boolean()),
    delays_hours: v.optional(v.array(v.number())),
    max_followups: v.optional(v.number()),
    app_to_text_enabled: v.optional(v.boolean()),
    warmth_threshold: v.optional(v.number()),
    min_messages_before_transition: v.optional(v.number()),
    optimal_send_start_hour: v.optional(v.number()),
    optimal_send_end_hour: v.optional(v.number()),
    quiet_hours_start: v.optional(v.number()),
    quiet_hours_end: v.optional(v.number()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("followup_sequences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    const updates: Record<string, unknown> = { updated_at: now };
    for (const k of Object.keys(args) as Array<keyof typeof args>) {
      if (k === "user_id") continue;
      if (args[k] !== undefined) updates[k] = args[k];
    }
    if (existing) {
      await ctx.db.patch(existing._id, updates);
      return await ctx.db.get(existing._id);
    }
    // No row yet — insert with defaults + caller updates.
    const merged: Record<string, unknown> = {
      user_id: args.user_id,
      ...DEFAULTS,
      ...updates,
      created_at: now,
    };
    if (merged.updated_at === undefined) merged.updated_at = now;
    const id = await ctx.db.insert(
      "followup_sequences",
      merged as Parameters<typeof ctx.db.insert<"followup_sequences">>[1],
    );
    return await ctx.db.get(id);
  },
});

// ------------------------------------------------------------
// Backfill helper for migrate_outbound script.
// ------------------------------------------------------------
export const backfillFollowupSequence = mutation({
  args: {
    legacy_id: v.string(),
    user_id: v.string(),
    enabled: v.boolean(),
    delays_hours: v.array(v.number()),
    max_followups: v.number(),
    app_to_text_enabled: v.boolean(),
    warmth_threshold: v.number(),
    min_messages_before_transition: v.number(),
    optimal_send_start_hour: v.number(),
    optimal_send_end_hour: v.number(),
    quiet_hours_start: v.number(),
    quiet_hours_end: v.number(),
    timezone: v.string(),
    created_at: v.number(),
    updated_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("followup_sequences")
      .withIndex("by_legacy_id", (q) => q.eq("legacy_id", args.legacy_id))
      .first();
    if (existing) return { skipped: true, id: existing._id };
    // Also dedup by user_id since legacy table had UNIQUE(user_id).
    const dupe = await ctx.db
      .query("followup_sequences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (dupe) return { skipped: true, id: dupe._id, reason: "user_already_has_config" };
    const id = await ctx.db.insert("followup_sequences", args);
    return { skipped: false, id };
  },
});
