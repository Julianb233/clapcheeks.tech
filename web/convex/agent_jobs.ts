import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  buildMorningSwipeJobs,
  pacificWindowKey,
} from "../lib/autonomy/morning-schedule";
import { claimContextMatches } from "../lib/agent-jobs/lease";

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

export const enqueueAt = mutation({
  args: {
    user_id: v.string(),
    job_type: v.string(),
    payload: v.any(),
    run_at: v.number(),
    priority: v.optional(v.number()),
    max_attempts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ scheduled_id: unknown; run_at: number }> => {
    const insertScheduled = (internal as any).agent_jobs._insertScheduled;
    const scheduledId: unknown = await ctx.scheduler.runAt(
      args.run_at,
      insertScheduled,
      {
        user_id: args.user_id,
        job_type: args.job_type,
        payload: args.payload,
        priority: args.priority,
        max_attempts: args.max_attempts,
      },
    );
    return { scheduled_id: scheduledId, run_at: args.run_at };
  },
});

export const _insertScheduled = internalMutation({
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
// AI-9545 — claim a queued job whose job_type is in `allowed_job_types`.
// Used by the VPS cc-calendar-worker (only handles fetch_calendar_slots /
// related calendar jobs) so a single broad runner doesn't steal jobs.
export const claimByTypes = mutation({
  args: {
    user_id: v.string(),
    agent_instance_id: v.string(),
    allowed_job_types: v.array(v.string()),
    lock_seconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("status", "queued"),
      )
      .order("desc")
      .collect();

    const allowed = new Set(args.allowed_job_types);
    const target = queued.find((j) => allowed.has(j.job_type));
    if (!target) return null;

    const now = Date.now();
    const lockMs = (args.lock_seconds ?? 120) * 1000;
    await ctx.db.patch(target._id, {
      status: "running",
      locked_by: args.agent_instance_id,
      locked_until: now + lockMs,
      attempts: target.attempts + 1,
      updated_at: now,
    });
    return await ctx.db.get(target._id);
  },
});

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
    agent_instance_id: v.optional(v.string()),
    claim_attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) throw new Error("Not found");
    if (!claimContextMatches(job, args.agent_instance_id, args.claim_attempt)) {
      throw new Error("Stale or foreign job claim");
    }
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
    agent_instance_id: v.optional(v.string()),
    claim_attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) throw new Error("Not found");
    if (!claimContextMatches(job, args.agent_instance_id, args.claim_attempt)) {
      throw new Error("Stale or foreign job claim");
    }
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

// AI-9650 — fail a job permanently, bypass retry cap. Used by the runner
// when the handler raises a code-level exception (TypeError, AttributeError,
// ImportError, SyntaxError, NameError) — those are bugs, not transient,
// and retrying 3x just burns 3x the broken sends. Caller passes the
// classified error_class so it's queryable in telemetry.
export const failPermanent = mutation({
  args: {
    id: v.id("agent_jobs"),
    error: v.string(),
    error_class: v.optional(v.string()),
    agent_instance_id: v.optional(v.string()),
    claim_attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) throw new Error("Not found");
    if (!claimContextMatches(job, args.agent_instance_id, args.claim_attempt)) {
      throw new Error("Stale or foreign job claim");
    }
    const now = Date.now();
    const cls = args.error_class ? `[${args.error_class}] ` : "";
    await ctx.db.patch(args.id, {
      status: "failed",
      last_error: `${cls}${args.error}`,
      // Bump attempts so accidental re-claims still terminate.
      attempts: job.max_attempts,
      locked_by: undefined,
      locked_until: undefined,
      updated_at: now,
    });
  },
});

export const renewLease = mutation({
  args: {
    id: v.id("agent_jobs"),
    agent_instance_id: v.string(),
    claim_attempt: v.number(),
    lock_seconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) throw new Error("Not found");
    if (!claimContextMatches(job, args.agent_instance_id, args.claim_attempt)) {
      throw new Error("Stale or foreign job claim");
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      locked_until: now + (args.lock_seconds ?? 120) * 1000,
      last_heartbeat_at: now,
      updated_at: now,
    });
    return { renewed: true, locked_until: now + (args.lock_seconds ?? 120) * 1000 };
  },
});

// Live view of pending + running jobs for a user (powers the dashboard).
export const listForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const statuses = ["queued", "running", "completed", "failed"] as const;
    const groups = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("agent_jobs")
          .withIndex("by_user_status", (q) =>
            q.eq("user_id", args.user_id).eq("status", status),
          )
          .order("desc")
          .take(100),
      ),
    );
    return groups
      .flat()
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, 100);
  },
});

export const enqueueMorningSwipes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const userId = "fleet-julian";
    const baseKey = pacificWindowKey(Date.now(), "swipes");
    if (!baseKey) return { enqueued: 0, reason: "outside_pacific_morning" };

    const config = await ctx.db
      .query("autonomy_config")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .first();
    if (config?.global_level !== "full_auto") {
      return {
        enqueued: 0,
        reason: `autonomy_${config?.global_level ?? "unset"}`,
      };
    }

    const existing = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_type", (q) =>
        q.eq("user_id", userId).eq("job_type", "run_swipe"),
      )
      .collect();
    let enqueued = 0;
    for (const payload of buildMorningSwipeJobs(baseKey)) {
      if (existing.some((job) => job.payload?.schedule_key === payload.schedule_key)) {
        continue;
      }
      const now = Date.now();
      await ctx.db.insert("agent_jobs", {
        user_id: userId,
        job_type: "run_swipe",
        payload,
        status: "queued",
        priority: 1,
        attempts: 0,
        max_attempts: 2,
        created_at: now,
        updated_at: now,
      });
      enqueued++;
    }
    return { enqueued, reason: enqueued ? undefined : "already_ran_today" };
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

// AI-9500 W2 #J — Enqueue a sync_tinder job for the Mac Mini agent.
// Called by the 5-minute cron in crons.ts.
// Dedup guard: skips insert if a queued or running sync_tinder job already
// exists for the user to prevent queue flooding.
export const enqueueTinderSync = internalMutation({
  args: {
    user_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = args.user_id ?? "fleet-julian";
    const now = Date.now();

    // Check for an already-queued job of this type
    const existingQueued = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", userId).eq("status", "queued"),
      )
      .filter((q) => q.eq(q.field("job_type"), "sync_tinder"))
      .first();

    if (existingQueued) {
      return { enqueued: false, reason: "already_queued", job_id: existingQueued._id };
    }

    // Check for an already-running job of this type
    const existingRunning = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", userId).eq("status", "running"),
      )
      .filter((q) => q.eq(q.field("job_type"), "sync_tinder"))
      .first();

    if (existingRunning) {
      return { enqueued: false, reason: "already_running", job_id: existingRunning._id };
    }

    const id = await ctx.db.insert("agent_jobs", {
      user_id: userId,
      job_type: "sync_tinder",
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
