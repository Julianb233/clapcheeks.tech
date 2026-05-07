// AI-9535 outbound migration — Convex functions for outbound_scheduled_messages.
//
// Replaces the Supabase clapcheeks_scheduled_messages CRUD that lived in:
//   - web/app/api/scheduled-messages/route.ts
//   - web/app/api/scheduled-messages/[id]/route.ts
//   - web/app/api/scheduled-messages/send/route.ts
//   - web/app/api/followup-sequences/trigger/route.ts
//   - web/app/api/followup-sequences/app-to-text/route.ts
//
// Auth still resolves user_id via Supabase in the calling Next.js route; this
// module trusts the user_id passed in. Mutations enforce ownership for
// update / delete via the user_id arg matching the row's user_id.
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ------------------------------------------------------------
// Inserts
// ------------------------------------------------------------

export const enqueueScheduledMessage = mutation({
  args: {
    user_id: v.string(),
    match_id: v.optional(v.string()),
    match_name: v.string(),
    platform: v.optional(v.string()),
    phone: v.optional(v.string()),
    message_text: v.string(),
    scheduled_at: v.number(),                       // unix ms
    sequence_type: v.optional(v.union(
      v.literal("follow_up"),
      v.literal("manual"),
      v.literal("app_to_text"),
    )),
    sequence_step: v.optional(v.number()),
    delay_hours: v.optional(v.number()),
    legacy_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("outbound_scheduled_messages", {
      user_id: args.user_id,
      match_id: args.match_id ?? undefined,
      match_name: args.match_name,
      platform: args.platform ?? "iMessage",
      phone: args.phone ?? undefined,
      message_text: args.message_text,
      scheduled_at: args.scheduled_at,
      status: "pending",
      sequence_type: args.sequence_type ?? "manual",
      sequence_step: args.sequence_step ?? 0,
      delay_hours: args.delay_hours ?? undefined,
      legacy_id: args.legacy_id ?? undefined,
      created_at: now,
      updated_at: now,
    });
    return await ctx.db.get(id);
  },
});

// ------------------------------------------------------------
// Queries
// ------------------------------------------------------------

export const listForUser = query({
  args: {
    user_id: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    let rows;
    if (args.status && args.status !== "all") {
      rows = await ctx.db
        .query("outbound_scheduled_messages")
        .withIndex("by_user_status", (q) =>
          q.eq("user_id", args.user_id).eq(
            "status",
            args.status as "pending" | "approved" | "rejected" | "sent" | "failed",
          ),
        )
        .collect();
    } else {
      rows = await ctx.db
        .query("outbound_scheduled_messages")
        .withIndex("by_user_status", (q) => q.eq("user_id", args.user_id))
        .collect();
    }
    rows.sort((a, b) => a.scheduled_at - b.scheduled_at);
    return rows.slice(0, limit);
  },
});

export const listPendingForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("outbound_scheduled_messages")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("status", "pending"),
      )
      .collect();
  },
});

export const listRecentSentForConversation = query({
  args: {
    user_id: v.string(),
    match_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("outbound_scheduled_messages")
      .withIndex("by_user_match", (q) =>
        q.eq("user_id", args.user_id).eq("match_id", args.match_id),
      )
      .collect();
    const sent = rows
      .filter((r) => r.status === "sent")
      .sort((a, b) => (b.sent_at ?? 0) - (a.sent_at ?? 0));
    return sent.slice(0, args.limit ?? 20);
  },
});

export const countFollowupsForMatch = query({
  args: { user_id: v.string(), match_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("outbound_scheduled_messages")
      .withIndex("by_user_match", (q) =>
        q.eq("user_id", args.user_id).eq("match_id", args.match_id),
      )
      .collect();
    return rows.filter((r) => r.sequence_type === "follow_up").length;
  },
});

export const findExistingAppToTextForMatch = query({
  args: { user_id: v.string(), match_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("outbound_scheduled_messages")
      .withIndex("by_user_match", (q) =>
        q.eq("user_id", args.user_id).eq("match_id", args.match_id),
      )
      .collect();
    return rows.find(
      (r) =>
        r.sequence_type === "app_to_text" &&
        (r.status === "pending" || r.status === "approved"),
    );
  },
});

export const getById = query({
  args: { id: v.id("outbound_scheduled_messages"), user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.user_id !== args.user_id) return null;
    return row;
  },
});

// ------------------------------------------------------------
// Mutations: update / delete / status transitions
// ------------------------------------------------------------

export const updateScheduled = mutation({
  args: {
    id: v.id("outbound_scheduled_messages"),
    user_id: v.string(),                            // ownership check
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("sent"),
      v.literal("failed"),
    )),
    rejection_reason: v.optional(v.string()),
    message_text: v.optional(v.string()),
    scheduled_at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    const updates: Record<string, unknown> = { updated_at: Date.now() };
    if (args.status !== undefined) updates.status = args.status;
    if (args.rejection_reason !== undefined) updates.rejection_reason = args.rejection_reason;
    if (args.message_text !== undefined) updates.message_text = args.message_text;
    if (args.scheduled_at !== undefined) updates.scheduled_at = args.scheduled_at;
    await ctx.db.patch(args.id, updates);
    return await ctx.db.get(args.id);
  },
});

export const cancelScheduled = mutation({
  args: { id: v.id("outbound_scheduled_messages"), user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    // Hard delete — matches the Supabase DELETE behavior in the legacy route.
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

export const markSent = mutation({
  args: {
    id: v.id("outbound_scheduled_messages"),
    user_id: v.string(),
    god_draft_id: v.optional(v.string()),
    sent_at: v.optional(v.number()),                // unix ms; null for delayed sends
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    await ctx.db.patch(args.id, {
      status: "sent",
      sent_at: args.sent_at ?? undefined,
      god_draft_id: args.god_draft_id ?? undefined,
      updated_at: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

export const markFailed = mutation({
  args: {
    id: v.id("outbound_scheduled_messages"),
    user_id: v.string(),
    rejection_reason: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    await ctx.db.patch(args.id, {
      status: "failed",
      rejection_reason: args.rejection_reason,
      updated_at: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

// Atomic claim — mirrors the agent_jobs claim pattern (locked_by + locked_until).
// Returns up to `limit` due rows newly claimed for this caller.
export const claimNextDue = internalMutation({
  args: {
    locker_id: v.string(),
    lock_ttl_ms: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = args.limit ?? 25;
    const due = await ctx.db
      .query("outbound_scheduled_messages")
      .withIndex("by_status_due", (q) =>
        q.eq("status", "pending").lte("scheduled_at", now),
      )
      .take(limit);
    // Convex mutations are atomic and serialized per row; flipping status
    // to "approved" stops the next caller from picking the same row up.
    const claimed: Array<typeof due[number]> = [];
    for (const row of due) {
      await ctx.db.patch(row._id, {
        status: "approved",
        updated_at: now,
      });
      claimed.push({ ...row, status: "approved" });
    }
    return { claimed_count: claimed.length, locker_id: args.locker_id, lock_ttl_ms: args.lock_ttl_ms ?? 0, claimed };
  },
});

// ------------------------------------------------------------
// Cron drain — called every 60 s by crons.ts.
// Finds approved rows whose scheduled_at has passed, enqueues a
// send_imessage agent_jobs row for each, and marks the row sent to
// prevent double-fire on the next tick.
// AI-9598 — fixes the missing auto-fire that was broken because
// crons.ts pointed at the old scheduled_messages table.
// ------------------------------------------------------------

export const sendDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("outbound_scheduled_messages")
      .withIndex("by_status_due", (q) =>
        q.eq("status", "approved").lte("scheduled_at", now),
      )
      .take(25);

    const enqueued: string[] = [];
    for (const row of due) {
      if (!row.phone) {
        // No delivery handle — skip rather than silently drop.
        await ctx.db.patch(row._id, {
          status: "failed",
          rejection_reason: "no phone/handle; cannot deliver",
          updated_at: now,
        });
        continue;
      }

      // Mark sent first (atomic mutation serialization prevents
      // a concurrent tick from claiming the same row).
      await ctx.db.patch(row._id, {
        status: "sent",
        sent_at: now,
        updated_at: now,
      });

      // Enqueue a send_imessage job for the Mac Mini runner.
      // Payload mirrors the shape expected by _handle_send_imessage in
      // agent/clapcheeks/convex_runner.py: { handle, body }.
      await ctx.db.insert("agent_jobs", {
        user_id: row.user_id,
        job_type: "send_imessage",
        payload: {
          handle: row.phone,
          body: row.message_text,
          outbound_scheduled_message_id: row._id,
          match_name: row.match_name,
          source: "outbound_cron",
        },
        status: "queued",
        priority: 1,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
      });

      enqueued.push(row._id);
    }

    return { enqueued_count: enqueued.length, enqueued };
  },
});

// ------------------------------------------------------------
// Backfill helper — used by scripts/backfill_outbound_supabase_to_convex.py.
// Idempotent: if a row with the same legacy_id already exists, skip.
// ------------------------------------------------------------
export const backfillScheduledMessage = mutation({
  args: {
    legacy_id: v.string(),
    user_id: v.string(),
    match_id: v.optional(v.string()),
    match_name: v.string(),
    platform: v.string(),
    phone: v.optional(v.string()),
    message_text: v.string(),
    scheduled_at: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    sequence_type: v.union(
      v.literal("follow_up"),
      v.literal("manual"),
      v.literal("app_to_text"),
    ),
    sequence_step: v.optional(v.number()),
    delay_hours: v.optional(v.number()),
    rejection_reason: v.optional(v.string()),
    sent_at: v.optional(v.number()),
    god_draft_id: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("outbound_scheduled_messages")
      .withIndex("by_legacy_id", (q) => q.eq("legacy_id", args.legacy_id))
      .first();
    if (existing) {
      return { skipped: true, id: existing._id };
    }
    const id = await ctx.db.insert("outbound_scheduled_messages", args);
    return { skipped: false, id };
  },
});
