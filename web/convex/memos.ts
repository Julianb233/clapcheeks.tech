import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Per-contact operator memos (replaces clapcheeks_memos).

export const getForContact = query({
  args: { user_id: v.string(), contact_handle: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memos")
      .withIndex("by_user_handle", (q) =>
        q.eq("user_id", args.user_id).eq("contact_handle", args.contact_handle),
      )
      .first();
  },
});

export const upsertMemo = mutation({
  args: {
    user_id: v.string(),
    contact_handle: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("memos")
      .withIndex("by_user_handle", (q) =>
        q.eq("user_id", args.user_id).eq("contact_handle", args.contact_handle),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content, updated_at: now });
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("memos", {
      user_id: args.user_id,
      contact_handle: args.contact_handle,
      content: args.content,
      created_at: now,
      updated_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});
