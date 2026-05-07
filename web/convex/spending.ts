import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// AI-9575 — spending on Convex.
// Replaces Supabase clapcheeks_spending.
// Old Supabase table stays live as backstop until backfill is run.

export const add = mutation({
  args: {
    user_id: v.string(),
    date: v.string(),
    platform: v.optional(v.string()),
    category: v.string(),
    amount: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("spending", { ...args, created_at: now });
    return { _id: id };
  },
});

export const listForUser = query({
  args: {
    user_id: v.string(),
    since_date: v.optional(v.string()),
    until_date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("spending")
      .withIndex("by_user_date", (q) => {
        const base = q.eq("user_id", args.user_id);
        return args.since_date ? base.gte("date", args.since_date) : base;
      })
      .collect();
    if (args.until_date) {
      const upper = args.until_date;
      rows = rows.filter((r) => r.date <= upper);
    }
    return rows;
  },
});

export const summaryByCategory = query({
  args: {
    user_id: v.string(),
    since_date: v.optional(v.string()),
    until_date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("spending")
      .withIndex("by_user_date", (q) => {
        const base = q.eq("user_id", args.user_id);
        return args.since_date ? base.gte("date", args.since_date) : base;
      })
      .collect();
    if (args.until_date) {
      const upper = args.until_date;
      rows = rows.filter((r) => r.date <= upper);
    }
    const totals: Record<string, number> = {};
    for (const row of rows) {
      totals[row.category] = (totals[row.category] ?? 0) + row.amount;
    }
    return totals;
  },
});

function checkRunnerSecret(provided: string) {
  const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
  if (!expected) throw new Error("server_unconfigured: CONVEX_RUNNER_SHARED_SECRET unset");
  if (provided !== expected) throw new Error("forbidden: bad deploy_key_check");
}

export const backfillSpendingFromScript = mutation({
  args: {
    deploy_key_check: v.string(),
    rows: v.array(
      v.object({
        user_id: v.string(),
        date: v.string(),
        platform: v.optional(v.string()),
        category: v.string(),
        amount: v.number(),
        description: v.optional(v.string()),
        created_at: v.number(),
      }),
    ),
  },
  handler: async (ctx, { deploy_key_check, rows }) => {
    checkRunnerSecret(deploy_key_check);
    for (const row of rows) {
      await ctx.db.insert("spending", row);
    }
    return { inserted: rows.length };
  },
});

export const backfillSpending = internalMutation({
  args: {
    user_id: v.string(),
    date: v.string(),
    platform: v.optional(v.string()),
    category: v.string(),
    amount: v.number(),
    description: v.optional(v.string()),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("spending", args);
    return { action: "inserted" as const };
  },
});
