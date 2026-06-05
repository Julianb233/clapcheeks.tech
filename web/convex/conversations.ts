import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Live list of a user's conversations, sorted by most recent activity.
// Reactive — the dashboard subscribes and updates automatically when
// any of the conversations change.
export const listForUser = query({
  args: {
    user_id: v.string(),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("ghosted"),
        v.literal("dating"),
        v.literal("ended"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 200), 1), 200);
    if (args.status) {
      return await ctx.db
        .query("conversations")
        .withIndex("by_user_status", (q) =>
          q.eq("user_id", args.user_id).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("conversations")
      .withIndex("by_last_message", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(limit);
  },
});

// AI-9545 — list a person's conversations across all platforms.
// Used by clapcheeks-local cadence_runner.py to evaluate cadence per
// person regardless of which channel the thread is on.
// Read-only candidate list for stale-thread re-engagement lanes. This returns
// conversations that are safe for a stager to inspect; the actual sender still
// must perform live platform/chat.db freshness verification before any outbound.
export const listStaleCandidates = query({
  args: {
    user_id: v.string(),
    min_idle_hours: v.optional(v.number()),
    platform: v.optional(
      v.union(
        v.literal("hinge"),
        v.literal("tinder"),
        v.literal("bumble"),
        v.literal("imessage"),
        v.literal("instagram"),
        v.literal("other"),
      ),
    ),
    limit: v.optional(v.number()),
    now_ms: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now_ms ?? Date.now();
    const minIdleMs = (args.min_idle_hours ?? 24) * 60 * 60 * 1000;
    const cutoff = now - minIdleMs;
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_last_message", (q) => q.eq("user_id", args.user_id))
      .order("asc")
      .take(500);

    return rows
      .filter((row) => row.status === "active")
      .filter((row) => !args.platform || row.platform === args.platform)
      .filter((row) => {
        const activityAt = row.last_message_at ?? row.updated_at ?? row.created_at;
        if (activityAt > cutoff) return false;
        // Prefer threads where she was the latest sender, or where no outbound
        // is known. This avoids re-pinging rows where Julian already followed up.
        if (!row.last_inbound_at) return false;
        return !row.last_outbound_at || row.last_inbound_at > row.last_outbound_at;
      })
      .slice(0, limit);
  },
});

export const listForPerson = query({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
      .order("desc")
      .take(50);
  },
});

// Single conversation with most recent N messages.
export const getWithMessages = query({
  args: {
    conversation_id: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversation_id);
    if (!conv) return null;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversation_id", args.conversation_id),
      )
      .order("desc")
      .take(args.limit ?? 50);
    return { conversation: conv, messages: messages.reverse() };
  },
});

// Upsert a conversation by external_match_id. Called by the local Mac
// agent when it imports a new match or sees activity on an existing one.
export const upsert = mutation({
  args: {
    user_id: v.string(),
    platform: v.union(
      v.literal("hinge"),
      v.literal("tinder"),
      v.literal("bumble"),
      v.literal("imessage"),
      v.literal("other"),
    ),
    external_match_id: v.string(),
    match_name: v.optional(v.string()),
    match_photo_url: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_user_external", (q) =>
        q
          .eq("user_id", args.user_id)
          .eq("platform", args.platform)
          .eq("external_match_id", args.external_match_id),
      )
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        match_name: args.match_name ?? existing.match_name,
        match_photo_url: args.match_photo_url ?? existing.match_photo_url,
        metadata: args.metadata ?? existing.metadata,
        updated_at: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("conversations", {
      ...args,
      status: "active",
      unread_count: 0,
      created_at: now,
      updated_at: now,
    });
  },
});

// AI-9572 — Resolve a conversation by external_match_id (any platform).
// Used by conversation-thread page to get the Convex conversation_id from
// the UI's match_id (which is external_match_id on the conversations table).
export const getByMatchId = query({
  args: {
    user_id: v.string(),
    external_match_id: v.string(),
  },
  handler: async (ctx, args) => {
    // Try all platforms via by_user_external index — scan per platform.
    const platforms = ["hinge", "tinder", "bumble", "imessage", "other"] as const;
    for (const platform of platforms) {
      const conv = await ctx.db
        .query("conversations")
        .withIndex("by_user_external", (q) =>
          q
            .eq("user_id", args.user_id)
            .eq("platform", platform)
            .eq("external_match_id", args.external_match_id),
        )
        .first();
      if (conv) return conv;
    }
    return null;
  },
});

// AI-9500-C: Look up a single conversation by platform + external_match_id.
// Used by the Hinge poller to resolve the Convex document ID before appending messages.
export const getByExternal = query({
  args: {
    user_id: v.string(),
    platform: v.union(
      v.literal("hinge"),
      v.literal("tinder"),
      v.literal("bumble"),
      v.literal("imessage"),
      v.literal("other"),
    ),
    external_match_id: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_user_external", (q) =>
        q
          .eq("user_id", args.user_id)
          .eq("platform", args.platform)
          .eq("external_match_id", args.external_match_id),
      )
      .first();
  },
});

// Cron: re-derive last_message_at + unread_count from the messages table
// for any conversation that may have drifted (agent crash, partial write).
export const reconcile = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("conversations")
      .withIndex("by_last_message")
      .order("asc")
      .take(100);

    let updated = 0;
    for (const conv of stale) {
      const lastMsg = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversation_id", conv._id),
        )
        .order("desc")
        .first();

      if (!lastMsg) continue;
      if (conv.last_message_at !== lastMsg.sent_at) {
        await ctx.db.patch(conv._id, {
          last_message_at: lastMsg.sent_at,
          last_inbound_at:
            lastMsg.direction === "inbound"
              ? lastMsg.sent_at
              : conv.last_inbound_at,
          last_outbound_at:
            lastMsg.direction === "outbound"
              ? lastMsg.sent_at
              : conv.last_outbound_at,
          updated_at: now,
        });
        updated++;
      }
    }
    return { scanned: stale.length, updated };
  },
});
