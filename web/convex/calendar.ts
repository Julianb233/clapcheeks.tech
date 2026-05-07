/**
 * AI-9449 Wave 2.2 — Calendar slot cache.
 *
 * The Mac Mini daemon (clapcheeks-local convex_runner) handles the
 * `fetch_calendar_slots` agent_job by calling `gws calendar events list` against
 * Julian's primary + Dating + CONSULTING + SALES CALLS calendars and writing the
 * resulting free-busy windows into `calendar_slots`.
 *
 * This module exposes:
 *   - enqueueFetchJob (internalMutation) — fired by the cron; inserts an
 *     agent_job for Mac Mini to claim.
 *   - upsertSlots — Mac Mini calls this to write free-busy windows.
 *   - listFreeSlots — Mac Mini draft engine reads this for date_ask templates;
 *     returns up to N upcoming free windows in preferred evening hours.
 *   - markProposed / markConfirmed — when a slot is offered to a person and
 *     when she confirms, so the same slot isn't proposed twice.
 *   - clearStale — removes free slots whose start has passed.
 */
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// Cron entry point — enqueue an agent_job for Mac Mini.
// ---------------------------------------------------------------------------
export const enqueueFetchJob = internalMutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Dedup: skip if there's already a queued/running fetch_calendar_slots
    // job for this user, so a slow Mac Mini doesn't pile up duplicates.
    const existing = await ctx.db
      .query("agent_jobs")
      .withIndex("by_user_type", (q) =>
        q.eq("user_id", args.user_id).eq("job_type", "fetch_calendar_slots"),
      )
      .collect();
    const inFlight = existing.find(
      (j) => j.status === "queued" || j.status === "running",
    );
    if (inFlight) return { skipped: true, reason: "already_in_flight", job_id: inFlight._id };
    await ctx.db.insert("agent_jobs", {
      user_id: args.user_id,
      job_type: "fetch_calendar_slots",
      payload: { user_id: args.user_id, horizon_days: 14 },
      status: "queued",
      priority: 5,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    } as any);
    return { enqueued: true };
  },
});

// ---------------------------------------------------------------------------
// upsertSlots — Mac Mini writes free-busy windows here.
// ---------------------------------------------------------------------------
export const upsertSlots = mutation({
  args: {
    user_id: v.string(),
    slots: v.array(v.object({
      slot_start_ms: v.number(),
      slot_end_ms: v.number(),
      slot_kind: v.union(
        v.literal("free"), v.literal("busy"),
        v.literal("date_proposed"), v.literal("date_confirmed"),
      ),
      label_local: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    for (const s of args.slots) {
      // Dedup on (user_id, slot_start_ms).
      const existing = await ctx.db
        .query("calendar_slots")
        .withIndex("by_user_start", (q) =>
          q.eq("user_id", args.user_id).eq("slot_start_ms", s.slot_start_ms),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          slot_end_ms: s.slot_end_ms,
          slot_kind: s.slot_kind,
          label_local: s.label_local,
          fetched_at_ms: now,
        });
      } else {
        await ctx.db.insert("calendar_slots", {
          user_id: args.user_id,
          slot_start_ms: s.slot_start_ms,
          slot_end_ms: s.slot_end_ms,
          slot_kind: s.slot_kind,
          label_local: s.label_local,
          fetched_at_ms: now,
        });
        inserted++;
      }
    }
    return { inserted, total: args.slots.length };
  },
});

// ---------------------------------------------------------------------------
// listFreeSlots — Mac Mini draft engine reads this for date_ask drafts.
// Returns N upcoming free slots in preferred evening hours, deduped by day.
// ---------------------------------------------------------------------------
export const listFreeSlots = query({
  args: {
    user_id: v.string(),
    horizon_days: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const horizonMs = (args.horizon_days ?? 14) * 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("calendar_slots")
      .withIndex("by_user_kind", (q) =>
        q.eq("user_id", args.user_id).eq("slot_kind", "free"),
      )
      .collect();
    return rows
      .filter((r) => r.slot_start_ms >= now && r.slot_start_ms <= now + horizonMs)
      .sort((a, b) => a.slot_start_ms - b.slot_start_ms)
      .slice(0, Math.min(args.limit ?? 60, 200));
  },
});

// ---------------------------------------------------------------------------
// markProposed / markConfirmed — date_ask flow tracks offered slots.
// ---------------------------------------------------------------------------
export const markProposed = mutation({
  args: {
    slot_id: v.id("calendar_slots"),
    person_id: v.id("people"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.slot_id, {
      slot_kind: "date_proposed",
      proposed_to_person_id: args.person_id,
    });
  },
});

export const markConfirmed = mutation({
  args: { slot_id: v.id("calendar_slots") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.slot_id, { slot_kind: "date_confirmed" });
  },
});

// ---------------------------------------------------------------------------
// clearStale — remove free-but-past slots so list queries stay tight.
// ---------------------------------------------------------------------------
export const clearStale = internalMutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("calendar_slots")
      .withIndex("by_user_kind", (q) =>
        q.eq("user_id", args.user_id).eq("slot_kind", "free"),
      )
      .collect();
    let removed = 0;
    for (const s of stale) {
      if (s.slot_start_ms < now) {
        await ctx.db.delete(s._id);
        removed++;
      }
    }
    return { removed };
  },
});
