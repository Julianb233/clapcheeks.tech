import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// AI-9575 — conversation_stats on Convex.
// Replaces Supabase clapcheeks_conversation_stats.
// Old Supabase table stays live as backstop until backfill is run.

export const upsertDaily = mutation({
  args: {
    user_id: v.string(),
    date: v.string(),
    platform: v.string(),
    messages_sent: v.optional(v.number()),
    messages_received: v.optional(v.number()),
    conversations_started: v.optional(v.number()),
    conversations_replied: v.optional(v.number()),
    conversations_ghosted: v.optional(v.number()),
    avg_response_time_mins: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("conversation_stats")
      .withIndex("by_user_platform_date", (q) =>
        q.eq("user_id", args.user_id).eq("platform", args.platform).eq("date", args.date),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        messages_sent: args.messages_sent ?? existing.messages_sent,
        messages_received: args.messages_received ?? existing.messages_received,
        conversations_started: args.conversations_started ?? existing.conversations_started,
        conversations_replied: args.conversations_replied ?? existing.conversations_replied,
        conversations_ghosted: args.conversations_ghosted ?? existing.conversations_ghosted,
        avg_response_time_mins:
          args.avg_response_time_mins !== undefined
            ? args.avg_response_time_mins
            : existing.avg_response_time_mins,
      });
      return { action: "updated" as const, _id: existing._id };
    }
    const id = await ctx.db.insert("conversation_stats", {
      user_id: args.user_id,
      date: args.date,
      platform: args.platform,
      messages_sent: args.messages_sent ?? 0,
      messages_received: args.messages_received ?? 0,
      conversations_started: args.conversations_started ?? 0,
      conversations_replied: args.conversations_replied ?? 0,
      conversations_ghosted: args.conversations_ghosted ?? 0,
      avg_response_time_mins: args.avg_response_time_mins,
      created_at: now,
    });
    return { action: "inserted" as const, _id: id };
  },
});

export const listForUser = query({
  args: {
    user_id: v.string(),
    since_date: v.optional(v.string()),
    until_date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("conversation_stats")
      .withIndex("by_user_date", (q) => {
        const base = q.eq("user_id", args.user_id);
        return args.since_date ? base.gte("date", args.since_date) : base;
      })
      .collect();
    if (args.until_date) {
      const upper = args.until_date;
      rows = rows.filter((r) => r.date <= upper);
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  },
});

function checkRunnerSecret(provided: string) {
  const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
  if (!expected) throw new Error("server_unconfigured: CONVEX_RUNNER_SHARED_SECRET unset");
  if (provided !== expected) throw new Error("forbidden: bad deploy_key_check");
}

export const backfillConversationStatsFromScript = mutation({
  args: {
    deploy_key_check: v.string(),
    user_id: v.string(),
    date: v.string(),
    platform: v.string(),
    messages_sent: v.number(),
    messages_received: v.number(),
    conversations_started: v.number(),
    conversations_replied: v.number(),
    conversations_ghosted: v.number(),
    avg_response_time_mins: v.optional(v.number()),
    created_at: v.number(),
  },
  handler: async (ctx, { deploy_key_check, ...rest }) => {
    checkRunnerSecret(deploy_key_check);
    const existing = await ctx.db
      .query("conversation_stats")
      .withIndex("by_user_platform_date", (q) =>
        q.eq("user_id", rest.user_id).eq("platform", rest.platform).eq("date", rest.date),
      )
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("conversation_stats", rest);
    return { action: "inserted" as const };
  },
});

export const backfillConversationStats = internalMutation({
  args: {
    user_id: v.string(),
    date: v.string(),
    platform: v.string(),
    messages_sent: v.number(),
    messages_received: v.number(),
    conversations_started: v.number(),
    conversations_replied: v.number(),
    conversations_ghosted: v.number(),
    avg_response_time_mins: v.optional(v.number()),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversation_stats")
      .withIndex("by_user_platform_date", (q) =>
        q.eq("user_id", args.user_id).eq("platform", args.platform).eq("date", args.date),
      )
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("conversation_stats", args);
    return { action: "inserted" as const };
  },
});
