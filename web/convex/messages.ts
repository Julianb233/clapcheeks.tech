import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Append a message to a conversation. Called by the local Mac agent when
// it imports a new inbound iMessage / dating-app message, or by the user
// approving an AI suggestion.
export const append = mutation({
  args: {
    conversation_id: v.id("conversations"),
    user_id: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    body: v.string(),
    sent_at: v.number(),
    source: v.union(
      v.literal("user"),
      v.literal("ai_suggestion_approved"),
      v.literal("ai_auto_send"),
      v.literal("scheduled"),
      v.literal("import"),
    ),
    ai_metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", args);

    const conv = await ctx.db.get(args.conversation_id);
    if (conv) {
      const isInbound = args.direction === "inbound";
      await ctx.db.patch(args.conversation_id, {
        last_message_at: args.sent_at,
        last_inbound_at: isInbound ? args.sent_at : conv.last_inbound_at,
        last_outbound_at: !isInbound ? args.sent_at : conv.last_outbound_at,
        unread_count: isInbound ? conv.unread_count + 1 : conv.unread_count,
        updated_at: Date.now(),
      });
    }

    return messageId;
  },
});

// Mark all messages in a conversation as read.
export const markRead = mutation({
  args: { conversation_id: v.id("conversations") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const unread = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversation_id", args.conversation_id),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("direction"), "inbound"),
          q.eq(q.field("read_at"), undefined),
        ),
      )
      .take(500);

    for (const m of unread) {
      await ctx.db.patch(m._id, { read_at: now });
    }

    await ctx.db.patch(args.conversation_id, {
      unread_count: 0,
      updated_at: now,
    });
    return { marked: unread.length };
  },
});

// Recent messages for a user across all conversations — powers the
// global activity feed in the dashboard.
export const recentForUser = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_user_recent", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(args.limit ?? 50);
  },
});
