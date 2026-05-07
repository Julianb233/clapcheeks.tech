/**
 * calls.ts — Convex backend for call tracking.
 *
 * AI-9500 W2 E13 — surfaces call timestamps in the unified person
 * dossier Timeline tab and on /coach as a 30-day stat.
 *
 * Schema table `calls` was deployed in AI-9500-F.  This file adds:
 *   upsertCall     — mutation: webhook ingest + manual entry (idempotent)
 *   listForPerson  — query: all calls for a specific person
 *   listForUser    — query: all calls for a user (newest first)
 *   recentForCoach — query: last-30d call count + per-day breakdown for /coach
 */

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// upsertCall
//
// Idempotent ingest from the Mac Mini daemon or manual entry.  Dedup key:
//   (user_id, handle_value, started_at_ms, platform) — two calls within the
//   same second on the same handle are treated as the same event.
//
// If no matching row exists, inserts a new one.
// If a row exists but duration_seconds was missing and we now have it, patches.
// ---------------------------------------------------------------------------
export const upsertCall = mutation({
  args: {
    user_id: v.string(),
    person_id: v.optional(v.id("people")),
    direction: v.union(
      v.literal("inbound"),
      v.literal("outbound"),
      v.literal("missed"),
    ),
    started_at_ms: v.number(),
    duration_seconds: v.optional(v.number()),
    handle_value: v.optional(v.string()),
    platform: v.optional(
      v.union(
        v.literal("imessage_native"),
        v.literal("facetime"),
        v.literal("twilio"),
        v.literal("phone_native"),
      ),
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Dedup: look for an existing record within 5 seconds on the same handle+platform
    const windowStart = args.started_at_ms - 5_000;
    const windowEnd = args.started_at_ms + 5_000;

    const existing = await ctx.db
      .query("calls")
      .withIndex("by_user_started", (q) =>
        q
          .eq("user_id", args.user_id)
          .gt("started_at_ms", windowStart)
      )
      .filter((q) =>
        q.and(
          q.lt(q.field("started_at_ms"), windowEnd),
          args.handle_value
            ? q.eq(q.field("handle_value"), args.handle_value)
            : q.eq(q.field("handle_value"), undefined),
          args.platform
            ? q.eq(q.field("platform"), args.platform)
            : q.eq(q.field("platform"), undefined),
        ),
      )
      .first();

    if (existing) {
      // Patch duration if we now have it and didn't before
      if (
        args.duration_seconds !== undefined &&
        existing.duration_seconds === undefined
      ) {
        await ctx.db.patch(existing._id, {
          duration_seconds: args.duration_seconds,
          notes: args.notes ?? existing.notes,
          person_id: args.person_id ?? existing.person_id,
        });
      }
      return existing._id;
    }

    return await ctx.db.insert("calls", {
      user_id: args.user_id,
      person_id: args.person_id,
      direction: args.direction,
      started_at_ms: args.started_at_ms,
      duration_seconds: args.duration_seconds,
      handle_value: args.handle_value,
      platform: args.platform,
      notes: args.notes,
      created_at: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// listForPerson
//
// All calls linked to a specific person, newest first, capped at `limit`.
// Used by the dossier Timeline tab.
// ---------------------------------------------------------------------------
export const listForPerson = query({
  args: {
    person_id: v.id("people"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { person_id, limit = 50 }) => {
    return await ctx.db
      .query("calls")
      .withIndex("by_person", (q) => q.eq("person_id", person_id))
      .order("desc")
      .take(limit);
  },
});

// ---------------------------------------------------------------------------
// listForUser
//
// All calls for a user, newest first, capped at `limit`.
// Useful for a global activity log.
// ---------------------------------------------------------------------------
export const listForUser = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { user_id, limit = 100 }) => {
    return await ctx.db
      .query("calls")
      .withIndex("by_user", (q) => q.eq("user_id", user_id))
      .order("desc")
      .take(limit);
  },
});

// ---------------------------------------------------------------------------
// recentForCoach
//
// Aggregates calls for /coach: last-30d total count + per-day breakdown.
//
// Returns:
//   total_30d          — total call count last 30 days
//   by_day             — array of { date_iso: string; count: number }
//                        ordered ascending, only days with calls included
//   by_direction       — { inbound, outbound, missed } totals
//   avg_duration_seconds — mean duration of non-missed calls, or null
// ---------------------------------------------------------------------------
export const recentForCoach = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const recent = await ctx.db
      .query("calls")
      .withIndex("by_user_started", (q) =>
        q.eq("user_id", user_id).gt("started_at_ms", cutoff),
      )
      .order("asc")
      .collect();

    // Aggregate by day (ISO date string, UTC)
    const dayMap = new Map<string, number>();
    let inbound = 0;
    let outbound = 0;
    let missed = 0;
    let durationSum = 0;
    let durationCount = 0;

    for (const call of recent) {
      const d = new Date(call.started_at_ms);
      const iso = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
      dayMap.set(iso, (dayMap.get(iso) ?? 0) + 1);

      if (call.direction === "inbound") inbound++;
      else if (call.direction === "outbound") outbound++;
      else missed++;

      if (call.duration_seconds !== undefined) {
        durationSum += call.duration_seconds;
        durationCount++;
      }
    }

    const by_day = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date_iso, count]) => ({ date_iso, count }));

    return {
      total_30d: recent.length,
      by_day,
      by_direction: { inbound, outbound, missed },
      avg_duration_seconds:
        durationCount > 0
          ? Math.round(durationSum / durationCount)
          : null,
    };
  },
});

// ---------------------------------------------------------------------------
// internalUpsertCall
//
// Internal variant for server-side use (e.g., http.ts webhook handler).
// Same logic as upsertCall but callable without a client auth token.
// ---------------------------------------------------------------------------
export const internalUpsertCall = internalMutation({
  args: {
    user_id: v.string(),
    person_id: v.optional(v.id("people")),
    direction: v.union(
      v.literal("inbound"),
      v.literal("outbound"),
      v.literal("missed"),
    ),
    started_at_ms: v.number(),
    duration_seconds: v.optional(v.number()),
    handle_value: v.optional(v.string()),
    platform: v.optional(
      v.union(
        v.literal("imessage_native"),
        v.literal("facetime"),
        v.literal("twilio"),
        v.literal("phone_native"),
      ),
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const windowStart = args.started_at_ms - 5_000;
    const windowEnd = args.started_at_ms + 5_000;

    const existing = await ctx.db
      .query("calls")
      .withIndex("by_user_started", (q) =>
        q
          .eq("user_id", args.user_id)
          .gt("started_at_ms", windowStart),
      )
      .filter((q) =>
        q.and(
          q.lt(q.field("started_at_ms"), windowEnd),
          args.handle_value
            ? q.eq(q.field("handle_value"), args.handle_value)
            : q.eq(q.field("handle_value"), undefined),
          args.platform
            ? q.eq(q.field("platform"), args.platform)
            : q.eq(q.field("platform"), undefined),
        ),
      )
      .first();

    if (existing) {
      if (
        args.duration_seconds !== undefined &&
        existing.duration_seconds === undefined
      ) {
        await ctx.db.patch(existing._id, {
          duration_seconds: args.duration_seconds,
          notes: args.notes ?? existing.notes,
          person_id: args.person_id ?? existing.person_id,
        });
      }
      return existing._id;
    }

    return await ctx.db.insert("calls", {
      user_id: args.user_id,
      person_id: args.person_id,
      direction: args.direction,
      started_at_ms: args.started_at_ms,
      duration_seconds: args.duration_seconds,
      handle_value: args.handle_value,
      platform: args.platform,
      notes: args.notes,
      created_at: Date.now(),
    });
  },
});
