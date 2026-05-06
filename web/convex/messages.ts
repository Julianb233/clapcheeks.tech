import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Append a message to a conversation. Called by the local Mac agent when
// it imports a new inbound iMessage / dating-app message, or by the user
// approving an AI suggestion.
//
// AI-9409: extended with optional multi-line iMessage fields (line, transport,
// external_guid, attachments_summary, send_error). Backwards-compatible —
// existing call sites work unchanged. Dedup by external_guid at top of handler.
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
      v.literal("bluebubbles_webhook"),
    ),
    ai_metadata: v.optional(v.any()),
    // AI-9409 optional multi-line fields
    line: v.optional(v.number()),
    transport: v.optional(v.union(
      v.literal("bluebubbles"),
      v.literal("pypush"),
      v.literal("applescript"),
      v.literal("sms"),
      v.literal("imessage_native"),
    )),
    external_guid: v.optional(v.string()),
    attachments_summary: v.optional(v.any()),
    send_error: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Dedup check by external_guid if provided (AI-9409)
    if (args.external_guid) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_external_guid", (q) =>
          q.eq("external_guid", args.external_guid),
        )
        .first();
      if (existing) return existing._id; // already ingested
    }

    const messageId = await ctx.db.insert("messages", args);

    const conv = await ctx.db.get(args.conversation_id);
    if (conv) {
      const isInbound = args.direction === "inbound";
      const patches: Record<string, unknown> = {
        last_message_at: args.sent_at,
        last_inbound_at: isInbound ? args.sent_at : conv.last_inbound_at,
        last_outbound_at: !isInbound ? args.sent_at : conv.last_outbound_at,
        unread_count: isInbound ? conv.unread_count + 1 : conv.unread_count,
        updated_at: Date.now(),
      };
      // Sticky-line: stamp the line on the conversation if not yet set (AI-9409)
      if (args.line && !conv.line) patches.line = args.line;
      await ctx.db.patch(args.conversation_id, patches);
    }

    return messageId;
  },
});

// Single entry point for the VPS BlueBubbles receiver (AI-9409).
// Resolves or creates the conversation by imessage_handle, then appends
// the message. Safe to call concurrently — dedup in append() handles races.
export const upsertFromWebhook = mutation({
  args: {
    user_id: v.string(),         // for now: hardcoded "fleet-julian"; multi-tenant later
    line: v.number(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    handle: v.string(),          // E.164 phone or email (the OTHER party)
    body: v.string(),
    sent_at: v.number(),
    external_guid: v.string(),
    transport: v.union(
      v.literal("bluebubbles"),
      v.literal("pypush"),
      v.literal("applescript"),
      v.literal("sms"),
      v.literal("imessage_native"),
    ),
    attachments_summary: v.optional(v.any()),
    send_error: v.optional(v.any()),
    ai_metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // 1. Find or create conversation for this handle
    let convId: Id<"conversations">;
    const existingConv = await ctx.db
      .query("conversations")
      .withIndex("by_imessage_handle", (q) =>
        q.eq("imessage_handle", args.handle),
      )
      .filter((q) => q.eq(q.field("user_id"), args.user_id))
      .first();

    if (!existingConv) {
      const now = Date.now();
      convId = await ctx.db.insert("conversations", {
        user_id: args.user_id,
        platform: "imessage",
        external_match_id: args.handle,
        status: "active",
        last_message_at: args.sent_at,
        last_inbound_at:
          args.direction === "inbound" ? args.sent_at : undefined,
        last_outbound_at:
          args.direction === "outbound" ? args.sent_at : undefined,
        unread_count: args.direction === "inbound" ? 1 : 0,
        line: args.line,
        imessage_handle: args.handle,
        created_at: now,
        updated_at: now,
      });
    } else {
      convId = existingConv._id;
    }

    // 2. Dedup check by external_guid
    const existingMsg = await ctx.db
      .query("messages")
      .withIndex("by_external_guid", (q) =>
        q.eq("external_guid", args.external_guid),
      )
      .first();
    if (existingMsg) {
      return { conversation_id: convId, message_id: existingMsg._id };
    }

    // 3. Insert message
    const messageId = await ctx.db.insert("messages", {
      conversation_id: convId,
      user_id: args.user_id,
      direction: args.direction,
      body: args.body,
      sent_at: args.sent_at,
      source: "bluebubbles_webhook",
      line: args.line,
      transport: args.transport,
      external_guid: args.external_guid,
      attachments_summary: args.attachments_summary,
      send_error: args.send_error,
      ai_metadata: args.ai_metadata,
    });

    // 4. Update conversation stats + sticky-line
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .filter((q) => q.eq(q.field("_id"), convId))
      .first();
    if (conv) {
      const isInbound = args.direction === "inbound";
      const patches: Record<string, unknown> = {
        last_message_at: args.sent_at,
        last_inbound_at: isInbound ? args.sent_at : conv.last_inbound_at,
        last_outbound_at: !isInbound ? args.sent_at : conv.last_outbound_at,
        unread_count: isInbound ? conv.unread_count + 1 : conv.unread_count,
        updated_at: Date.now(),
      };
      if (args.line && !conv.line) patches.line = args.line;
      await ctx.db.patch(convId, patches);
    }

    return { conversation_id: convId, message_id: messageId };
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
