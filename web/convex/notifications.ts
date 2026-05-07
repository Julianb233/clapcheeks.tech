import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Notification prefs + queues + in-app notifications list.
// Replaces:
//   - clapcheeks_notification_prefs
//   - clapcheeks_outbound_notifications
//   - clapcheeks_push_queue
//   - public.notifications

// ---------------------------------------------------------------------------
// notification_prefs
// ---------------------------------------------------------------------------
export const getPrefs = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notification_prefs")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
  },
});

export const upsertPrefs = mutation({
  args: {
    user_id: v.string(),
    email: v.optional(v.string()),
    phone_e164: v.optional(v.string()),
    channels_per_event: v.any(),
    quiet_hours_start: v.number(),
    quiet_hours_end: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("notification_prefs")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        phone_e164: args.phone_e164,
        channels_per_event: args.channels_per_event,
        quiet_hours_start: args.quiet_hours_start,
        quiet_hours_end: args.quiet_hours_end,
        updated_at: now,
      });
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("notification_prefs", {
      user_id: args.user_id,
      email: args.email,
      phone_e164: args.phone_e164,
      channels_per_event: args.channels_per_event,
      quiet_hours_start: args.quiet_hours_start,
      quiet_hours_end: args.quiet_hours_end,
      updated_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});

// ---------------------------------------------------------------------------
// outbound_notifications (iMessage queue)
// ---------------------------------------------------------------------------
export const enqueueOutbound = mutation({
  args: {
    user_id: v.string(),
    channel: v.string(),
    phone_e164: v.string(),
    body: v.string(),
    event_type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("outbound_notifications", {
      user_id: args.user_id,
      channel: args.channel,
      phone_e164: args.phone_e164,
      body: args.body,
      event_type: args.event_type,
      status: "pending",
      attempts: 0,
      created_at: Date.now(),
    });
    return { ok: true as const, id };
  },
});

export const listPendingOutbound = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("outbound_notifications")
      .withIndex("by_user_pending", (q) => q.eq("user_id", args.user_id).eq("status", "pending"))
      .order("asc")
      .take(args.limit ?? 50);
  },
});

export const markOutboundSent = mutation({
  args: { id: v.id("outbound_notifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "sent",
      sent_at: Date.now(),
    });
    return { ok: true as const };
  },
});

export const markOutboundFailed = mutation({
  args: { id: v.id("outbound_notifications"), last_error: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) return { ok: false as const };
    await ctx.db.patch(args.id, {
      status: "failed",
      attempts: (existing.attempts ?? 0) + 1,
      last_error: args.last_error,
    });
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// push_queue
// ---------------------------------------------------------------------------
export const enqueuePush = mutation({
  args: {
    user_id: v.string(),
    title: v.string(),
    body: v.string(),
    event_type: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("push_queue", {
      user_id: args.user_id,
      title: args.title,
      body: args.body,
      event_type: args.event_type,
      payload: args.payload ?? {},
      status: "pending",
      created_at: Date.now(),
    });
    return { ok: true as const, id };
  },
});

// ---------------------------------------------------------------------------
// notifications (in-app list)
// ---------------------------------------------------------------------------
export const listForUser = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_user_recent", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const listUnreadForUser = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("user_id", args.user_id).eq("read", false))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const insertNotification = mutation({
  args: {
    user_id: v.string(),
    title: v.string(),
    message: v.optional(v.string()),
    type: v.optional(v.string()),
    action_url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("notifications", {
      user_id: args.user_id,
      title: args.title,
      message: args.message,
      type: args.type,
      action_url: args.action_url,
      read: false,
      created_at: Date.now(),
    });
    return { ok: true as const, id };
  },
});

export const markRead = mutation({
  args: { id: v.id("notifications"), user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.user_id !== args.user_id) {
      return { ok: false as const, reason: "not_owner" as const };
    }
    await ctx.db.patch(args.id, { read: true });
    return { ok: true as const };
  },
});

export const markAllReadForUser = mutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("user_id", args.user_id).eq("read", false))
      .collect();
    for (const r of rows) await ctx.db.patch(r._id, { read: true });
    return { ok: true as const, updated: rows.length };
  },
});

export const deleteNotification = mutation({
  args: { id: v.id("notifications"), user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.user_id !== args.user_id) {
      return { ok: false as const, reason: "not_owner" as const };
    }
    await ctx.db.delete(args.id);
    return { ok: true as const };
  },
});

export const deleteAllReadForUser = mutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("user_id", args.user_id).eq("read", true))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { ok: true as const, deleted: rows.length };
  },
});
