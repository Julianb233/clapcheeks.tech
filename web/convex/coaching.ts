import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Coaching sessions + tip feedback (replaces
// clapcheeks_coaching_sessions + clapcheeks_tip_feedback).

// ---------------------------------------------------------------------------
// coaching_sessions
// ---------------------------------------------------------------------------
export const upsertSession = mutation({
  args: {
    user_id: v.string(),
    week_start: v.string(),
    generated_at: v.optional(v.number()),
    tips: v.any(),
    stats_snapshot: v.optional(v.any()),
    feedback_score: v.optional(v.number()),
    model_used: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const generated_at = args.generated_at ?? now;
    const existing = await ctx.db
      .query("coaching_sessions")
      .withIndex("by_user_week", (q) => q.eq("user_id", args.user_id).eq("week_start", args.week_start))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        generated_at,
        tips: args.tips,
        stats_snapshot: args.stats_snapshot,
        feedback_score: args.feedback_score,
        model_used: args.model_used,
      });
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("coaching_sessions", {
      user_id: args.user_id,
      generated_at,
      week_start: args.week_start,
      tips: args.tips,
      stats_snapshot: args.stats_snapshot,
      feedback_score: args.feedback_score,
      model_used: args.model_used,
      created_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});

export const getSessionForWeek = query({
  args: { user_id: v.string(), week_start: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("coaching_sessions")
      .withIndex("by_user_week", (q) => q.eq("user_id", args.user_id).eq("week_start", args.week_start))
      .first();
  },
});

export const listRecentForUser = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("coaching_sessions")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(args.limit ?? 8);
  },
});

// AI-9537 — Used by weekly-report fallback tip helper.
// Returns the single most recent session row across all users.
export const getMostRecentSession = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("coaching_sessions").order("desc").take(1);
    return rows[0] ?? null;
  },
});

// AI-9537 — Used by weekly report generator.
// Returns the most recent session for a user whose created_at falls in the
// inclusive [start_ms, end_ms] window. Falls back to null when none exists.
export const getRecentForUserInRange = query({
  args: {
    user_id: v.string(),
    start_ms: v.number(),
    end_ms: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("coaching_sessions")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .collect();
    for (const r of rows) {
      if (r.created_at >= args.start_ms && r.created_at <= args.end_ms) return r;
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// tip_feedback
// ---------------------------------------------------------------------------
export const upsertTipFeedback = mutation({
  args: {
    user_id: v.string(),
    coaching_session_id: v.id("coaching_sessions"),
    tip_index: v.number(),
    helpful: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tip_feedback")
      .withIndex("by_user_session_tip", (q) =>
        q
          .eq("user_id", args.user_id)
          .eq("coaching_session_id", args.coaching_session_id)
          .eq("tip_index", args.tip_index),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { helpful: args.helpful });
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("tip_feedback", {
      user_id: args.user_id,
      coaching_session_id: args.coaching_session_id,
      tip_index: args.tip_index,
      helpful: args.helpful,
      created_at: Date.now(),
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});

export const listFeedbackForSession = query({
  args: { coaching_session_id: v.id("coaching_sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tip_feedback")
      .withIndex("by_session", (q) => q.eq("coaching_session_id", args.coaching_session_id))
      .collect();
  },
});
