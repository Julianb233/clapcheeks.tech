import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Weekly report email settings (replaces clapcheeks_report_preferences).

export const getForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("report_preferences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
  },
});

export const listEmailEnabledMap = query({
  args: { user_ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    // Cron call site reads pref-overrides for a batch of subscriber user_ids.
    // Returns array of {user_id, email_enabled}.
    const out: Array<{ user_id: string; email_enabled: boolean }> = [];
    for (const uid of args.user_ids) {
      const row = await ctx.db
        .query("report_preferences")
        .withIndex("by_user", (q) => q.eq("user_id", uid))
        .first();
      out.push({ user_id: uid, email_enabled: row ? row.email_enabled : true });
    }
    return out;
  },
});

export const upsertForUser = mutation({
  args: {
    user_id: v.string(),
    email_enabled: v.boolean(),
    send_day: v.string(),
    send_hour: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("report_preferences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        email_enabled: args.email_enabled,
        send_day: args.send_day,
        send_hour: args.send_hour,
        updated_at: now,
      });
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("report_preferences", {
      user_id: args.user_id,
      email_enabled: args.email_enabled,
      send_day: args.send_day,
      send_hour: args.send_hour,
      created_at: now,
      updated_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});
