import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Voice profile + voice context (replaces clapcheeks_voice_profiles
// and user_voice_context).

// ---------------------------------------------------------------------------
// voice_profiles
// ---------------------------------------------------------------------------
export const getProfile = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("voice_profiles")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
  },
});

export const upsertProfile = mutation({
  args: {
    user_id: v.string(),
    style_summary: v.optional(v.string()),
    sample_phrases: v.optional(v.array(v.any())),
    tone: v.optional(v.string()),
    profile_data: v.optional(v.any()),
    messages_analyzed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("voice_profiles")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    const patch = {
      style_summary: args.style_summary,
      sample_phrases: args.sample_phrases,
      tone: args.tone,
      profile_data: args.profile_data,
      messages_analyzed: args.messages_analyzed,
      updated_at: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("voice_profiles", {
      user_id: args.user_id,
      ...patch,
      created_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});

export const upsertProfileDigest = mutation({
  args: {
    user_id: v.string(),
    digest: v.optional(v.any()),
    boosted_samples: v.optional(v.any()),
    last_scan_at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("voice_profiles")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (existing) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (args.digest !== undefined) patch.digest = args.digest;
      if (args.boosted_samples !== undefined) patch.boosted_samples = args.boosted_samples;
      if (args.last_scan_at !== undefined) patch.last_scan_at = args.last_scan_at;
      await ctx.db.patch(existing._id, patch);
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("voice_profiles", {
      user_id: args.user_id,
      digest: args.digest,
      boosted_samples: args.boosted_samples,
      last_scan_at: args.last_scan_at,
      created_at: now,
      updated_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});

// ---------------------------------------------------------------------------
// voice_context
// ---------------------------------------------------------------------------
export const getContext = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("voice_context")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
  },
});

export const upsertContext = mutation({
  args: {
    user_id: v.string(),
    answers: v.optional(v.any()),
    summary: v.optional(v.string()),
    persona_blob: v.optional(v.string()),
    completed_at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("voice_context")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (existing) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (args.answers !== undefined) patch.answers = args.answers;
      if (args.summary !== undefined) patch.summary = args.summary;
      if (args.persona_blob !== undefined) patch.persona_blob = args.persona_blob;
      if (args.completed_at !== undefined) patch.completed_at = args.completed_at;
      await ctx.db.patch(existing._id, patch);
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("voice_context", {
      user_id: args.user_id,
      answers: args.answers,
      summary: args.summary,
      persona_blob: args.persona_blob,
      completed_at: args.completed_at,
      created_at: now,
      updated_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});
