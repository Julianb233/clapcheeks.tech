// AI-9535 outbound migration — Convex functions for queued_replies,
// posting_queue, and approval_queue.
//
// Replaces the Supabase clapcheeks_queued_replies, clapcheeks_posting_queue,
// and clapcheeks_approval_queue CRUD that lived in:
//   - web/app/api/conversation/send/route.ts
//   - web/app/api/conversation/[matchId]/attach/route.ts
//   - web/app/api/imessage/test/route.ts
//   - web/app/api/autonomy-approval/[id]/route.ts
//   - web/app/api/content-library/auto-fill/route.ts
//   - web/app/(main)/dashboard/content-library/*
//   - web/app/(main)/autonomy/*
//   - web/components/layout/app-sidebar.tsx
//
// Auth still resolves user_id via Supabase in the calling Next.js route. All
// mutations enforce ownership via the user_id arg matching the row's user_id.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// =============================================================
// queued_replies
// =============================================================

export const enqueueReply = mutation({
  args: {
    user_id: v.string(),
    match_name: v.optional(v.string()),
    platform: v.optional(v.string()),
    text: v.optional(v.string()),
    body: v.optional(v.string()),
    recipient_handle: v.optional(v.string()),
    source: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed"),
    )),
    legacy_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("queued_replies", {
      user_id: args.user_id,
      match_name: args.match_name,
      platform: args.platform,
      text: args.text,
      body: args.body,
      recipient_handle: args.recipient_handle,
      source: args.source,
      status: args.status ?? "queued",
      legacy_id: args.legacy_id,
      created_at: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const listRepliesForUser = query({
  args: {
    user_id: v.string(),
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    let rows;
    if (args.source) {
      rows = await ctx.db
        .query("queued_replies")
        .withIndex("by_user_source", (q) =>
          q.eq("user_id", args.user_id).eq("source", args.source),
        )
        .collect();
    } else {
      rows = await ctx.db
        .query("queued_replies")
        .withIndex("by_user_created", (q) => q.eq("user_id", args.user_id))
        .collect();
    }
    rows.sort((a, b) => b.created_at - a.created_at);
    return rows.slice(0, limit);
  },
});

export const updateReplyStatus = mutation({
  args: {
    id: v.id("queued_replies"),
    user_id: v.string(),
    status: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    await ctx.db.patch(args.id, { status: args.status });
    return await ctx.db.get(args.id);
  },
});

// Backfill helper.
export const backfillQueuedReply = mutation({
  args: {
    legacy_id: v.string(),
    user_id: v.string(),
    match_name: v.optional(v.string()),
    platform: v.optional(v.string()),
    text: v.optional(v.string()),
    body: v.optional(v.string()),
    recipient_handle: v.optional(v.string()),
    source: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("queued_replies")
      .withIndex("by_legacy_id", (q) => q.eq("legacy_id", args.legacy_id))
      .first();
    if (existing) return { skipped: true, id: existing._id };
    const id = await ctx.db.insert("queued_replies", args);
    return { skipped: false, id };
  },
});

// =============================================================
// posting_queue
// =============================================================

export const enqueuePost = mutation({
  args: {
    user_id: v.string(),
    content_library_id: v.string(),
    scheduled_for: v.number(),
    legacy_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("posting_queue", {
      user_id: args.user_id,
      content_library_id: args.content_library_id,
      scheduled_for: args.scheduled_for,
      status: "pending",
      legacy_id: args.legacy_id,
      created_at: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const listPostsForUser = query({
  args: {
    user_id: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    let rows;
    if (args.status && args.status !== "all") {
      rows = await ctx.db
        .query("posting_queue")
        .withIndex("by_user_status", (q) =>
          q.eq("user_id", args.user_id).eq(
            "status",
            args.status as "pending" | "in_progress" | "posted" | "failed" | "cancelled",
          ),
        )
        .collect();
    } else {
      rows = await ctx.db
        .query("posting_queue")
        .withIndex("by_user_scheduled", (q) => q.eq("user_id", args.user_id))
        .collect();
    }
    rows.sort((a, b) => b.scheduled_for - a.scheduled_for);
    return rows.slice(0, limit);
  },
});

export const findPendingPostForLibraryItem = query({
  args: { user_id: v.string(), content_library_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("posting_queue")
      .withIndex("by_content_library", (q) =>
        q.eq("content_library_id", args.content_library_id),
      )
      .collect();
    return rows.find(
      (r) => r.user_id === args.user_id && r.status === "pending",
    );
  },
});

export const markPostInProgress = mutation({
  args: {
    id: v.id("posting_queue"),
    user_id: v.string(),
    agent_job_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    await ctx.db.patch(args.id, {
      status: "in_progress",
      agent_job_id: args.agent_job_id,
    });
    return await ctx.db.get(args.id);
  },
});

export const markPostPosted = mutation({
  args: { id: v.id("posting_queue"), user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    await ctx.db.patch(args.id, {
      status: "posted",
      posted_at: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

export const markPostFailed = mutation({
  args: { id: v.id("posting_queue"), user_id: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    await ctx.db.patch(args.id, {
      status: "failed",
      error: args.error,
    });
    return await ctx.db.get(args.id);
  },
});

export const cancelPost = mutation({
  args: { id: v.id("posting_queue"), user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    await ctx.db.patch(args.id, { status: "cancelled" });
    return await ctx.db.get(args.id);
  },
});

export const backfillPostingQueue = mutation({
  args: {
    legacy_id: v.string(),
    user_id: v.string(),
    content_library_id: v.string(),
    scheduled_for: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("posted"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    agent_job_id: v.optional(v.string()),
    posted_at: v.optional(v.number()),
    error: v.optional(v.string()),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("posting_queue")
      .withIndex("by_legacy_id", (q) => q.eq("legacy_id", args.legacy_id))
      .first();
    if (existing) return { skipped: true, id: existing._id };
    const id = await ctx.db.insert("posting_queue", args);
    return { skipped: false, id };
  },
});

// =============================================================
// approval_queue
// =============================================================

export const enqueueApproval = mutation({
  args: {
    user_id: v.string(),
    action_type: v.string(),
    match_id: v.optional(v.string()),
    match_name: v.optional(v.string()),
    platform: v.optional(v.string()),
    proposed_text: v.optional(v.string()),
    proposed_data: v.optional(v.any()),
    confidence: v.optional(v.number()),
    ai_reasoning: v.optional(v.string()),
    expires_at: v.optional(v.number()),
    legacy_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("approval_queue", {
      user_id: args.user_id,
      action_type: args.action_type,
      match_id: args.match_id,
      match_name: args.match_name ?? "",
      platform: args.platform ?? "",
      proposed_text: args.proposed_text,
      proposed_data: args.proposed_data ?? {},
      confidence: args.confidence ?? 0,
      ai_reasoning: args.ai_reasoning ?? "",
      status: "pending",
      expires_at: args.expires_at ?? now + 24 * 60 * 60 * 1000,
      legacy_id: args.legacy_id,
      created_at: now,
    });
    return await ctx.db.get(id);
  },
});

export const listApprovalsForUser = query({
  args: {
    user_id: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    let rows;
    if (args.status && args.status !== "all") {
      rows = await ctx.db
        .query("approval_queue")
        .withIndex("by_user_status", (q) =>
          q.eq("user_id", args.user_id).eq(
            "status",
            args.status as "pending" | "approved" | "rejected" | "expired",
          ),
        )
        .collect();
    } else {
      rows = await ctx.db
        .query("approval_queue")
        .withIndex("by_user_status", (q) => q.eq("user_id", args.user_id))
        .collect();
    }
    rows.sort((a, b) => b.created_at - a.created_at);
    return rows.slice(0, limit);
  },
});

export const countPendingApprovalsForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("approval_queue")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("status", "pending"),
      )
      .collect();
    return rows.length;
  },
});

export const decideApproval = mutation({
  args: {
    id: v.id("approval_queue"),
    user_id: v.string(),
    status: v.union(v.literal("approved"), v.literal("rejected")),
    edited_text: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Not found");
    if (row.user_id !== args.user_id) throw new Error("Forbidden");
    const now = Date.now();
    const updates: Record<string, unknown> = {
      status: args.status,
      decided_at: now,
    };
    if (
      args.status === "approved" &&
      typeof args.edited_text === "string" &&
      args.edited_text.trim()
    ) {
      updates.proposed_text = args.edited_text.trim();
    }
    await ctx.db.patch(args.id, updates);

    // AI-9599: when approved, enqueue an agent_jobs row so the Mac runner
    // actually fires the iMessage. Without this the approval was a dead-end
    // (status flipped but nothing else happened).
    if (args.status === "approved") {
      const body =
        (updates.proposed_text as string | undefined) ??
        row.proposed_text ??
        undefined;
      // proposed_data may carry person_id / handle set by the autonomy engine.
      const proposedData: Record<string, unknown> =
        typeof row.proposed_data === "object" && row.proposed_data !== null
          ? (row.proposed_data as Record<string, unknown>)
          : {};
      await ctx.db.insert("agent_jobs", {
        user_id: args.user_id,
        job_type: "send_imessage",
        payload: {
          match_id: row.match_id,
          person_id: proposedData.person_id,
          handle: proposedData.handle,
          body,
          source: "approved_draft",
          approval_id: args.id,
        },
        status: "queued",
        priority: 1,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
      });
    }

    return await ctx.db.get(args.id);
  },
});

export const backfillApproval = mutation({
  args: {
    legacy_id: v.string(),
    user_id: v.string(),
    action_type: v.string(),
    match_id: v.optional(v.string()),
    match_name: v.optional(v.string()),
    platform: v.optional(v.string()),
    proposed_text: v.optional(v.string()),
    proposed_data: v.optional(v.any()),
    confidence: v.number(),
    ai_reasoning: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    expires_at: v.number(),
    decided_at: v.optional(v.number()),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("approval_queue")
      .withIndex("by_legacy_id", (q) => q.eq("legacy_id", args.legacy_id))
      .first();
    if (existing) return { skipped: true, id: existing._id };
    const id = await ctx.db.insert("approval_queue", args);
    return { skipped: false, id };
  },
});
