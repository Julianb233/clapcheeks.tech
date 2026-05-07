import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// AI-9536 — Weekly reports on Convex.
//
// Replaces Supabase clapcheeks_weekly_reports. One row per
// (user_id, week_start_ms). The metrics_snapshot is a free-form JSONB blob
// produced by lib/reports/generate-report-data.ts.

// ----------------------------------------------------------------------------
// upsertWeeklyReport — idempotent on (user_id, week_start_ms).
// ----------------------------------------------------------------------------
export const upsertWeeklyReport = mutation({
  args: {
    user_id: v.string(),
    week_start_ms: v.number(),
    week_end_ms: v.number(),
    week_start_iso: v.string(),
    metrics_snapshot: v.any(),
    pdf_url: v.optional(v.string()),
    sent_at: v.optional(v.number()),
    report_type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("weekly_reports")
      .withIndex("by_user_week", (q) =>
        q.eq("user_id", args.user_id).eq("week_start_ms", args.week_start_ms),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        week_end_ms: args.week_end_ms,
        week_start_iso: args.week_start_iso,
        metrics_snapshot: args.metrics_snapshot,
        pdf_url: args.pdf_url ?? existing.pdf_url,
        sent_at: args.sent_at ?? existing.sent_at,
        report_type: args.report_type ?? existing.report_type,
      });
      return { action: "updated" as const, _id: existing._id };
    }

    const id = await ctx.db.insert("weekly_reports", {
      user_id: args.user_id,
      week_start_ms: args.week_start_ms,
      week_end_ms: args.week_end_ms,
      week_start_iso: args.week_start_iso,
      metrics_snapshot: args.metrics_snapshot,
      pdf_url: args.pdf_url,
      sent_at: args.sent_at,
      report_type: args.report_type ?? "standard",
      created_at: now,
    });
    return { action: "inserted" as const, _id: id };
  },
});

// markReportSent — set sent_at + pdf_url after delivery.
export const markReportSent = mutation({
  args: {
    id: v.id("weekly_reports"),
    pdf_url: v.optional(v.string()),
    sent_at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.id, {
      pdf_url: args.pdf_url,
      sent_at: args.sent_at ?? now,
    });
    return { ok: true as const };
  },
});

// ----------------------------------------------------------------------------
// getWeeklyReportsForUser — list report history.
// ----------------------------------------------------------------------------
export const getWeeklyReportsForUser = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("weekly_reports")
      .withIndex("by_user_week", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(args.limit ?? 12);
  },
});

// getWeeklyReportByWeek — single-row lookup by week_start_ms.
export const getWeeklyReportByWeek = query({
  args: {
    user_id: v.string(),
    week_start_ms: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("weekly_reports")
      .withIndex("by_user_week", (q) =>
        q.eq("user_id", args.user_id).eq("week_start_ms", args.week_start_ms),
      )
      .first();
  },
});

// getWeeklyReportByIsoDate — legacy lookup path that takes "YYYY-MM-DD".
export const getWeeklyReportByIsoDate = query({
  args: {
    user_id: v.string(),
    week_start_iso: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("weekly_reports")
      .withIndex("by_user_week_iso", (q) =>
        q.eq("user_id", args.user_id).eq("week_start_iso", args.week_start_iso),
      )
      .first();
  },
});

// ----------------------------------------------------------------------------
// BACKFILL — internal mutations for the migration script.
// ----------------------------------------------------------------------------
export const backfillWeeklyReport = internalMutation({
  args: {
    user_id: v.string(),
    week_start_ms: v.number(),
    week_end_ms: v.number(),
    week_start_iso: v.string(),
    metrics_snapshot: v.any(),
    pdf_url: v.optional(v.string()),
    sent_at: v.optional(v.number()),
    report_type: v.optional(v.string()),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("weekly_reports")
      .withIndex("by_user_week", (q) =>
        q.eq("user_id", args.user_id).eq("week_start_ms", args.week_start_ms),
      )
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("weekly_reports", args);
    return { action: "inserted" as const };
  },
});

export const backfillWeeklyReportFromScript = mutation({
  args: {
    deploy_key_check: v.string(),
    user_id: v.string(),
    week_start_ms: v.number(),
    week_end_ms: v.number(),
    week_start_iso: v.string(),
    metrics_snapshot: v.any(),
    pdf_url: v.optional(v.string()),
    sent_at: v.optional(v.number()),
    report_type: v.optional(v.string()),
    created_at: v.number(),
  },
  handler: async (ctx, { deploy_key_check, ...rest }) => {
    const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
    if (!expected) throw new Error("server_unconfigured");
    if (deploy_key_check !== expected) throw new Error("forbidden");
    const existing = await ctx.db
      .query("weekly_reports")
      .withIndex("by_user_week", (q) =>
        q.eq("user_id", rest.user_id).eq("week_start_ms", rest.week_start_ms),
      )
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("weekly_reports", rest);
    return { action: "inserted" as const };
  },
});
