import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Registered iOS / Mac devices per user (replaces public.devices).

export const listForUser = query({
  args: { user_id: v.string(), only_active: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (args.only_active) {
      return await ctx.db
        .query("devices")
        .withIndex("by_user_active", (q) => q.eq("user_id", args.user_id).eq("is_active", true))
        .collect();
    }
    return await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
  },
});

export const upsertDevice = mutation({
  args: {
    user_id: v.string(),
    device_name: v.string(),
    platform: v.string(),
    agent_version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const matches = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const existing = matches.find((d) => d.device_name === args.device_name);
    if (existing) {
      await ctx.db.patch(existing._id, {
        platform: args.platform,
        agent_version: args.agent_version,
        last_seen_at: now,
        is_active: true,
      });
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("devices", {
      user_id: args.user_id,
      device_name: args.device_name,
      platform: args.platform,
      agent_version: args.agent_version,
      last_seen_at: now,
      is_active: true,
      created_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});

export const heartbeat = mutation({
  args: { user_id: v.string(), device_name: v.string() },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const existing = matches.find((d) => d.device_name === args.device_name);
    if (!existing) return { ok: false as const, reason: "not_found" as const };
    await ctx.db.patch(existing._id, { last_seen_at: Date.now(), is_active: true });
    return { ok: true as const };
  },
});

export const deactivate = mutation({
  args: { user_id: v.string(), device_name: v.string() },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const existing = matches.find((d) => d.device_name === args.device_name);
    if (!existing) return { ok: false as const, reason: "not_found" as const };
    await ctx.db.patch(existing._id, { is_active: false });
    return { ok: true as const };
  },
});
