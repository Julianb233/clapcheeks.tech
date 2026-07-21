// AI-8329 Phase 44: Autonomy Engine — Convex wrappers.
//
// Thin persistence + orchestration layer over the pure logic in
// web/lib/autonomy/*. All decision logic lives in that unit-tested library
// (see __tests__/autonomy-*.test.ts); this file only reads/writes Convex tables
// and hands rows to the pure functions.
//
// Tables:
//   swipe_decisions   — every swipe (manual trains the model, auto is audited)
//   swipe_preferences — the trained model, one row per user
//   autonomy_config   — per-user level (shared with touches.ts)
//   approval_queue    — parked actions awaiting human approval (shared)

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_STALE_CONFIG,
  DEFAULT_SWIPE_THRESHOLDS,
  decideSwipe,
  emptyModel,
  findStaleConversations,
  predict,
  routeAction,
  summarizeConfidence,
  trainAndScore,
} from "../lib/autonomy";
import type {
  AutonomyLevel,
  PreferenceModel,
  SwipeDecision,
} from "../lib/autonomy";

// ---------------------------------------------------------------------------
// Model row <-> PreferenceModel adapters
// ---------------------------------------------------------------------------

interface StoredModel {
  weights: Record<string, number>;
  bias: number;
  feature_keys: string[];
  feature_means: Record<string, number>;
  n_samples: number;
  accuracy: number;
  model_version: number;
}

function toPreferenceModel(row: StoredModel | null): PreferenceModel {
  if (!row) return emptyModel();
  return {
    weights: row.weights ?? {},
    bias: row.bias ?? 0,
    featureKeys: row.feature_keys ?? [],
    featureMeans: row.feature_means ?? {},
    nSamples: row.n_samples ?? 0,
    accuracy: row.accuracy ?? -1,
    version: row.model_version ?? 1,
  };
}

// ---------------------------------------------------------------------------
// AUTO-01 / AUTO-02 — record swipes
// ---------------------------------------------------------------------------

export const recordSwipeDecision = mutation({
  args: {
    user_id: v.string(),
    direction: v.union(v.literal("like"), v.literal("pass")),
    features: v.any(),
    source: v.union(v.literal("manual"), v.literal("auto")),
    platform: v.optional(v.string()),
    external_candidate_id: v.optional(v.string()),
    candidate_name: v.optional(v.string()),
    predicted_probability: v.optional(v.number()),
    confidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("swipe_decisions", {
      user_id: args.user_id,
      platform: args.platform,
      external_candidate_id: args.external_candidate_id,
      candidate_name: args.candidate_name,
      direction: args.direction,
      features: args.features ?? {},
      source: args.source,
      predicted_probability: args.predicted_probability,
      confidence: args.confidence,
      created_at: Date.now(),
    });
    return { _id: id };
  },
});

// ---------------------------------------------------------------------------
// AUTO-01 — train + store the preference model
// ---------------------------------------------------------------------------

async function loadManualDecisions(
  ctx: { db: any },
  user_id: string,
): Promise<SwipeDecision[]> {
  const rows = await ctx.db
    .query("swipe_decisions")
    .withIndex("by_user", (q: any) => q.eq("user_id", user_id))
    .collect();
  return rows
    .filter((r: any) => r.source !== "auto")
    .map((r: any) => ({
      direction: r.direction,
      features: (r.features ?? {}) as Record<string, number>,
      at: r.created_at,
      source: r.source,
    }));
}

async function persistModel(
  ctx: { db: any },
  user_id: string,
  model: PreferenceModel,
) {
  const now = Date.now();
  const doc = {
    user_id,
    weights: model.weights,
    bias: model.bias,
    feature_keys: model.featureKeys,
    feature_means: model.featureMeans,
    n_samples: model.nSamples,
    accuracy: model.accuracy,
    model_version: model.version,
    trained_at: now,
  };
  const existing = await ctx.db
    .query("swipe_preferences")
    .withIndex("by_user", (q: any) => q.eq("user_id", user_id))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, doc);
    return existing._id;
  }
  return await ctx.db.insert("swipe_preferences", doc);
}

export const trainPreferenceModel = mutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const decisions = await loadManualDecisions(ctx, args.user_id);
    const model = trainAndScore(decisions);
    await persistModel(ctx, args.user_id, model);
    return {
      accuracy: model.accuracy,
      n_samples: model.nSamples,
      meets_threshold: model.accuracy >= 0.7,
      feature_keys: model.featureKeys,
    };
  },
});

// Internal variant so a cron/other module can retrain without exposing a
// public mutation to the client.
export const _retrainPreferenceModel = internalMutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const decisions = await loadManualDecisions(ctx, args.user_id);
    const model = trainAndScore(decisions);
    await persistModel(ctx, args.user_id, model);
    return { accuracy: model.accuracy, n_samples: model.nSamples };
  },
});

// ---------------------------------------------------------------------------
// Reads: model, prediction, dashboard
// ---------------------------------------------------------------------------

export const getPreferenceModel = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("swipe_preferences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    return row;
  },
});

export const predictSwipe = query({
  args: { user_id: v.string(), features: v.any() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("swipe_preferences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    const model = toPreferenceModel(row as StoredModel | null);
    return predict(model, (args.features ?? {}) as Record<string, number>);
  },
});

// ---------------------------------------------------------------------------
// AUTO-02 — auto-swipe decision, rate-limit aware
// ---------------------------------------------------------------------------

export const autoSwipeDecision = query({
  args: {
    user_id: v.string(),
    features: v.any(),
    max_per_window: v.optional(v.number()),
    window_ms: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const modelRow = await ctx.db
      .query("swipe_preferences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    const model = toPreferenceModel(modelRow as StoredModel | null);
    const prediction = predict(
      model,
      (args.features ?? {}) as Record<string, number>,
    );

    const rateLimit = {
      maxPerWindow: args.max_per_window ?? DEFAULT_RATE_LIMIT.maxPerWindow,
      windowMs: args.window_ms ?? DEFAULT_RATE_LIMIT.windowMs,
    };
    const now = Date.now();
    const cutoff = now - rateLimit.windowMs;
    const recentAuto = await ctx.db
      .query("swipe_decisions")
      .withIndex("by_user_source_created", (q) =>
        q.eq("user_id", args.user_id).eq("source", "auto").gt("created_at", cutoff),
      )
      .collect();

    return decideSwipe({
      prediction,
      now,
      rateState: { recentSwipeTimestamps: recentAuto.map((r) => r.created_at) },
      thresholds: DEFAULT_SWIPE_THRESHOLDS,
      rateLimit,
    });
  },
});

// ---------------------------------------------------------------------------
// AUTO-05 — approval-gate router (global + per-match override)
// ---------------------------------------------------------------------------

export const routeProposedAction = query({
  args: {
    user_id: v.string(),
    confidence: v.number(),
    match_override: v.optional(
      v.union(
        v.literal("always_approve"),
        v.literal("always_send"),
        v.literal("inherit"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const cfg = await ctx.db
      .query("autonomy_config")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    const level = (cfg?.global_level ?? "auto_send") as AutonomyLevel;
    return routeAction({
      level,
      confidence: args.confidence,
      matchOverride: args.match_override,
    });
  },
});

// ---------------------------------------------------------------------------
// AUTO-04 — stale conversation recovery
// ---------------------------------------------------------------------------

export const staleRecovery = query({
  args: {
    user_id: v.string(),
    stale_after_ms: v.optional(v.number()),
    dead_after_ms: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const convos = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const config = {
      staleAfterMs: args.stale_after_ms ?? DEFAULT_STALE_CONFIG.staleAfterMs,
      deadAfterMs: args.dead_after_ms ?? DEFAULT_STALE_CONFIG.deadAfterMs,
    };
    return findStaleConversations(
      convos.map((c) => ({
        id: String(c._id),
        status: c.status,
        match_name: c.match_name,
        platform: c.platform,
        last_inbound_at: c.last_inbound_at,
        last_outbound_at: c.last_outbound_at,
        last_message_at: c.last_message_at,
      })),
      Date.now(),
      config,
    );
  },
});

// ---------------------------------------------------------------------------
// AUTO-06 — confidence dashboard
// ---------------------------------------------------------------------------

export const confidenceDashboard = query({
  args: { user_id: v.string(), auto_send_floor: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const modelRow = await ctx.db
      .query("swipe_preferences")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    const model = toPreferenceModel(modelRow as StoredModel | null);

    const approvalRows = await ctx.db
      .query("approval_queue")
      .withIndex("by_user_status", (q) => q.eq("user_id", args.user_id))
      .collect();

    return summarizeConfidence({
      model,
      approvals: approvalRows.map((r) => ({
        status: r.status,
        confidence: r.confidence ?? 0,
      })),
      autoSendFloor: args.auto_send_floor,
    });
  },
});

// Internal read used by tests / other modules that need the raw manual set.
export const _manualDecisions = internalQuery({
  args: { user_id: v.string() },
  handler: async (ctx, args) => loadManualDecisions(ctx, args.user_id),
});
