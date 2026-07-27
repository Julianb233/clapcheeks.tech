import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { buildScheduledMessageDispatch } from "../lib/integrations/juliboop/scheduled-dispatch";

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
    const id = await ctx.db.insert("scheduled_messages", {
      ...args,
      status: "pending",
      created_at: now,
      updated_at: now,
    });
    await ctx.scheduler.runAt(
      args.scheduled_for,
      (internal as any).scheduled_messages.sendDue,
      {},
    );
    return id;
  },
});

export const createBridgeCommand = mutation({
  args: {
    conversation_id: v.id("conversations"),
    user_id: v.string(),
    body: v.string(),
    scheduled_for: v.number(),
    schedule_reason: v.optional(v.string()),
    idempotency_key: v.string(),
    execution_mode: v.union(v.literal("smart"), v.literal("fixed")),
    expected_conversation_updated_at: v.number(),
    approval_envelope: v.optional(v.any()),
    mutation_snapshot: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const statuses = [
      "pending",
      "accepted",
      "queued",
      "sent",
      "delivered",
      "cancelled",
      "blocked",
      "failed",
    ] as const;
    for (const status of statuses) {
      const rows = await ctx.db
        .query("scheduled_messages")
        .withIndex("by_user", (q) =>
          q.eq("user_id", args.user_id).eq("status", status),
        )
        .order("desc")
        .take(100);
      const replay = rows.find(
        (row) => row.idempotency_key === args.idempotency_key,
      );
      if (replay) {
        return {
          id: replay._id,
          state: replay.status,
          replayed: true,
          updated_at: replay.updated_at,
        };
      }
    }

    const now = Date.now();
    const id = await ctx.db.insert("scheduled_messages", {
      conversation_id: args.conversation_id,
      user_id: args.user_id,
      body: args.body,
      scheduled_for: args.scheduled_for,
      schedule_reason: args.schedule_reason,
      idempotency_key: args.idempotency_key,
      execution_mode: args.execution_mode,
      expected_conversation_updated_at:
        args.expected_conversation_updated_at,
      approval_envelope: args.approval_envelope,
      mutation_snapshot: args.mutation_snapshot,
      status: "accepted",
      created_at: now,
      updated_at: now,
    });
    await ctx.scheduler.runAt(
      args.scheduled_for,
      (internal as any).scheduled_messages.sendDue,
      {},
    );
    return { id, state: "accepted" as const, replayed: false, updated_at: now };
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

export const listForUser = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 200);
    const statuses = [
      "pending",
      "accepted",
      "queued",
      "sent",
      "delivered",
      "cancelled",
      "blocked",
      "failed",
    ] as const;
    const groups = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("scheduled_messages")
          .withIndex("by_user", (q) =>
            q.eq("user_id", args.user_id).eq("status", status),
          )
          .order("desc")
          .take(limit),
      ),
    );
    return groups
      .flat()
      .sort((a, b) => b.scheduled_for - a.scheduled_for)
      .slice(0, limit);
  },
});

export const get = query({
  args: { id: v.id("scheduled_messages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Cancel a pending message before it sends.
export const cancel = mutation({
  args: { id: v.id("scheduled_messages") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) throw new Error("Not found");
    if (!["pending", "accepted"].includes(msg.status)) {
      throw new Error(`Cannot cancel message in status ${msg.status}`);
    }
    await ctx.db.patch(args.id, {
      status: "cancelled",
      updated_at: Date.now(),
    });
  },
});

export const reschedule = mutation({
  args: {
    id: v.id("scheduled_messages"),
    scheduled_for: v.number(),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) throw new Error("Not found");
    if (!["pending", "accepted"].includes(msg.status)) {
      throw new Error(`Cannot reschedule message in status ${msg.status}`);
    }
    const now = Date.now();
    if (!Number.isFinite(args.scheduled_for) || args.scheduled_for <= now) {
      throw new Error("scheduled_for must be in the future");
    }
    await ctx.db.patch(args.id, {
      scheduled_for: args.scheduled_for,
      updated_at: now,
    });
    await ctx.scheduler.runAt(
      args.scheduled_for,
      (internal as any).scheduled_messages.sendDue,
      {},
    );
    return {
      id: args.id,
      state: msg.status,
      scheduled_for: args.scheduled_for,
      updated_at: now,
    };
  },
});

// Cron-driven worker. Picks up every scheduled_message whose scheduled_for
// is past now and kicks off the send. This replaces the pg_cron + worker
// loop that polled clapcheeks_scheduled_messages on Postgres.
export const sendDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("scheduled_messages")
      .withIndex("by_status_due", (q) =>
        q.eq("status", "pending").lte("scheduled_for", now),
      )
      .take(50);
    const accepted = await ctx.db
      .query("scheduled_messages")
      .withIndex("by_status_due", (q) =>
        q.eq("status", "accepted").lte("scheduled_for", now),
      )
      .take(50);
    const due = [...pending, ...accepted]
      .sort((a, b) => a.scheduled_for - b.scheduled_for)
      .slice(0, 50);

    let dispatched = 0;
    for (const msg of due) {
      const conversation = await ctx.db.get(msg.conversation_id);
      if (!conversation) {
        await ctx.db.patch(msg._id, {
          status: "failed",
          failure_reason: "conversation_not_found",
          updated_at: now,
        });
        continue;
      }
      const metadata =
        conversation.metadata
        && typeof conversation.metadata === "object"
        && !Array.isArray(conversation.metadata)
          ? conversation.metadata as Record<string, unknown>
          : undefined;
      const dispatch = buildScheduledMessageDispatch({
        platform: conversation.platform,
        scheduledMessageId: String(msg._id),
        conversationId: String(conversation._id),
        personId: conversation.person_id
          ? String(conversation.person_id)
          : conversation.platform === "imessage"
            ? undefined
            : conversation.external_match_id,
        userId: msg.user_id,
        body: msg.body,
        executionMode: msg.execution_mode ?? "fixed",
        expectedConversationUpdatedAt:
          msg.expected_conversation_updated_at,
        conversationUpdatedAt: conversation.updated_at,
        externalMatchId: conversation.external_match_id,
        metadata,
      });

      if (dispatch.kind === "blocked") {
        await ctx.db.patch(msg._id, {
          status: "blocked",
          failure_reason: dispatch.reasonCode,
          updated_at: now,
        });
        continue;
      }

      const jobId = await ctx.db.insert("agent_jobs", {
        user_id: msg.user_id,
        job_type: dispatch.jobType,
        payload: {
          ...dispatch.payload,
          user_id: msg.user_id,
          enqueued_at_ms: now,
          expires_at_ms: now + 60 * 60 * 1000,
          approval_envelope: msg.approval_envelope,
          mutation_snapshot: msg.mutation_snapshot,
        },
        status: "queued",
        priority: 5,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
        dedupe_key: `scheduled:${String(msg._id)}`,
      });
      await ctx.db.patch(msg._id, {
        status: "queued",
        job_id: jobId,
        updated_at: now,
      });
      dispatched++;
    }

    return { dispatched, scanned: due.length };
  },
});
