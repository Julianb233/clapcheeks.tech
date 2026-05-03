import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Init or fetch the drip state for a conversation.
export const upsertState = mutation({
  args: {
    conversation_id: v.id("conversations"),
    user_id: v.string(),
    state: v.string(),
    next_action_at: v.optional(v.number()),
    cool_down_until: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("drip_states")
      .withIndex("by_conversation", (q) =>
        q.eq("conversation_id", args.conversation_id),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        state: args.state,
        next_action_at: args.next_action_at,
        cool_down_until: args.cool_down_until,
        metadata: args.metadata,
        updated_at: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("drip_states", {
      conversation_id: args.conversation_id,
      user_id: args.user_id,
      state: args.state,
      next_action_at: args.next_action_at,
      cool_down_until: args.cool_down_until,
      consecutive_no_reply: 0,
      metadata: args.metadata,
      updated_at: now,
    });
  },
});

// Cron: advance any drip state whose next_action_at has elapsed.
// For each, enqueue a job for the local Mac agent to act on.
export const advance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("drip_states")
      .withIndex("by_next_action")
      .filter((q) =>
        q.and(
          q.neq(q.field("state"), "closed"),
          q.lte(q.field("next_action_at"), now),
        ),
      )
      .take(100);

    let enqueued = 0;
    for (const drip of due) {
      // Hand off to the agent_jobs queue — actual reply generation +
      // delivery happens via the Mac agent picking this up.
      await ctx.db.insert("agent_jobs", {
        user_id: drip.user_id,
        job_type: "drip_reengagement",
        payload: {
          conversation_id: drip.conversation_id,
          state: drip.state,
        },
        status: "queued",
        priority: 1,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
      });

      // Bump cool_down so we don't enqueue the same drip again immediately.
      await ctx.db.patch(drip._id, {
        cool_down_until: now + 6 * 60 * 60 * 1000, // 6 hours
        next_action_at: undefined,
        updated_at: now,
      });
      enqueued++;
    }
    return { scanned: due.length, enqueued };
  },
});

// Live view for dashboard.
export const listForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("drip_states")
      .filter((q) => q.eq(q.field("user_id"), args.user_id))
      .take(200);
  },
});
