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
 *   - listFreeSlots — Mac Mini draft engine reads this for date_ask templates.
 *     AI-9500 #3: now returns a curated 1-weeknight + 1-weekend + 1-activity
 *     mix so date_ask offers feel varied and thoughtful instead of 3 dinner slots.
 *   - listActivitySuggestions — dashboard read: which activity slots are populated.
 *   - markProposed / markConfirmed — when a slot is offered to a person and
 *     when she confirms, so the same slot isn't proposed twice.
 *   - clearStale — removes free slots whose start has passed.
 *
 * AI-9500 #3 Slot-kind encoding (no schema change — slot_kind stays "free"):
 *   label_local prefix "[weeknight] " → evening weekday slot
 *   label_local prefix "[weekend] "   → Saturday/Sunday daytime slot
 *   label_local prefix "[activity] "  → curated activity (hike/brunch/rooftop)
 *   no prefix                         → legacy free slot, categorised by weekday
 *
 * Activity slots are seeded by the VPS cc-calendar-worker reading
 * clapcheeks-local/activity-suggestions.yml and writing calendar_slots rows.
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
// listFreeSlots — AI-9500 #3: Triple-slot diversification.
//
// Returns a curated 1-weeknight + 1-weekend + 1-activity mix at the front of
// the result, followed by remaining free slots up to `limit`. The Python caller
// (_free_slot_options_triple in convex_runner.py) reads the first 3 for date_ask.
//
// Category resolution (no schema change — slot_kind always "free"):
//   [activity] prefix in label_local → activity bucket
//   [weekend] prefix in label_local  → weekend bucket
//   [weeknight] prefix in label_local → weeknight bucket
//   no prefix → infer from UTC weekday (Sat/Sun → weekend, else weeknight)
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
    const rawLimit = Math.min(args.limit ?? 60, 200);

    const rows = await ctx.db
      .query("calendar_slots")
      .withIndex("by_user_kind", (q) =>
        q.eq("user_id", args.user_id).eq("slot_kind", "free"),
      )
      .collect();

    const allFree = rows
      .filter((r) => r.slot_start_ms >= now && r.slot_start_ms <= now + horizonMs)
      .sort((a, b) => a.slot_start_ms - b.slot_start_ms);

    // --- Categorise each slot ---
    const weeknightBucket: typeof allFree = [];
    const weekendBucket: typeof allFree = [];
    const activityBucket: typeof allFree = [];
    const fallbackBucket: typeof allFree = [];

    for (const slot of allFree) {
      const label = slot.label_local ?? "";
      if (label.startsWith("[activity] ")) {
        activityBucket.push(slot);
      } else if (label.startsWith("[weekend] ")) {
        weekendBucket.push(slot);
      } else if (label.startsWith("[weeknight] ")) {
        weeknightBucket.push(slot);
      } else {
        // Legacy slots: infer from UTC weekday (off by at most a day, fine for UX).
        const dow = new Date(slot.slot_start_ms).getUTCDay(); // 0=Sun, 6=Sat
        if (dow === 0 || dow === 6) {
          weekendBucket.push(slot);
        } else {
          weeknightBucket.push(slot);
        }
      }
    }

    // --- Build the curated triple (one from each bucket) ---
    const curated: typeof allFree = [];
    const usedIds = new Set<string>();

    const pickFirst = (bucket: typeof allFree): boolean => {
      const s = bucket.find((x) => !usedIds.has(x._id));
      if (!s) return false;
      usedIds.add(s._id);
      curated.push(s);
      return true;
    };

    // Priority order: weeknight → weekend → activity.
    // Fall back to fallbackBucket if a bucket is empty.
    if (!pickFirst(weeknightBucket)) pickFirst(fallbackBucket);
    if (!pickFirst(weekendBucket)) pickFirst(fallbackBucket);
    if (!pickFirst(activityBucket)) pickFirst(fallbackBucket);

    // Append remaining slots (not already in curated) up to rawLimit.
    const remaining = allFree.filter((s) => !usedIds.has(s._id));
    const combined = [...curated, ...remaining].slice(0, rawLimit);

    // Annotate each row with a _category hint for the Python caller so it can
    // build the prompt ("1 weeknight + 1 weekend + 1 activity").
    return combined.map((s) => {
      const label = s.label_local ?? "";
      let category: "weeknight" | "weekend" | "activity";
      if (label.startsWith("[activity] ")) {
        category = "activity";
      } else if (label.startsWith("[weekend] ")) {
        category = "weekend";
      } else if (label.startsWith("[weeknight] ")) {
        category = "weeknight";
      } else {
        const dow = new Date(s.slot_start_ms).getUTCDay();
        category = (dow === 0 || dow === 6) ? "weekend" : "weeknight";
      }
      return { ...s, _category: category };
    });
  },
});

// ---------------------------------------------------------------------------
// listActivitySuggestions — dashboard read.
// Returns upcoming activity-tagged free slots so the ops UI can show which
// curated activities are populated and in what quantity.
// ---------------------------------------------------------------------------
export const listActivitySuggestions = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowEnd = now + 14 * 24 * 60 * 60 * 1000;

    const rows = await ctx.db
      .query("calendar_slots")
      .withIndex("by_user_kind", (q) =>
        q.eq("user_id", args.user_id).eq("slot_kind", "free"),
      )
      .collect();

    const activities = rows
      .filter(
        (s) =>
          s.slot_start_ms >= now &&
          s.slot_start_ms <= windowEnd &&
          (s.label_local ?? "").startsWith("[activity] "),
      )
      .sort((a, b) => a.slot_start_ms - b.slot_start_ms)
      .map((s) => ({
        _id: s._id,
        slot_start_ms: s.slot_start_ms,
        slot_end_ms: s.slot_end_ms,
        label_local: s.label_local,
        fetched_at_ms: s.fetched_at_ms,
      }));

    return {
      count: activities.length,
      slots: activities,
      note:
        activities.length === 0
          ? "No activity slots populated yet — run cc-calendar-worker to seed from activity-suggestions.yml."
          : null,
    };
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
