import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Schedule a message to be sent at a future time. Called from web client
// or from the local Mac agent via HTTP action.
export const create = mutation({
  args: {
    conversation_id: v.id("conversations"),
    user_id: v.string(),
    body: v.string(),
    scheduled_for: v.number(),
    schedule_reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("scheduled_messages", {
      ...args,
      status: "pending",
      created_at: now,
      updated_at: now,
    });
  },
});

// Pending scheduled messages for a conversation, oldest first.
export const listPendingForConversation = query({
  args: { conversation_id: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scheduled_messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversation_id", args.conversation_id).eq("status", "pending"),
      )
      .order("asc")
      .collect();
  },
});

// Cancel a pending message before it sends.
export const cancel = mutation({
  args: { id: v.id("scheduled_messages") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) throw new Error("Not found");
    if (msg.status !== "pending") {
      throw new Error(`Cannot cancel message in status ${msg.status}`);
    }
    await ctx.db.patch(args.id, {
      status: "cancelled",
      updated_at: Date.now(),
    });
  },
});

// Cron-driven worker. Picks up every scheduled_message whose scheduled_for
// is past now and kicks off the send. This replaces the pg_cron + worker
// loop that polled clapcheeks_scheduled_messages on Postgres.
export const sendDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("scheduled_messages")
      .withIndex("by_status_due", (q) =>
        q.eq("status", "pending").lte("scheduled_for", now),
      )
      .take(50);

    let dispatched = 0;
    for (const msg of due) {
      // Insert as a real message row with source=scheduled. The local Mac
      // agent picks this up via subscription and actually delivers via the
      // user's iMessage / dating-app session.
      const messageId = await ctx.db.insert("messages", {
        conversation_id: msg.conversation_id,
        user_id: msg.user_id,
        direction: "outbound",
        body: msg.body,
        sent_at: now,
        source: "scheduled",
      });

      await ctx.db.patch(msg._id, {
        status: "sent",
        sent_message_id: messageId,
        updated_at: now,
      });

      // Touch the conversation so live UIs see the new message immediately.
      const conv = await ctx.db.get(msg.conversation_id);
      if (conv) {
        await ctx.db.patch(msg.conversation_id, {
          last_message_at: now,
          last_outbound_at: now,
          updated_at: now,
        });
      }
      dispatched++;
    }

    return { dispatched, scanned: due.length };
  },
});
