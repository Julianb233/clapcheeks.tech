import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// AI-9536 — Telemetry on Convex.
//
// Replaces 4 high-volume Supabase tables with index-tuned Convex equivalents:
//   - clapcheeks_analytics_daily   → analytics_daily
//   - clapcheeks_agent_events      → agent_events    (HOT PATH — Mac daemon emits
//                                                    on every swipe/match/error)
//   - clapcheeks_usage_daily       → usage_daily
//   - clapcheeks_friction_points   → friction_points
//   - clapcheeks_device_heartbeats → device_heartbeats
//
// Auth model:
//   - Public mutations called from web routes are gated by user_id only —
//     the calling Next.js route validates the auth cookie before passing
//     user_id through. We don't re-check inside Convex because the runner
//     and the web app share the same Supabase auth surface.
//   - The Mac Mini daemon hits the public mutations directly through
//     ConvexClient with CONVEX_DEPLOYMENT auth — same trust boundary as
//     the existing inbound.ts / messages.ts patterns.
//   - *Direct internal mutations are exposed for the backfill script
//     and bypass any indirection — caller is the trusted backfill env.

// ----------------------------------------------------------------------------
// recordDaily — upsert analytics_daily row for (user_id, app, day_iso).
// Hot path: dashboard + reports + agent rollup. Idempotent.
// ----------------------------------------------------------------------------
const APP = v.union(
  v.literal("tinder"),
  v.literal("bumble"),
  v.literal("hinge"),
);

export const recordDaily = mutation({
  args: {
    user_id: v.string(),
    day_iso: v.string(),
    app: APP,
    swipes_right: v.optional(v.number()),
    swipes_left: v.optional(v.number()),
    matches: v.optional(v.number()),
    conversations_started: v.optional(v.number()),
    dates_booked: v.optional(v.number()),
    money_spent: v.optional(v.number()),
    // mode: "set" replaces counts (default), "increment" adds to existing
    mode: v.optional(v.union(v.literal("set"), v.literal("increment"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("analytics_daily")
      .withIndex("by_user_app_day", (q) =>
        q
          .eq("user_id", args.user_id)
          .eq("app", args.app)
          .eq("day_iso", args.day_iso),
      )
      .first();

    const mode = args.mode ?? "set";

    if (existing) {
      const next = mode === "increment"
        ? {
            swipes_right: existing.swipes_right + (args.swipes_right ?? 0),
            swipes_left: existing.swipes_left + (args.swipes_left ?? 0),
            matches: existing.matches + (args.matches ?? 0),
            conversations_started:
              existing.conversations_started + (args.conversations_started ?? 0),
            dates_booked: existing.dates_booked + (args.dates_booked ?? 0),
            money_spent: existing.money_spent + (args.money_spent ?? 0),
          }
        : {
            swipes_right: args.swipes_right ?? existing.swipes_right,
            swipes_left: args.swipes_left ?? existing.swipes_left,
            matches: args.matches ?? existing.matches,
            conversations_started:
              args.conversations_started ?? existing.conversations_started,
            dates_booked: args.dates_booked ?? existing.dates_booked,
            money_spent: args.money_spent ?? existing.money_spent,
          };
      await ctx.db.patch(existing._id, { ...next, updated_at: now });
      return { action: "updated" as const, _id: existing._id };
    }

    const id = await ctx.db.insert("analytics_daily", {
      user_id: args.user_id,
      day_iso: args.day_iso,
      app: args.app,
      swipes_right: args.swipes_right ?? 0,
      swipes_left: args.swipes_left ?? 0,
      matches: args.matches ?? 0,
      conversations_started: args.conversations_started ?? 0,
      dates_booked: args.dates_booked ?? 0,
      money_spent: args.money_spent ?? 0,
      created_at: now,
      updated_at: now,
    });
    return { action: "inserted" as const, _id: id };
  },
});

// ----------------------------------------------------------------------------
// recordEvent — append-only insert into agent_events. HOT PATH.
// Mac daemon calls this on every swipe/match/error. Server-assigns ts so
// ordering is deterministic regardless of clock drift on the daemon side.
// ----------------------------------------------------------------------------
export const recordEvent = mutation({
  args: {
    user_id: v.string(),
    event_type: v.string(),
    platform: v.optional(v.string()),
    data: v.optional(v.any()),
    occurred_at: v.optional(v.number()),  // when it happened on daemon
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("agent_events", {
      user_id: args.user_id,
      event_type: args.event_type,
      platform: args.platform,
      data: args.data,
      occurred_at: args.occurred_at ?? now,
      ts: now,
    });
    return { _id: id, ts: now };
  },
});

// ----------------------------------------------------------------------------
// recordHeartbeat — upsert by agent_device_tokens id. One row per token.
// Returns server time so the daemon can sync clocks.
// ----------------------------------------------------------------------------
export const recordHeartbeat = mutation({
  args: {
    token: v.string(),                 // device-token string (auth)
    device_id: v.optional(v.string()),
    daemon_version: v.optional(v.string()),
    last_sync_at: v.optional(v.number()),
    errors_jsonb: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Validate device token
    const device = await ctx.db
      .query("agent_device_tokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!device || device.revoked) {
      throw new Error("invalid_device_token");
    }

    const now = Date.now();

    // Bump device-token last_seen_at
    await ctx.db.patch(device._id, { last_seen_at: now });

    // Find existing heartbeat row by device_token_id
    const existing = await ctx.db
      .query("device_heartbeats")
      .withIndex("by_device", (q) => q.eq("device_token_id", device._id))
      .first();

    const payload = {
      device_token_id: device._id,
      user_id: device.user_id,
      device_id: args.device_id ?? device.device_name,
      daemon_version: args.daemon_version,
      last_sync_at: args.last_sync_at,
      errors_jsonb: args.errors_jsonb,
      last_heartbeat_at: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return {
        ok: true as const,
        action: "updated" as const,
        server_time_ms: now,
        user_id: device.user_id,
      };
    }
    await ctx.db.insert("device_heartbeats", {
      ...payload,
      created_at: now,
    });
    return {
      ok: true as const,
      action: "inserted" as const,
      server_time_ms: now,
      user_id: device.user_id,
    };
  },
});

// ----------------------------------------------------------------------------
// recordFriction — insert friction_points row. Lower volume than events;
// triggered by dashboard or local agent friction_tracker.py.
// ----------------------------------------------------------------------------
const SEVERITY = v.union(
  v.literal("blocker"),
  v.literal("major"),
  v.literal("minor"),
  v.literal("cosmetic"),
);
const CATEGORY = v.union(
  v.literal("swiping"),
  v.literal("conversation"),
  v.literal("agent_setup"),
  v.literal("auth"),
  v.literal("stripe"),
  v.literal("dashboard"),
  v.literal("reports"),
  v.literal("performance"),
  v.literal("crash"),
  v.literal("ux"),
  v.literal("other"),
);

export const recordFriction = mutation({
  args: {
    user_id: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    severity: v.optional(SEVERITY),
    category: v.optional(CATEGORY),
    platform: v.optional(v.string()),
    auto_detected: v.optional(v.boolean()),
    context: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("friction_points", {
      user_id: args.user_id,
      title: args.title,
      description: args.description,
      severity: args.severity ?? "minor",
      category: args.category ?? "ux",
      platform: args.platform,
      auto_detected: args.auto_detected ?? false,
      context: args.context,
      resolved: false,
      resolved_at: undefined,
      resolution: undefined,
      created_at: now,
    });
    return { _id: id };
  },
});

// ----------------------------------------------------------------------------
// resolveFriction — flip resolved=true with optional resolution text.
// ----------------------------------------------------------------------------
export const resolveFriction = mutation({
  args: {
    id: v.id("friction_points"),
    resolution: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.id, {
      resolved: true,
      resolved_at: now,
      resolution: args.resolution,
    });
    return { ok: true as const };
  },
});

// ----------------------------------------------------------------------------
// incrementUsage — atomic counter bump on usage_daily, replacing the
// Postgres `increment_usage` RPC. Creates the row on first hit of the day.
// ----------------------------------------------------------------------------
const USAGE_FIELD = v.union(
  v.literal("swipes_used"),
  v.literal("coaching_calls_used"),
  v.literal("ai_replies_used"),
);

export const incrementUsage = mutation({
  args: {
    user_id: v.string(),
    day_iso: v.string(),
    field: USAGE_FIELD,
    amount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const amt = args.amount ?? 1;

    const existing = await ctx.db
      .query("usage_daily")
      .withIndex("by_user_day", (q) =>
        q.eq("user_id", args.user_id).eq("day_iso", args.day_iso),
      )
      .first();

    if (existing) {
      const next = { ...existing, updated_at: now };
      next[args.field] = (existing[args.field] ?? 0) + amt;
      // Strip system fields before patch
      const { _id, _creationTime, ...rest } = next;
      void _id; void _creationTime;
      await ctx.db.patch(existing._id, rest);
      return { ok: true as const, new_value: next[args.field] };
    }

    const seed = {
      user_id: args.user_id,
      day_iso: args.day_iso,
      swipes_used: 0,
      coaching_calls_used: 0,
      ai_replies_used: 0,
      created_at: now,
      updated_at: now,
    };
    seed[args.field] = amt;
    const id = await ctx.db.insert("usage_daily", seed);
    return { ok: true as const, _id: id, new_value: amt };
  },
});

// ============================================================================
// QUERIES
// ============================================================================

// getDailyForUser — read range of analytics_daily rows for one user.
export const getDailyForUser = query({
  args: {
    user_id: v.string(),
    since_day_iso: v.string(),         // inclusive
    until_day_iso: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("analytics_daily")
      .withIndex("by_user_day", (q) =>
        q.eq("user_id", args.user_id).gte("day_iso", args.since_day_iso),
      )
      .collect();
    if (!args.until_day_iso) return rows;
    const upper = args.until_day_iso;
    return rows.filter((r) => r.day_iso <= upper);
  },
});

// listEventsForUser — newest-first feed for admin events page + dashboard.
export const listEventsForUser = query({
  args: {
    user_id: v.string(),
    event_type: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    if (args.event_type) {
      return await ctx.db
        .query("agent_events")
        .withIndex("by_user_type_ts", (q) =>
          q.eq("user_id", args.user_id).eq("event_type", args.event_type!),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("agent_events")
      .withIndex("by_user_ts", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(limit);
  },
});

// listEventsCrossUser — admin events page (all users).
export const listEventsCrossUser = query({
  args: {
    event_type: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    if (args.event_type) {
      return await ctx.db
        .query("agent_events")
        .withIndex("by_type_ts", (q) => q.eq("event_type", args.event_type!))
        .order("desc")
        .take(limit);
    }
    // No global "by_ts" index — full scan ordered by creation time descending.
    // Acceptable on admin path only; capped by limit.
    return await ctx.db
      .query("agent_events")
      .order("desc")
      .take(limit);
  },
});

// getLatestHeartbeat — most-recent heartbeat for one user.
export const getLatestHeartbeat = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("device_heartbeats")
      .withIndex("by_user_heartbeat", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .first();
    return row;
  },
});

// listFrictionForUser — friction queue for the dogfood dashboard.
export const listFrictionForUser = query({
  args: {
    user_id: v.string(),
    only_unresolved: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    if (args.only_unresolved) {
      return await ctx.db
        .query("friction_points")
        .withIndex("by_user_resolved", (q) =>
          q.eq("user_id", args.user_id).eq("resolved", false),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("friction_points")
      .withIndex("by_user_created", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(limit);
  },
});

// getUsageForDay — single-row read for checkLimit / getUsageSummary.
export const getUsageForDay = query({
  args: {
    user_id: v.string(),
    day_iso: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("usage_daily")
      .withIndex("by_user_day", (q) =>
        q.eq("user_id", args.user_id).eq("day_iso", args.day_iso),
      )
      .first();
    return row;
  },
});

// ============================================================================
// BACKFILL — internal mutations, called from the one-shot Python script
// running on Mac Mini with the trusted master key.
// ============================================================================

export const backfillAnalyticsDaily = internalMutation({
  args: {
    user_id: v.string(),
    day_iso: v.string(),
    app: APP,
    swipes_right: v.number(),
    swipes_left: v.number(),
    matches: v.number(),
    conversations_started: v.number(),
    dates_booked: v.number(),
    money_spent: v.number(),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("analytics_daily")
      .withIndex("by_user_app_day", (q) =>
        q
          .eq("user_id", args.user_id)
          .eq("app", args.app)
          .eq("day_iso", args.day_iso),
      )
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("analytics_daily", {
      ...args,
      updated_at: args.created_at,
    });
    return { action: "inserted" as const };
  },
});

export const backfillAgentEvent = internalMutation({
  args: {
    user_id: v.string(),
    event_type: v.string(),
    platform: v.optional(v.string()),
    data: v.optional(v.any()),
    occurred_at: v.optional(v.number()),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    // Idempotent on (user_id, ts, event_type) — same dedup key the
    // Python script uses.
    const candidates = await ctx.db
      .query("agent_events")
      .withIndex("by_user_type_ts", (q) =>
        q.eq("user_id", args.user_id).eq("event_type", args.event_type),
      )
      .collect();
    if (candidates.some((r) => r.ts === args.ts)) {
      return { action: "skipped" as const };
    }
    await ctx.db.insert("agent_events", args);
    return { action: "inserted" as const };
  },
});

export const backfillUsageDaily = internalMutation({
  args: {
    user_id: v.string(),
    day_iso: v.string(),
    swipes_used: v.number(),
    coaching_calls_used: v.number(),
    ai_replies_used: v.number(),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("usage_daily")
      .withIndex("by_user_day", (q) =>
        q.eq("user_id", args.user_id).eq("day_iso", args.day_iso),
      )
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("usage_daily", {
      ...args,
      updated_at: args.created_at,
    });
    return { action: "inserted" as const };
  },
});

export const backfillFrictionPoint = internalMutation({
  args: {
    user_id: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    severity: SEVERITY,
    category: CATEGORY,
    platform: v.optional(v.string()),
    auto_detected: v.boolean(),
    context: v.optional(v.any()),
    resolved: v.boolean(),
    resolution: v.optional(v.string()),
    resolved_at: v.optional(v.number()),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("friction_points", args);
    return { action: "inserted" as const };
  },
});

export const backfillDeviceHeartbeat = internalMutation({
  args: {
    device_token_id: v.id("agent_device_tokens"),
    user_id: v.string(),
    device_id: v.optional(v.string()),
    daemon_version: v.optional(v.string()),
    last_sync_at: v.optional(v.number()),
    errors_jsonb: v.optional(v.any()),
    last_heartbeat_at: v.number(),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("device_heartbeats")
      .withIndex("by_device", (q) => q.eq("device_token_id", args.device_token_id))
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("device_heartbeats", args);
    return { action: "inserted" as const };
  },
});

// ============================================================================
// PUBLIC BACKFILL — gated by deploy_key_check, used when the Mac script
// can't easily invoke an internal mutation directly.
// ============================================================================

function checkRunnerSecret(provided: string) {
  const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
  if (!expected) {
    throw new Error("server_unconfigured: CONVEX_RUNNER_SHARED_SECRET unset");
  }
  if (provided !== expected) {
    throw new Error("forbidden: bad deploy_key_check");
  }
}

export const backfillAnalyticsDailyFromScript = mutation({
  args: {
    deploy_key_check: v.string(),
    user_id: v.string(),
    day_iso: v.string(),
    app: APP,
    swipes_right: v.number(),
    swipes_left: v.number(),
    matches: v.number(),
    conversations_started: v.number(),
    dates_booked: v.number(),
    money_spent: v.number(),
    created_at: v.number(),
  },
  handler: async (ctx, { deploy_key_check, ...rest }) => {
    checkRunnerSecret(deploy_key_check);
    const existing = await ctx.db
      .query("analytics_daily")
      .withIndex("by_user_app_day", (q) =>
        q
          .eq("user_id", rest.user_id)
          .eq("app", rest.app)
          .eq("day_iso", rest.day_iso),
      )
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("analytics_daily", {
      ...rest,
      updated_at: rest.created_at,
    });
    return { action: "inserted" as const };
  },
});

export const backfillAgentEventsBatchFromScript = mutation({
  args: {
    deploy_key_check: v.string(),
    rows: v.array(
      v.object({
        user_id: v.string(),
        event_type: v.string(),
        platform: v.optional(v.string()),
        data: v.optional(v.any()),
        occurred_at: v.optional(v.number()),
        ts: v.number(),
      }),
    ),
  },
  handler: async (ctx, { deploy_key_check, rows }) => {
    checkRunnerSecret(deploy_key_check);
    let inserted = 0;
    let skipped = 0;
    for (const r of rows) {
      const candidates = await ctx.db
        .query("agent_events")
        .withIndex("by_user_type_ts", (q) =>
          q.eq("user_id", r.user_id).eq("event_type", r.event_type),
        )
        .collect();
      if (candidates.some((c) => c.ts === r.ts)) {
        skipped++;
        continue;
      }
      await ctx.db.insert("agent_events", r);
      inserted++;
    }
    return { inserted, skipped, total: rows.length };
  },
});

export const backfillUsageDailyFromScript = mutation({
  args: {
    deploy_key_check: v.string(),
    user_id: v.string(),
    day_iso: v.string(),
    swipes_used: v.number(),
    coaching_calls_used: v.number(),
    ai_replies_used: v.number(),
    created_at: v.number(),
  },
  handler: async (ctx, { deploy_key_check, ...rest }) => {
    checkRunnerSecret(deploy_key_check);
    const existing = await ctx.db
      .query("usage_daily")
      .withIndex("by_user_day", (q) =>
        q.eq("user_id", rest.user_id).eq("day_iso", rest.day_iso),
      )
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("usage_daily", {
      ...rest,
      updated_at: rest.created_at,
    });
    return { action: "inserted" as const };
  },
});

export const backfillFrictionPointFromScript = mutation({
  args: {
    deploy_key_check: v.string(),
    user_id: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    severity: SEVERITY,
    category: CATEGORY,
    platform: v.optional(v.string()),
    auto_detected: v.boolean(),
    context: v.optional(v.any()),
    resolved: v.boolean(),
    resolution: v.optional(v.string()),
    resolved_at: v.optional(v.number()),
    created_at: v.number(),
  },
  handler: async (ctx, { deploy_key_check, ...rest }) => {
    checkRunnerSecret(deploy_key_check);
    await ctx.db.insert("friction_points", rest);
    return { action: "inserted" as const };
  },
});

// Used by backfill to look up the agent_device_tokens row by its old
// Supabase token-string equivalent so the Convex device_heartbeats row
// has a stable FK target. Returns null if the token isn't yet imported.
export const findDeviceTokenIdForBackfill = query({
  args: {
    deploy_key_check: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    checkRunnerSecret(args.deploy_key_check);
    const row = await ctx.db
      .query("agent_device_tokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    return row ? row._id : null;
  },
});

export const backfillDeviceHeartbeatFromScript = mutation({
  args: {
    deploy_key_check: v.string(),
    device_token_id: v.id("agent_device_tokens"),
    user_id: v.string(),
    device_id: v.optional(v.string()),
    daemon_version: v.optional(v.string()),
    last_sync_at: v.optional(v.number()),
    errors_jsonb: v.optional(v.any()),
    last_heartbeat_at: v.number(),
    created_at: v.number(),
  },
  handler: async (ctx, { deploy_key_check, ...rest }) => {
    checkRunnerSecret(deploy_key_check);
    const existing = await ctx.db
      .query("device_heartbeats")
      .withIndex("by_device", (q) => q.eq("device_token_id", rest.device_token_id))
      .first();
    if (existing) return { action: "skipped" as const };
    await ctx.db.insert("device_heartbeats", rest);
    return { action: "inserted" as const };
  },
});
