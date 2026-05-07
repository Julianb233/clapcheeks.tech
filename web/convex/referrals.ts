import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Referral codes / credits (replaces clapcheeks_referrals).

export const getByCode = query({
  args: { referral_code: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("referrals")
      .withIndex("by_code", (q) => q.eq("referral_code", args.referral_code))
      .first();
  },
});

export const listForReferrer = query({
  args: { referrer_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrer_id", args.referrer_id))
      .collect();
  },
});

export const findPendingByReferred = query({
  args: { referred_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("referrals")
      .withIndex("by_referred", (q) => q.eq("referred_id", args.referred_id))
      .collect();
    return rows.find((r) => r.status === "pending") ?? null;
  },
});

export const insertReferral = mutation({
  args: {
    referrer_id: v.string(),
    referral_code: v.string(),
    referred_id: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("referrals", {
      referrer_id: args.referrer_id,
      referral_code: args.referral_code,
      referred_id: args.referred_id,
      status: args.status ?? "pending",
      created_at: Date.now(),
    });
    return { ok: true as const, id };
  },
});

export const markConverted = mutation({
  args: { referral_code: v.string(), referred_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("referrals")
      .withIndex("by_code", (q) => q.eq("referral_code", args.referral_code))
      .first();
    if (!row) return { ok: false as const, reason: "not_found" as const };
    await ctx.db.patch(row._id, {
      referred_id: args.referred_id,
      status: "converted",
      converted_at: Date.now(),
    });
    return { ok: true as const, id: row._id };
  },
});

export const markRewarded = mutation({
  args: { id: v.id("referrals") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "rewarded", rewarded_at: Date.now() });
    return { ok: true as const };
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    // Used by /admin/launch — total counts grouped by status.
    const all = await ctx.db.query("referrals").collect();
    return all.map((r) => ({ id: r._id, status: r.status, created_at: r.created_at }));
  },
});
