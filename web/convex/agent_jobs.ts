import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Enqueue a job for the local Mac agent to pick up.
export const enqueue = mutation({
  args: {
    user_id: v.string(),
    job_type: v.string(),
    payload: v.any(),
    priority: v.optional(v.number()),
    max_attempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("agent_jobs", {
      user_id: args.user_id,
      job_type: args.job_type,
      payload: args.payload,
      status: "queued",
      priority: args.priority ?? 0,
      attempts: 0,
      max_attempts: args.max_attempts ?? 3,
      created_at: now,
      updated_at: now,
    });
  },
});

// Local agent claims the next-highest-priority queued job for a user.
// Atomic via Convex's optimistic concurrency — two agents can't grab
// the same job.
export const claim = mutation({
  args: {
    user_id: v.string(),
    agent_instance_id: v.string(),
    lock_seconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("status", "queued"),
      )
      .order("desc")
      .first();

    if (!queued) return null;

    const now = Date.now();
    const lockMs = (args.lock_seconds ?? 120) * 1000;
    await ctx.db.patch(queued._id, {
      status: "running",
      locked_by: args.agent_instance_id,
      locked_until: now + lockMs,
      attempts: queued.attempts + 1,
      updated_at: now,
    });
    return await ctx.db.get(queued._id);
  },
});

// Mark a claimed job as completed.
export const complete = mutation({
  args: {
    id: v.id("agent_jobs"),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "completed",
      result: args.result,
      completed_at: now,
      updated_at: now,
    });
  },
});

// Mark a claimed job as failed. If under max_attempts, requeue.
export const fail = mutation({
  args: {
    id: v.id("agent_jobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) throw new Error("Not found");
    const now = Date.now();
    if (job.attempts >= job.max_attempts) {
      await ctx.db.patch(args.id, {
        status: "failed",
        last_error: args.error,
        updated_at: now,
      });
    } else {
      await ctx.db.patch(args.id, {
        status: "queued",
        last_error: args.error,
        locked_by: undefined,
        locked_until: undefined,
        updated_at: now,
      });
    }
  },
});

// Live view of pending + running jobs for a user (powers the dashboard).
export const listForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("status", "queued"),
      )
      .take(50);
    const running = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("status", "running"),
      )
      .take(50);
    return [...running, ...queued];
  },
});

// AI-9500-C: Enqueue a sync_hinge job for the Mac Mini agent.
// Called by the 5-minute cron in crons.ts.
// Dedup guard: skips insert if a queued or running sync_hinge job already
// exists for the user to prevent queue flooding.
export const enqueueHingeSync = internalMutation({
  args: {
    user_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = args.user_id ?? "fleet-julian";
    const now = Date.now();

    // Check for an already-queued or running job of this type
    const existing = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", userId).eq("status", "queued"),
      )
      .filter((q) => q.eq(q.field("job_type"), "sync_hinge"))
      .first();

    if (existing) {
      return { enqueued: false, reason: "already_queued", job_id: existing._id };
    }

    const running = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", userId).eq("status", "running"),
      )
      .filter((q) => q.eq(q.field("job_type"), "sync_hinge"))
      .first();

    if (running) {
      return { enqueued: false, reason: "already_running", job_id: running._id };
    }

    const id = await ctx.db.insert("agent_jobs", {
      user_id: userId,
      job_type: "sync_hinge",
      payload: {},
      status: "queued",
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    });

    return { enqueued: true, reason: null, job_id: id };
  },
});

// Cron: any 'running' job whose lock expired without complete/fail is
// considered stuck. Requeue it (or fail if attempts maxed).
export const reapStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const running = await ctx.db
      .query("agent_jobs")
      .withIndex("by_status_priority", (q) => q.eq("status", "running"))
      .take(200);

    let reaped = 0;
    for (const job of running) {
      if (!job.locked_until || job.locked_until > now) continue;
      if (job.attempts >= job.max_attempts) {
        await ctx.db.patch(job._id, {
          status: "failed",
          last_error: "Lock expired without completion",
          updated_at: now,
        });
      } else {
        await ctx.db.patch(job._id, {
          status: "queued",
          locked_by: undefined,
          locked_until: undefined,
          last_error: "Lock expired — requeued",
          updated_at: now,
        });
      }
      reaped++;
    }
    return { scanned: running.length, reaped };
  },
});

// (Duplicate enqueueHingeSync from main was removed during integration→main merge.
// The canonical version above accepts an optional user_id arg.)

// ---------------------------------------------------------------------------
// AI-9500 W2 E13 — enqueueCallsSync
//
// Enqueues a sync_calls job for the Mac Mini daemon every 15 minutes.
// The daemon reads chat.db via _handle_sync_calls in convex_runner.py and
// upserts records via calls:upsertCall.
// Dedup guard: skips if a queued or running job already exists.
// ---------------------------------------------------------------------------
export const enqueueCallsSync = internalMutation({
  args: {
    user_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = args.user_id ?? "fleet-julian";
    const now = Date.now();

    // Skip if one is already queued
    const existingQueued = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", userId).eq("status", "queued"),
      )
      .filter((q) => q.eq(q.field("job_type"), "sync_calls"))
      .first();

    if (existingQueued) {
      return { enqueued: false, reason: "already_queued", job_id: existingQueued._id };
    }

    // Skip if one is actively running
    const existingRunning = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", userId).eq("status", "running"),
      )
      .filter((q) => q.eq(q.field("job_type"), "sync_calls"))
      .first();

    if (existingRunning) {
      return { enqueued: false, reason: "already_running", job_id: existingRunning._id };
    }

    const id = await ctx.db.insert("agent_jobs", {
      user_id: userId,
      job_type: "sync_calls",
      payload: { lookback_days: 30 },
      status: "queued",
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    });

    return { enqueued: true, reason: null, job_id: id };
  },
});
